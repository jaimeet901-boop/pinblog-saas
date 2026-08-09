import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { logBillingAction } from './audit.js';
import { loadRegistryEntries } from './price-registry-resolver.js';
import {
	buildPaddleCreditPackIdempotencyKey,
	classifyPaddleCreditPackFulfillment,
	classifyPaddleTransactionFulfillment,
	verifyPaddleSubscriptionForCancellation,
	verifyPaddleTransactionForCreditPack,
	verifyPaddleTransactionForFulfillment,
} from './paddle-transaction-verification.js';
import { fulfillCreditPackPurchase, listCreditPacks } from './payg.js';
import { getBillingProvider, resolveBillingConfig } from './providers/index.js';
import { getPaddleSubscription, getPaddleTransaction, getPaddleAdjustment, PaddleApiError } from './providers/paddle-api-client.js';
import { deriveEffectivePaddleEnvironment } from './providers/paddle-environment.js';
import {
	buildPaddleWebhookParseResult,
	classifyPaddleWebhookEvent,
	extractPaddleWebhookContext,
} from './providers/paddle-webhook-helpers.js';
import {
	activatePaddleSubscription,
	handlePaddleCancellation,
	handlePaddlePaymentFailure,
	renewPaddleSubscription,
} from './subscriptions.js';
import {
	buildPaddleRefundIdempotencyKey,
	classifyPaddleRefundPurchaseKind,
	extractPaddleAdjustmentFromWebhook,
	verifyPaddleAdjustmentForRefund,
	verifyPaddleRefundWorkspaceIdentity,
	verifyPaddleTransactionRefundState,
} from './paddle-refund-verification.js';
import {
	clawbackCreditPackPurchase,
	handleSubscriptionRefundPending,
} from './refund-lifecycle.js';
import { syncEntitlementMirrors } from './entitlement-sync.js';
import { handlePaddleSubscriptionUpdatedEvent as runPaddleSubscriptionUpdatedHandler } from './paddle-subscription-updated-handler.js';
import { reconcilePaddleSubscription } from './paddle-subscription-reconcile.js';
import {
	fetchAndVerifyPaddleSubscriptionForReconciliation,
} from './paddle-subscription-reconciliation.js';
import {
	canRetryWebhookEvent,
	createWebhookEvent,
	findWebhookEvent,
	isTerminalWebhookStatus,
	updateWebhookEvent,
} from './webhook-events.js';

async function loadPlanRecord(planSlug) {
	const slug = String(planSlug || '').trim().toLowerCase();
	if (!slug) return null;
	return pocketbaseClient.collection('plans').getFirstListItem(
		pocketbaseClient.filter('slug = {:slug}', { slug }),
		{ requestKey: null },
	).catch(() => null);
}

async function workspaceExists(workspaceKey) {
	if (!workspaceKey) return false;
	const row = await pocketbaseClient.collection('workspaces').getFirstListItem(
		pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ requestKey: null },
	).catch(() => null);
	return Boolean(row);
}

async function loadSubscriptionByWorkspace(workspaceKey) {
	return pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
		pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
}

async function loadSubscriptionByPaddleId(paddleSubscriptionId) {
	return pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
		pocketbaseClient.filter('paddle_subscription_id = {:id}', { id: paddleSubscriptionId }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
}

function buildStructuredLog(base = {}) {
	return {
		provider: 'paddle',
		...base,
	};
}

async function persistWebhookFailure(recordId, error, decision) {
	await updateWebhookEvent(recordId, {
		status: 'failed',
		error: error?.message || String(error || decision || 'unknown'),
	});
}

async function handleVerifiedTransactionCompleted({
	req,
	config,
	parsed,
	webhookRecord,
	fetchImpl,
}) {
	const context = parsed.context || extractPaddleWebhookContext(parsed.payload);
	const envResult = deriveEffectivePaddleEnvironment(config);
	if (!envResult.ok) {
		await persistWebhookFailure(webhookRecord.id, null, envResult.error);
		return { ok: true, result: { handled: true, activated: false, blocked: true, reason: envResult.error } };
	}

	const environment = envResult.environment;
	const registryEntries = await loadRegistryEntries({ environment, provider: 'paddle', config });

	let apiTransaction;
	try {
		apiTransaction = await getPaddleTransaction(context.transactionId, {
			environment,
			config,
			fetchImpl,
		});
	} catch (error) {
		const reason = error instanceof PaddleApiError ? error.code || error.message : 'paddle_api_error';
		await persistWebhookFailure(webhookRecord.id, error, reason);
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				blocked: true,
				retryable: error instanceof PaddleApiError && (error.isServerError || error.isTimeout),
				reason,
			},
		};
	}

	const subscriptionRecord = context.workspaceKey
		? await loadSubscriptionByWorkspace(context.workspaceKey)
		: null;
	const planFromRegistry = registryEntries.find((entry) => entry.planSlug === context.planSlug) || null;
	const planRecord = await loadPlanRecord(planFromRegistry?.planSlug || context.planSlug);
	const workspaceOk = await workspaceExists(context.workspaceKey);

	const verified = verifyPaddleTransactionForFulfillment({
		transaction: apiTransaction,
		webhookContext: context,
		registryEntries,
		environment,
		planRecord,
		workspaceExists: workspaceOk,
		subscriptionRecord,
	});

	if (!verified.ok) {
		await persistWebhookFailure(webhookRecord.id, null, verified.error);
		await logBillingAction({
			action: 'Paddle transaction verification failed',
			eventType: 'payment_failed',
			workspaceKey: context.workspaceKey,
			actor: 'webhook:paddle',
			provider: 'paddle',
			severity: 'warn',
			metadata: buildStructuredLog({
				event_id: parsed.idempotencyKey,
				event_type: parsed.eventType,
				transaction_id: context.transactionId,
				decision: 'blocked',
				reason: verified.error,
				price_id: context.priceId,
				plan_slug: context.planSlug,
				environment,
			}),
		});
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				blocked: true,
				reason: verified.error,
				priceValidation: verified,
			},
		};
	}

	const fulfillmentKind = classifyPaddleTransactionFulfillment({
		subscriptionRecord,
		verified,
	});

	if (fulfillmentKind.kind === 'duplicate') {
		await updateWebhookEvent(webhookRecord.id, { status: 'duplicate', error: fulfillmentKind.reason });
		return { ok: true, result: { ok: true, duplicate: true, activated: false, reason: fulfillmentKind.reason } };
	}

	if (fulfillmentKind.kind === 'blocked') {
		await persistWebhookFailure(webhookRecord.id, null, fulfillmentKind.reason);
		return { ok: true, result: { handled: true, activated: false, blocked: true, reason: fulfillmentKind.reason } };
	}

	let result;
	if (fulfillmentKind.kind === 'renewal') {
		result = await renewPaddleSubscription({
			workspaceKey: verified.workspaceKey,
			verified,
			eventId: parsed.idempotencyKey,
			idempotencyKey: `paddle-renew:${verified.transactionId}`,
			actor: 'webhook:paddle',
		});
	} else {
		result = await activatePaddleSubscription({
			workspaceKey: verified.workspaceKey,
			verified,
			eventId: parsed.idempotencyKey,
			idempotencyKey: `sub-fulfill:paddle-txn:${verified.transactionId}`,
			actor: 'webhook:paddle',
		});
	}

	await updateWebhookEvent(webhookRecord.id, {
		status: 'processed',
		workspace_key: verified.workspaceKey,
		transaction_id: verified.transactionId,
		subscription_id: verified.subscriptionId || '',
		error: '',
	});

	await logBillingAction({
		action: fulfillmentKind.kind === 'renewal'
			? 'Paddle renewal processed'
			: 'Paddle activation processed',
		eventType: fulfillmentKind.kind === 'renewal' ? 'renewed' : 'upgrade',
		workspaceKey: verified.workspaceKey,
		actor: 'webhook:paddle',
		provider: 'paddle',
		metadata: buildStructuredLog({
			event_id: parsed.idempotencyKey,
			event_type: parsed.eventType,
			transaction_id: verified.transactionId,
			subscription_id: verified.subscriptionId,
			plan_slug: verified.planSlug,
			price_id: verified.priceId,
			environment,
			decision: fulfillmentKind.kind,
			result,
		}),
	});

	return { ok: true, result: { ...result, handled: true, verified: true } };
}

async function handleVerifiedCreditPackTransactionCompleted({
	config,
	parsed,
	webhookRecord,
	fetchImpl,
}) {
	const context = parsed.context || extractPaddleWebhookContext(parsed.payload);
	const envResult = deriveEffectivePaddleEnvironment(config);
	if (!envResult.ok) {
		await persistWebhookFailure(webhookRecord.id, null, envResult.error);
		return { ok: true, result: { handled: true, fulfilled: false, blocked: true, reason: envResult.error } };
	}

	const environment = envResult.environment;
	const registryEntries = await loadRegistryEntries({ environment, provider: 'paddle', config });

	let apiTransaction;
	try {
		apiTransaction = await getPaddleTransaction(context.transactionId, {
			environment,
			config,
			fetchImpl,
		});
	} catch (error) {
		const reason = error instanceof PaddleApiError ? error.code || error.message : 'paddle_api_error';
		await persistWebhookFailure(webhookRecord.id, error, reason);
		return {
			ok: true,
			result: {
				handled: true,
				fulfilled: false,
				blocked: true,
				retryable: error instanceof PaddleApiError && (error.isServerError || error.isTimeout),
				reason,
			},
		};
	}

	const subscriptionRecord = context.workspaceKey
		? await loadSubscriptionByWorkspace(context.workspaceKey)
		: null;
	const workspaceOk = await workspaceExists(context.workspaceKey);
	const packsCatalog = await listCreditPacks({ planId: subscriptionRecord?.plan || '' }).catch(() => ({ items: [] }));
	const packFromCatalog = packsCatalog.items.find((item) => item.id === context.packId) || null;

	const verified = verifyPaddleTransactionForCreditPack({
		transaction: apiTransaction,
		webhookContext: context,
		registryEntries,
		environment,
		workspaceExists: workspaceOk,
		packCatalogItem: packFromCatalog,
	});

	if (!verified.ok) {
		await persistWebhookFailure(webhookRecord.id, null, verified.error);
		await logBillingAction({
			action: 'Paddle credit pack verification failed',
			eventType: 'payment_failed',
			workspaceKey: context.workspaceKey,
			actor: 'webhook:paddle',
			provider: 'paddle',
			severity: 'warn',
			metadata: buildStructuredLog({
				event_id: parsed.idempotencyKey,
				event_type: parsed.eventType,
				transaction_id: context.transactionId,
				decision: 'blocked',
				reason: verified.error,
				price_id: context.priceId,
				pack_id: context.packId,
				environment,
			}),
		});
		return {
			ok: true,
			result: {
				handled: true,
				fulfilled: false,
				blocked: true,
				reason: verified.error,
				priceValidation: verified,
			},
		};
	}

	const idempotencyKey = buildPaddleCreditPackIdempotencyKey(verified.transactionId);
	const fulfillmentKind = classifyPaddleCreditPackFulfillment({ verified });

	if (fulfillmentKind.kind === 'blocked') {
		await persistWebhookFailure(webhookRecord.id, null, fulfillmentKind.reason);
		return { ok: true, result: { handled: true, fulfilled: false, blocked: true, reason: fulfillmentKind.reason } };
	}

	const result = await fulfillCreditPackPurchase({
		workspaceKey: verified.workspaceKey,
		pack: verified.pack,
		idempotencyKey,
		provider: 'paddle',
		actor: 'webhook:paddle',
		paymentRef: verified.transactionId,
	});

	if (result.duplicate) {
		await updateWebhookEvent(webhookRecord.id, { status: 'duplicate', error: 'transaction_already_fulfilled' });
		return { ok: true, result: { ok: true, duplicate: true, fulfilled: false, reason: 'transaction_already_fulfilled' } };
	}

	await updateWebhookEvent(webhookRecord.id, {
		status: 'processed',
		workspace_key: verified.workspaceKey,
		transaction_id: verified.transactionId,
		error: '',
	});

	await logBillingAction({
		action: 'Paddle credit pack fulfilled',
		eventType: 'credits_purchased',
		workspaceKey: verified.workspaceKey,
		actor: 'webhook:paddle',
		provider: 'paddle',
		credits: verified.credits,
		idempotencyKey,
		metadata: buildStructuredLog({
			event_id: parsed.idempotencyKey,
			event_type: parsed.eventType,
			transaction_id: verified.transactionId,
			pack_id: verified.packId,
			price_id: verified.priceId,
			environment,
			decision: 'fulfill',
			result,
		}),
	});

	return { ok: true, result: { ...result, handled: true, verified: true, fulfilled: true } };
}

async function handlePaddleCancelEvent({ config, parsed, webhookRecord, fetchImpl }) {
	const context = parsed.context || extractPaddleWebhookContext(parsed.payload);
	const envResult = deriveEffectivePaddleEnvironment(config);
	if (!envResult.ok) {
		await persistWebhookFailure(webhookRecord.id, null, envResult.error);
		return { ok: true, result: { handled: false, activated: false, reason: envResult.error } };
	}

	let cancelAtPeriodEnd = true;
	let paddleSubscriptionId = context.subscriptionId;

	if (context.subscriptionId) {
		try {
			const apiSub = await getPaddleSubscription(context.subscriptionId, {
				environment: envResult.environment,
				config,
				fetchImpl,
			});
			const subCheck = verifyPaddleSubscriptionForCancellation(apiSub);
			if (!subCheck.ok) {
				await persistWebhookFailure(webhookRecord.id, null, subCheck.error);
				return { ok: true, result: { handled: false, activated: false, reason: subCheck.error } };
			}
			cancelAtPeriodEnd = subCheck.cancelAtPeriodEnd || !subCheck.immediate;
			if (subCheck.immediate) cancelAtPeriodEnd = false;
			paddleSubscriptionId = String(apiSub.id || context.subscriptionId).trim();
		} catch (error) {
			await persistWebhookFailure(webhookRecord.id, error, 'paddle_subscription_api_failed');
			return {
				ok: true,
				result: {
					handled: false,
					activated: false,
					retryable: error instanceof PaddleApiError && (error.isServerError || error.isTimeout),
					reason: 'paddle_subscription_api_failed',
				},
			};
		}
	} else {
		await updateWebhookEvent(webhookRecord.id, {
			status: 'failed',
			error: 'paddle_cancellation_missing_subscription_id',
		});
		return {
			ok: true,
			result: { handled: false, activated: false, reason: 'paddle_cancellation_missing_subscription_id' },
		};
	}

	const result = await handlePaddleCancellation({
		paddleSubscriptionId,
		cancelAtPeriodEnd,
		eventId: parsed.idempotencyKey,
		workspaceKey: context.workspaceKey,
	});

	await updateWebhookEvent(webhookRecord.id, {
		status: result.handled ? 'processed' : 'failed',
		subscription_id: paddleSubscriptionId,
		workspace_key: result.workspaceKey || context.workspaceKey || '',
		error: result.error || '',
	});

	return { ok: true, result: { ...result, handled: result.handled, activated: false } };
}

async function handlePaddleSubscriptionUpdatedEvent(args = {}) {
	const paddleConfig = args.config || {};
	return runPaddleSubscriptionUpdatedHandler({
		...args,
		deps: {
			updateWebhookEvent,
			loadSubscriptionByWorkspace,
			loadSubscriptionByPaddleId,
			fetchAndVerifyPaddleSubscriptionForReconciliation,
			reconcilePaddleSubscription,
			loadRegistryEntries: (options) => loadRegistryEntries({
				...options,
				config: options?.config || paddleConfig,
			}),
			loadPlan: loadPlanRecord,
			updateSubscription: (id, patch) => pocketbaseClient.collection('workspace_subscriptions').update(id, patch),
			syncEntitlementMirrors,
			logBillingAction,
			...args.deps,
		},
	});
}

export { handlePaddleSubscriptionUpdatedEvent };

async function handlePaddleRefundAdjustmentEvent({ config, parsed, webhookRecord, fetchImpl }) {
	const webhookAdjustment = extractPaddleAdjustmentFromWebhook(parsed.payload);
	const context = parsed.context || extractPaddleWebhookContext(parsed.payload);
	const envResult = deriveEffectivePaddleEnvironment(config);
	if (!envResult.ok) {
		await persistWebhookFailure(webhookRecord.id, null, envResult.error);
		return { ok: true, result: { handled: false, refunded: false, reason: envResult.error } };
	}

	const environment = envResult.environment;
	let apiAdjustment;
	try {
		apiAdjustment = await getPaddleAdjustment(webhookAdjustment.adjustmentId, {
			environment,
			config,
			fetchImpl,
		});
	} catch (error) {
		const reason = error instanceof PaddleApiError ? error.code || error.message : 'paddle_api_error';
		await persistWebhookFailure(webhookRecord.id, error, reason);
		return {
			ok: true,
			result: {
				handled: false,
				refunded: false,
				retryable: error instanceof PaddleApiError && (error.isServerError || error.isTimeout),
				reason,
			},
		};
	}

	const adjustmentCheck = verifyPaddleAdjustmentForRefund({
		adjustment: apiAdjustment,
		webhookAdjustment,
	});
	if (!adjustmentCheck.ok) {
		await persistWebhookFailure(webhookRecord.id, null, adjustmentCheck.error);
		return { ok: true, result: { handled: false, refunded: false, reason: adjustmentCheck.error } };
	}

	let apiTransaction;
	try {
		apiTransaction = await getPaddleTransaction(adjustmentCheck.transactionId, {
			environment,
			config,
			fetchImpl,
		});
	} catch (error) {
		const reason = error instanceof PaddleApiError ? error.code || error.message : 'paddle_api_error';
		await persistWebhookFailure(webhookRecord.id, error, reason);
		return {
			ok: true,
			result: {
				handled: false,
				refunded: false,
				retryable: error instanceof PaddleApiError && (error.isServerError || error.isTimeout),
				reason,
			},
		};
	}

	const refundState = verifyPaddleTransactionRefundState(apiTransaction);
	if (!refundState.ok) {
		await persistWebhookFailure(webhookRecord.id, null, refundState.error);
		return { ok: true, result: { handled: false, refunded: false, reason: refundState.error } };
	}

	const registryEntries = await loadRegistryEntries({ environment, provider: 'paddle', config });
	const purchaseKind = classifyPaddleRefundPurchaseKind({
		transaction: apiTransaction,
		registryEntries,
		environment,
	});
	if (!purchaseKind.ok) {
		await persistWebhookFailure(webhookRecord.id, null, purchaseKind.error);
		return { ok: true, result: { handled: false, refunded: false, reason: purchaseKind.error } };
	}

	const subscriptionRecord = context.workspaceKey
		? await loadSubscriptionByWorkspace(context.workspaceKey)
		: null;

	const identity = verifyPaddleRefundWorkspaceIdentity({
		transaction: apiTransaction,
		webhookContext: context,
		subscriptionRecord,
		kind: purchaseKind.kind,
		subscriptionId: adjustmentCheck.subscriptionId || purchaseKind.subscriptionId,
	});
	if (!identity.ok) {
		await persistWebhookFailure(webhookRecord.id, null, identity.error);
		return { ok: true, result: { handled: false, refunded: false, reason: identity.error } };
	}

	const refundIdempotencyKey = buildPaddleRefundIdempotencyKey({
		adjustmentId: adjustmentCheck.adjustmentId,
		transactionId: adjustmentCheck.transactionId,
	});

	let result;
	if (purchaseKind.kind === 'credit_pack') {
		result = await clawbackCreditPackPurchase({
			workspaceKey: identity.workspaceKey,
			transactionId: adjustmentCheck.transactionId,
			idempotencyKey: refundIdempotencyKey,
			provider: 'paddle',
			actor: 'webhook:paddle',
			reason: `Paddle credit pack ${adjustmentCheck.action}`,
			eventId: parsed.idempotencyKey,
		});
		if (result.duplicate) {
			await updateWebhookEvent(webhookRecord.id, {
				status: 'duplicate',
				error: 'refund_already_processed',
				workspace_key: identity.workspaceKey,
				transaction_id: adjustmentCheck.transactionId,
			});
			return { ok: true, result: { ...result, handled: true, refunded: false, duplicate: true } };
		}
		if (!result.handled) {
			await updateWebhookEvent(webhookRecord.id, {
				status: 'failed',
				error: result.error || 'credit_pack_refund_failed',
				workspace_key: identity.workspaceKey,
				transaction_id: adjustmentCheck.transactionId,
			});
			return { ok: true, result: { ...result, handled: false, refunded: false } };
		}
	} else {
		result = await handleSubscriptionRefundPending({
			workspaceKey: identity.workspaceKey,
			provider: 'paddle',
			providerSubscriptionId: adjustmentCheck.subscriptionId || purchaseKind.subscriptionId || '',
			transactionId: adjustmentCheck.transactionId,
			eventId: parsed.idempotencyKey,
			idempotencyKey: refundIdempotencyKey,
			actor: 'webhook:paddle',
			reason: `Paddle subscription ${adjustmentCheck.action}`,
		});
		if (result.duplicate) {
			await updateWebhookEvent(webhookRecord.id, {
				status: 'duplicate',
				error: 'refund_already_processed',
				workspace_key: identity.workspaceKey,
				transaction_id: adjustmentCheck.transactionId,
				subscription_id: adjustmentCheck.subscriptionId || '',
			});
			return { ok: true, result: { ...result, handled: true, refunded: false, duplicate: true } };
		}
		if (!result.handled) {
			await updateWebhookEvent(webhookRecord.id, {
				status: 'failed',
				error: result.error || 'subscription_refund_failed',
				workspace_key: identity.workspaceKey,
				transaction_id: adjustmentCheck.transactionId,
				subscription_id: adjustmentCheck.subscriptionId || '',
			});
			return { ok: true, result: { ...result, handled: false, refunded: false } };
		}
	}

	await updateWebhookEvent(webhookRecord.id, {
		status: 'processed',
		workspace_key: identity.workspaceKey,
		transaction_id: adjustmentCheck.transactionId,
		subscription_id: adjustmentCheck.subscriptionId || purchaseKind.subscriptionId || '',
		error: '',
	});

	await logBillingAction({
		action: purchaseKind.kind === 'credit_pack'
			? 'Paddle credit pack refund processed'
			: 'Paddle subscription refund processed',
		eventType: purchaseKind.kind === 'credit_pack' ? 'credits_purchased' : 'cancelled',
		workspaceKey: identity.workspaceKey,
		actor: 'webhook:paddle',
		provider: 'paddle',
		idempotencyKey: refundIdempotencyKey,
		metadata: buildStructuredLog({
			event_id: parsed.idempotencyKey,
			event_type: parsed.eventType,
			adjustment_id: adjustmentCheck.adjustmentId,
			transaction_id: adjustmentCheck.transactionId,
			subscription_id: adjustmentCheck.subscriptionId || '',
			kind: purchaseKind.kind,
			action: adjustmentCheck.action,
			environment,
			result,
		}),
	});

	return { ok: true, result: { ...result, handled: true, refunded: true, verified: true } };
}

/**
 * Phase 2 Paddle webhook ingress — verified API state required before entitlement mutation.
 */
export async function handlePaddleBillingWebhook(req, { fetchImpl = fetch } = {}) {
	const billingConfig = await resolveBillingConfig();
	const paddleConfig = billingConfig.providers?.paddle || {};
	const provider = await getBillingProvider('paddle', { config: billingConfig });

	const verified = await provider.verifyWebhook(req).catch(() => ({ ok: false, error: 'verify_failed' }));
	if (!verified?.ok) {
		const error = new Error(verified?.error || 'Webhook signature verification failed');
		error.status = 401;
		error.errorCode = 'WEBHOOK_UNAUTHORIZED';
		throw error;
	}

	const parsed = await provider.parseWebhook(req);
	const eventId = String(parsed.idempotencyKey || '').slice(0, 180);
	if (!eventId) {
		return { ok: false, error: 'missing_event_id' };
	}

	const context = parsed.context || extractPaddleWebhookContext(parsed.payload);
	let webhookRecord = await findWebhookEvent({ provider: 'paddle', eventId });

	if (webhookRecord && isTerminalWebhookStatus(webhookRecord.status)) {
		await updateWebhookEvent(webhookRecord.id, { status: 'duplicate' }).catch(() => null);
		return { ok: true, duplicate: true, result: { handled: true, activated: false, duplicate: true } };
	}

	if (!webhookRecord) {
		webhookRecord = await createWebhookEvent({
			provider: 'paddle',
			eventId,
			eventType: parsed.eventType,
			transactionId: context.transactionId,
			subscriptionId: context.subscriptionId,
			workspaceKey: context.workspaceKey,
			status: 'received',
			payload: parsed.payload,
		});
	} else if (!canRetryWebhookEvent(webhookRecord)) {
		return { ok: true, duplicate: true, result: { handled: true, activated: false, duplicate: true } };
	}

	await updateWebhookEvent(webhookRecord.id, { status: 'processing' });

	const classification = classifyPaddleWebhookEvent(parsed.eventType);
	const routing = parsed.routing || classification.routing;

	try {
		if (routing === 'subscription_success') {
			return await handleVerifiedTransactionCompleted({
				req,
				config: paddleConfig,
				parsed,
				webhookRecord,
				fetchImpl,
			});
		}

		if (routing === 'credit_pack_success') {
			return await handleVerifiedCreditPackTransactionCompleted({
				config: paddleConfig,
				parsed,
				webhookRecord,
				fetchImpl,
			});
		}

		if (routing === 'payment_failed') {
			const result = await handlePaddlePaymentFailure({
				workspaceKey: context.workspaceKey,
				eventId,
				transactionId: context.transactionId,
				subscriptionId: context.subscriptionId,
				reason: parsed.routingReason || parsed.eventType,
				idempotencyKey: `paddle-fail:${eventId}`,
			});
			await updateWebhookEvent(webhookRecord.id, {
				status: 'processed',
				workspace_key: context.workspaceKey || '',
				transaction_id: context.transactionId || '',
				subscription_id: context.subscriptionId || '',
			});
			return { ok: true, result: { ...result, handled: true, activated: false } };
		}

		if (routing === 'cancel') {
			return await handlePaddleCancelEvent({
				config: paddleConfig,
				parsed,
				webhookRecord,
				fetchImpl,
			});
		}

		if (routing === 'subscription_reconcile') {
			return await handlePaddleSubscriptionUpdatedEvent({
				config: paddleConfig,
				parsed,
				webhookRecord,
				fetchImpl,
			});
		}

		if (routing === 'refund_adjustment') {
			return await handlePaddleRefundAdjustmentEvent({
				config: paddleConfig,
				parsed,
				webhookRecord,
				fetchImpl,
			});
		}

		await updateWebhookEvent(webhookRecord.id, {
			status: 'ignored',
			error: parsed.routingReason || classification.routingReason || '',
		});
		return {
			ok: true,
			result: {
				handled: true,
				activated: false,
				ignored: true,
				eventType: parsed.eventType,
				reason: parsed.routingReason || classification.routingReason,
			},
		};
	} catch (error) {
		await persistWebhookFailure(webhookRecord.id, error, 'paddle_webhook_processing_error');
		throw error;
	}
}

export { buildPaddleWebhookParseResult };
