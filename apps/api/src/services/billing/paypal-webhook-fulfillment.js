import {
	buildPayPalActivationIdempotencyKey,
	buildPayPalRenewalIdempotencyKey,
	classifyPayPalActivationFulfillment,
	classifyPayPalRenewalFulfillment,
	verifyPayPalSaleForRenewal,
	verifyPayPalSubscriptionForActivation,
	verifyPayPalSubscriptionForCancellation,
} from './paypal-transaction-verification.js';
import {
	buildPayPalRefundIdempotencyKey,
	extractPayPalRefundWebhookContext,
	verifyPayPalSaleReversedState,
	verifyPayPalSubscriptionRefundIdentity,
} from './paypal-refund-verification.js';
import { PayPalApiError } from './providers/paypal.js';
import {
	classifyPayPalWebhookEvent,
	extractPayPalWebhookContext,
} from './providers/paypal-webhook-helpers.js';
import { canRetryWebhookEvent, isTerminalWebhookStatus } from './webhook-event-status.js';

async function resolvePocketbaseClient() {
	const { default: pocketbaseClient } = await import('../../utils/pocketbaseClient.js');
	return pocketbaseClient;
}

async function resolveSubscriptionsModule() {
	return import('./subscriptions.js');
}

async function resolveWebhookEventsModule() {
	return import('./webhook-events.js');
}

async function resolveLogBillingAction(override) {
	if (override) return override;
	const { logBillingAction } = await import('./audit.js');
	return logBillingAction;
}

async function loadPlanRecord(planSlug) {
	const slug = String(planSlug || '').trim().toLowerCase();
	if (!slug) return null;
	const pocketbaseClient = await resolvePocketbaseClient();
	return pocketbaseClient.collection('plans').getFirstListItem(
		pocketbaseClient.filter('slug = {:slug}', { slug }),
		{ requestKey: null },
	).catch(() => null);
}

async function workspaceExists(workspaceKey) {
	if (!workspaceKey) return false;
	const pocketbaseClient = await resolvePocketbaseClient();
	const row = await pocketbaseClient.collection('workspaces').getFirstListItem(
		pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ requestKey: null },
	).catch(() => null);
	return Boolean(row);
}

async function loadSubscriptionByWorkspace(workspaceKey) {
	const pocketbaseClient = await resolvePocketbaseClient();
	return pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
		pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
}

function buildStructuredLog(base = {}) {
	return {
		provider: 'paypal',
		...base,
	};
}

function isPayPalApiError(error) {
	return error instanceof PayPalApiError;
}

async function persistWebhookFailure(recordId, error, decision, updateEvent) {
	const update = updateEvent || (await resolveWebhookEventsModule()).updateWebhookEvent;
	await update(recordId, {
		status: 'failed',
		error: error?.message || String(error || decision || 'unknown'),
	});
}

async function handleVerifiedActivation({
	paypalConfig,
	parsed,
	webhookRecord,
	provider,
	fetchImpl,
	deps = {},
}) {
	const context = extractPayPalWebhookContext(parsed.payload);
	const planIds = paypalConfig?.planIds || {};
	const updateEvent = deps.updateWebhookEvent
		|| (await resolveWebhookEventsModule()).updateWebhookEvent;
	const loadPlan = deps.loadPlanRecord || loadPlanRecord;
	const checkWorkspace = deps.workspaceExists || workspaceExists;
	const loadSubscription = deps.loadSubscriptionByWorkspace || loadSubscriptionByWorkspace;

	let apiSubscription;
	try {
		apiSubscription = await provider.retrieveSubscription(context.subscriptionId, { fetchImpl });
	} catch (error) {
		const reason = isPayPalApiError(error) ? error.code || error.message : 'paypal_api_error';
		await persistWebhookFailure(webhookRecord.id, error, reason, updateEvent);
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				blocked: true,
				retryable: isPayPalApiError(error) && (error.isServerError || error.isTimeout),
				reason,
			},
		};
	}

	const subscriptionRecord = context.workspaceKey
		? await loadSubscription(context.workspaceKey)
		: null;
	const planRecord = await loadPlan(context.planSlug);
	const workspaceOk = await checkWorkspace(context.workspaceKey);

	const verified = verifyPayPalSubscriptionForActivation({
		subscription: apiSubscription,
		webhookContext: context,
		planIds,
		planRecord,
		workspaceExists: workspaceOk,
		subscriptionRecord,
	});

	if (!verified.ok) {
		await persistWebhookFailure(webhookRecord.id, null, verified.error, updateEvent);
		const writeAudit = await resolveLogBillingAction(deps.logBillingAction);
		await writeAudit({
			action: 'PayPal subscription verification failed',
			eventType: 'payment_failed',
			workspaceKey: context.workspaceKey,
			actor: 'webhook:paypal',
			provider: 'paypal',
			severity: 'warn',
			metadata: buildStructuredLog({
				event_id: parsed.idempotencyKey,
				event_type: parsed.eventType,
				subscription_id: context.subscriptionId,
				decision: 'blocked',
				reason: verified.error,
				plan_slug: context.planSlug,
			}),
		});
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				blocked: true,
				reason: verified.error,
			},
		};
	}

	const fulfillmentKind = classifyPayPalActivationFulfillment({ subscriptionRecord, verified });

	if (fulfillmentKind.kind === 'duplicate') {
		await updateEvent(webhookRecord.id, { status: 'duplicate', error: fulfillmentKind.reason });
		return { ok: true, result: { ok: true, duplicate: true, activated: false, reason: fulfillmentKind.reason } };
	}

	if (fulfillmentKind.kind === 'blocked') {
		await persistWebhookFailure(webhookRecord.id, null, fulfillmentKind.reason, updateEvent);
		return { ok: true, result: { handled: true, activated: false, blocked: true, reason: fulfillmentKind.reason } };
	}

	const idempotencyKey = buildPayPalActivationIdempotencyKey(verified.subscriptionId);
	const activate = deps.activatePayPalSubscription
		|| (await resolveSubscriptionsModule()).activatePayPalSubscription;
	const result = await activate({
		workspaceKey: verified.workspaceKey,
		verified,
		eventId: parsed.idempotencyKey,
		idempotencyKey,
		actor: 'webhook:paypal',
	});

	if (result.duplicate) {
		await updateEvent(webhookRecord.id, { status: 'duplicate', error: 'subscription_already_activated' });
		return { ok: true, result: { ok: true, duplicate: true, activated: false, reason: 'subscription_already_activated' } };
	}

	await updateEvent(webhookRecord.id, {
		status: 'processed',
		workspace_key: verified.workspaceKey,
		subscription_id: verified.subscriptionId,
		error: '',
	});

	const writeAudit = await resolveLogBillingAction(deps.logBillingAction);
	await writeAudit({
		action: 'PayPal activation processed',
		eventType: 'upgrade',
		workspaceKey: verified.workspaceKey,
		actor: 'webhook:paypal',
		provider: 'paypal',
		metadata: buildStructuredLog({
			event_id: parsed.idempotencyKey,
			event_type: parsed.eventType,
			subscription_id: verified.subscriptionId,
			plan_slug: verified.planSlug,
			decision: 'activation',
			result,
		}),
	});

	return { ok: true, result: { ...result, handled: true, verified: true } };
}

async function handleVerifiedRenewal({
	paypalConfig,
	parsed,
	webhookRecord,
	provider,
	fetchImpl,
	deps = {},
}) {
	const context = extractPayPalWebhookContext(parsed.payload);
	const planIds = paypalConfig?.planIds || {};
	const updateEvent = deps.updateWebhookEvent
		|| (await resolveWebhookEventsModule()).updateWebhookEvent;
	const loadPlan = deps.loadPlanRecord || loadPlanRecord;
	const checkWorkspace = deps.workspaceExists || workspaceExists;
	const loadSubscription = deps.loadSubscriptionByWorkspace || loadSubscriptionByWorkspace;

	let apiSale;
	try {
		apiSale = await provider.retrieveSale(context.saleId, { fetchImpl });
	} catch (error) {
		const reason = isPayPalApiError(error) ? error.code || error.message : 'paypal_api_error';
		await persistWebhookFailure(webhookRecord.id, error, reason, updateEvent);
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				renewed: false,
				blocked: true,
				retryable: isPayPalApiError(error) && (error.isServerError || error.isTimeout),
				reason,
			},
		};
	}

	const subscriptionId = String(
		apiSale.billingAgreementId
		|| context.subscriptionId
		|| '',
	).trim();

	if (!subscriptionId) {
		await persistWebhookFailure(webhookRecord.id, null, 'paypal_renewal_missing_subscription_id', updateEvent);
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				renewed: false,
				blocked: true,
				reason: 'paypal_renewal_missing_subscription_id',
			},
		};
	}

	let apiSubscription;
	try {
		apiSubscription = await provider.retrieveSubscription(subscriptionId, { fetchImpl });
	} catch (error) {
		const reason = isPayPalApiError(error) ? error.code || error.message : 'paypal_api_error';
		await persistWebhookFailure(webhookRecord.id, error, reason, updateEvent);
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				renewed: false,
				blocked: true,
				retryable: isPayPalApiError(error) && (error.isServerError || error.isTimeout),
				reason,
			},
		};
	}

	const renewalContext = {
		...context,
		subscriptionId,
		workspaceKey: context.workspaceKey || extractPayPalWebhookContext({
			resource: { custom_id: apiSubscription.customId, id: subscriptionId },
		}).workspaceKey,
		planSlug: context.planSlug || extractPayPalWebhookContext({
			resource: { custom_id: apiSubscription.customId, id: subscriptionId },
		}).planSlug,
	};

	const subscriptionRecord = renewalContext.workspaceKey
		? await loadSubscription(renewalContext.workspaceKey)
		: null;
	const planRecord = await loadPlan(renewalContext.planSlug || apiSubscription.planId);
	const workspaceOk = await checkWorkspace(renewalContext.workspaceKey);

	const verified = verifyPayPalSaleForRenewal({
		sale: apiSale,
		subscription: apiSubscription,
		webhookContext: renewalContext,
		planIds,
		planRecord: planRecord || await loadPlan(
			Object.keys(planIds).find((slug) => planIds[slug] === apiSubscription.planId) || '',
		),
		workspaceExists: workspaceOk,
		subscriptionRecord,
	});

	if (!verified.ok) {
		await persistWebhookFailure(webhookRecord.id, null, verified.error, updateEvent);
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				renewed: false,
				blocked: true,
				reason: verified.error,
			},
		};
	}

	const idempotencyKey = buildPayPalRenewalIdempotencyKey(verified.saleId);
	const fulfillmentKind = classifyPayPalRenewalFulfillment({ subscriptionRecord, verified });

	if (fulfillmentKind.kind === 'duplicate') {
		await updateEvent(webhookRecord.id, { status: 'duplicate', error: fulfillmentKind.reason });
		return { ok: true, result: { ok: true, duplicate: true, renewed: false, reason: fulfillmentKind.reason } };
	}

	if (fulfillmentKind.kind === 'blocked') {
		await persistWebhookFailure(webhookRecord.id, null, fulfillmentKind.reason, updateEvent);
		return { ok: true, result: { handled: true, activated: false, renewed: false, blocked: true, reason: fulfillmentKind.reason } };
	}

	const result = await (deps.renewPayPalSubscription
		|| (await resolveSubscriptionsModule()).renewPayPalSubscription)({
		workspaceKey: verified.workspaceKey,
		verified,
		eventId: parsed.idempotencyKey,
		idempotencyKey,
		actor: 'webhook:paypal',
	});

	if (result.duplicate) {
		await updateEvent(webhookRecord.id, { status: 'duplicate', error: 'sale_already_processed' });
		return { ok: true, result: { ok: true, duplicate: true, renewed: false, reason: 'sale_already_processed' } };
	}

	await updateEvent(webhookRecord.id, {
		status: 'processed',
		workspace_key: verified.workspaceKey,
		subscription_id: verified.subscriptionId,
		transaction_id: verified.saleId,
		error: '',
	});

	const writeAudit = await resolveLogBillingAction(deps.logBillingAction);
	await writeAudit({
		action: 'PayPal renewal processed',
		eventType: 'renewed',
		workspaceKey: verified.workspaceKey,
		actor: 'webhook:paypal',
		provider: 'paypal',
		metadata: buildStructuredLog({
			event_id: parsed.idempotencyKey,
			event_type: parsed.eventType,
			sale_id: verified.saleId,
			subscription_id: verified.subscriptionId,
			decision: 'renewal',
			result,
		}),
	});

	return { ok: true, result: { ...result, handled: true, verified: true } };
}

async function handlePayPalCancelEvent({
	parsed,
	webhookRecord,
	provider,
	fetchImpl,
	deps = {},
}) {
	const context = extractPayPalWebhookContext(parsed.payload);
	const updateEvent = deps.updateWebhookEvent
		|| (await resolveWebhookEventsModule()).updateWebhookEvent;

	if (!context.subscriptionId) {
		await updateEvent(webhookRecord.id, {
			status: 'failed',
			error: 'paypal_cancellation_missing_subscription_id',
		});
		return {
			ok: true,
			result: { handled: false, activated: false, reason: 'paypal_cancellation_missing_subscription_id' },
		};
	}

	let cancelAtPeriodEnd = true;
	let paypalSubscriptionId = context.subscriptionId;

	try {
		const apiSub = await provider.retrieveSubscription(context.subscriptionId, { fetchImpl });
		const subCheck = verifyPayPalSubscriptionForCancellation(apiSub);
		if (!subCheck.ok) {
			await persistWebhookFailure(webhookRecord.id, null, subCheck.error, updateEvent);
			return { ok: true, result: { handled: false, activated: false, reason: subCheck.error } };
		}
		cancelAtPeriodEnd = subCheck.cancelAtPeriodEnd && !subCheck.immediate;
		if (subCheck.immediate) cancelAtPeriodEnd = false;
		paypalSubscriptionId = String(apiSub.subscriptionId || context.subscriptionId).trim();
	} catch (error) {
		await persistWebhookFailure(webhookRecord.id, error, 'paypal_subscription_api_failed', updateEvent);
		return {
			ok: true,
			result: {
				handled: false,
				activated: false,
				retryable: isPayPalApiError(error) && (error.isServerError || error.isTimeout),
				reason: 'paypal_subscription_api_failed',
			},
		};
	}

	const cancel = deps.handlePayPalCancellation
		|| (await resolveSubscriptionsModule()).handlePayPalCancellation;
	const result = await cancel({
		paypalSubscriptionId,
		cancelAtPeriodEnd,
		eventId: parsed.idempotencyKey,
		workspaceKey: context.workspaceKey,
	});

	await updateEvent(webhookRecord.id, {
		status: result.handled ? 'processed' : 'failed',
		subscription_id: paypalSubscriptionId,
		workspace_key: result.workspaceKey || context.workspaceKey || '',
		error: result.error || '',
	});

	return { ok: true, result: { ...result, handled: result.handled, activated: false } };
}

async function handlePayPalRefundEvent({
	parsed,
	webhookRecord,
	provider,
	fetchImpl,
	deps = {},
}) {
	const refundContext = extractPayPalRefundWebhookContext(parsed.payload);
	const updateEvent = deps.updateWebhookEvent
		|| (await resolveWebhookEventsModule()).updateWebhookEvent;
	const loadSubscription = deps.loadSubscriptionByWorkspace || loadSubscriptionByWorkspace;

	if (!refundContext.saleId) {
		await updateEvent(webhookRecord.id, {
			status: 'failed',
			error: 'paypal_refund_missing_sale_id',
		});
		return {
			ok: true,
			result: { handled: false, refunded: false, reason: 'paypal_refund_missing_sale_id' },
		};
	}

	let apiSale;
	try {
		apiSale = await provider.retrieveSale(refundContext.saleId, { fetchImpl });
	} catch (error) {
		const reason = isPayPalApiError(error) ? error.code || error.message : 'paypal_api_error';
		await persistWebhookFailure(webhookRecord.id, error, reason, updateEvent);
		return {
			ok: true,
			result: {
				handled: false,
				refunded: false,
				retryable: isPayPalApiError(error) && (error.isServerError || error.isTimeout),
				reason,
			},
		};
	}

	const saleCheck = verifyPayPalSaleReversedState(apiSale);
	if (!saleCheck.ok) {
		await persistWebhookFailure(webhookRecord.id, null, saleCheck.error, updateEvent);
		return { ok: true, result: { handled: false, refunded: false, reason: saleCheck.error } };
	}

	const subscriptionRecord = refundContext.workspaceKey
		? await loadSubscription(refundContext.workspaceKey)
		: null;

	const identity = verifyPayPalSubscriptionRefundIdentity({
		sale: apiSale,
		webhookContext: refundContext,
		subscriptionRecord,
	});
	if (!identity.ok) {
		await persistWebhookFailure(webhookRecord.id, null, identity.error, updateEvent);
		return { ok: true, result: { handled: false, refunded: false, reason: identity.error } };
	}

	const refundIdempotencyKey = buildPayPalRefundIdempotencyKey({
		saleId: identity.saleId,
		refundId: String(apiSale?.refund_id || apiSale?.refundId || '').trim(),
	});

	const applyRefund = deps.handleSubscriptionRefundPending
		|| (await import('./refund-lifecycle.js')).handleSubscriptionRefundPending;
	const result = await applyRefund({
		workspaceKey: identity.workspaceKey,
		provider: 'paypal',
		providerSubscriptionId: identity.subscriptionId,
		saleId: identity.saleId,
		eventId: parsed.idempotencyKey,
		idempotencyKey: refundIdempotencyKey,
		actor: 'webhook:paypal',
		reason: `PayPal sale ${saleCheck.state}`,
	});

	if (result.duplicate) {
		await updateEvent(webhookRecord.id, {
			status: 'duplicate',
			error: 'refund_already_processed',
			workspace_key: identity.workspaceKey,
			transaction_id: identity.saleId,
			subscription_id: identity.subscriptionId || '',
		});
		return { ok: true, result: { ...result, handled: true, refunded: false, duplicate: true } };
	}

	if (!result.handled) {
		await updateEvent(webhookRecord.id, {
			status: 'failed',
			error: result.error || 'subscription_refund_failed',
			workspace_key: identity.workspaceKey,
			transaction_id: identity.saleId,
			subscription_id: identity.subscriptionId || '',
		});
		return { ok: true, result: { ...result, handled: false, refunded: false } };
	}

	await updateEvent(webhookRecord.id, {
		status: 'processed',
		workspace_key: identity.workspaceKey,
		transaction_id: identity.saleId,
		subscription_id: identity.subscriptionId || '',
		error: '',
	});

	const writeAudit = await resolveLogBillingAction(deps.logBillingAction);
	await writeAudit({
		action: 'PayPal subscription refund processed',
		eventType: 'cancelled',
		workspaceKey: identity.workspaceKey,
		actor: 'webhook:paypal',
		provider: 'paypal',
		idempotencyKey: refundIdempotencyKey,
		metadata: buildStructuredLog({
			event_id: parsed.idempotencyKey,
			event_type: parsed.eventType,
			sale_id: identity.saleId,
			subscription_id: identity.subscriptionId || '',
			state: saleCheck.state,
			result,
		}),
	});

	return { ok: true, result: { ...result, handled: true, refunded: true, verified: true } };
}

/**
 * Phase 3.6 PayPal webhook ingress — verified API state required before entitlement mutation.
 */
export async function handlePayPalBillingWebhook(req, {
	fetchImpl = fetch,
	deps = {},
} = {}) {
	let billingConfig = deps.billingConfig;
	let provider = deps.provider;
	if (!billingConfig || !provider) {
		const { resolveBillingConfig, getBillingProvider } = await import('./providers/index.js');
		billingConfig = billingConfig || await resolveBillingConfig();
		provider = provider || await getBillingProvider('paypal', { config: billingConfig });
	}
	const paypalConfig = billingConfig.providers?.paypal || {};

	const verified = await provider.verifyWebhook(req, { fetchImpl }).catch(() => ({ ok: false, error: 'verify_failed' }));
	if (!verified?.ok) {
		const error = new Error(verified?.error || 'Webhook signature verification failed');
		error.status = 401;
		error.errorCode = 'WEBHOOK_UNAUTHORIZED';
		throw error;
	}

	const webhookEvents = deps.findWebhookEvent && deps.createWebhookEvent && deps.updateWebhookEvent
		? deps
		: await resolveWebhookEventsModule();
	const findEvent = deps.findWebhookEvent || webhookEvents.findWebhookEvent;
	const createEvent = deps.createWebhookEvent || webhookEvents.createWebhookEvent;
	const updateEvent = deps.updateWebhookEvent || webhookEvents.updateWebhookEvent;

	const parsed = await provider.parseWebhook(req);
	const eventId = String(parsed.idempotencyKey || '').slice(0, 180);
	if (!eventId) {
		return { ok: false, error: 'missing_event_id' };
	}

	const context = extractPayPalWebhookContext(parsed.payload);
	let webhookRecord = await findEvent({ provider: 'paypal', eventId });

	if (webhookRecord && isTerminalWebhookStatus(webhookRecord.status)) {
		await updateEvent(webhookRecord.id, { status: 'duplicate' }).catch(() => null);
		return { ok: true, duplicate: true, result: { handled: true, activated: false, duplicate: true } };
	}

	if (!webhookRecord) {
		webhookRecord = await createEvent({
			provider: 'paypal',
			eventId,
			eventType: parsed.eventType,
			transactionId: context.saleId,
			subscriptionId: context.subscriptionId,
			workspaceKey: context.workspaceKey,
			status: 'received',
			payload: parsed.payload,
		});
	} else if (!canRetryWebhookEvent(webhookRecord)) {
		return { ok: true, duplicate: true, result: { handled: true, activated: false, duplicate: true } };
	}

	await updateEvent(webhookRecord.id, { status: 'processing' });

	const classification = classifyPayPalWebhookEvent(parsed.eventType);
	const routing = classification.routing;

	try {
		if (routing === 'subscription_activation') {
			return await handleVerifiedActivation({
				paypalConfig,
				parsed,
				webhookRecord,
				provider,
				fetchImpl,
				deps,
			});
		}

		if (routing === 'subscription_renewal') {
			return await handleVerifiedRenewal({
				paypalConfig,
				parsed,
				webhookRecord,
				provider,
				fetchImpl,
				deps,
			});
		}

		if (routing === 'payment_failed') {
			const handleFailure = deps.handlePayPalPaymentFailure
				|| (await resolveSubscriptionsModule()).handlePayPalPaymentFailure;
			const result = await handleFailure({
				workspaceKey: context.workspaceKey,
				eventId,
				subscriptionId: context.subscriptionId,
				reason: classification.routingReason || parsed.eventType,
				idempotencyKey: `paypal-fail:${eventId}`,
			});
			await updateEvent(webhookRecord.id, {
				status: 'processed',
				workspace_key: context.workspaceKey || '',
				subscription_id: context.subscriptionId || '',
			});
			return { ok: true, result: { ...result, handled: true, activated: false } };
		}

		if (routing === 'cancel') {
			return await handlePayPalCancelEvent({
				parsed,
				webhookRecord,
				provider,
				fetchImpl,
				deps,
			});
		}

		if (routing === 'subscription_refund') {
			return await handlePayPalRefundEvent({
				parsed,
				webhookRecord,
				provider,
				fetchImpl,
				deps,
			});
		}

		await updateEvent(webhookRecord.id, {
			status: 'ignored',
			error: classification.routingReason || '',
		});
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				ignored: true,
				eventType: parsed.eventType,
				reason: classification.routingReason,
			},
		};
	} catch (error) {
		await persistWebhookFailure(webhookRecord.id, error, 'paypal_webhook_processing_error', updateEvent);
		throw error;
	}
}
