import { getBillingProvider, resolveBillingConfig } from './providers/index.js';
import { claimIdempotencyKey, completeIdempotency, failIdempotency } from './idempotency.js';
import { fulfillCreditPackPurchase } from './payg.js';
import { fulfillSubscriptionPurchase, handleFailedPayment, renewSubscription } from './subscriptions.js';
import { logBillingAction } from './audit.js';
import { handlePaddleBillingWebhook } from './paddle-webhook-fulfillment.js';
import { handlePayPalBillingWebhook } from './paypal-webhook-fulfillment.js';

function extractWebhookContext(payload = {}) {
	const obj = payload.data?.object || payload.data?.attributes || payload.object || {};
	const meta = {
		...(payload.metadata || {}),
		...(obj.metadata || {}),
		...(payload.data?.custom_data || {}),
		...(payload.data?.meta?.custom_data || {}),
		...(payload.meta?.custom_data || {}),
	};
	const workspaceKey = String(
		payload.workspaceKey
		|| meta.workspaceKey
		|| meta.workspace_key
		|| payload.data?.meta?.workspace_key
		|| '',
	).trim();
	const planSlug = String(
		payload.planSlug
		|| meta.planSlug
		|| meta.plan_slug
		|| '',
	).trim().toLowerCase();
	const pack = payload.pack || meta.pack || null;
	const paymentRef = String(
		obj.id
		|| payload.id
		|| payload.data?.id
		|| '',
	).slice(0, 180);
	return { workspaceKey, planSlug, pack, paymentRef, meta, obj };
}

function isSubscriptionSuccessEvent(eventType) {
	const type = String(eventType || '').toLowerCase();
	return (
		type.includes('checkout.session.completed')
		|| type.includes('customer.subscription.created')
		|| type.includes('customer.subscription.updated')
		|| type.includes('subscription_created')
		|| type.includes('subscription_payment_success')
		|| type === 'subscription_created'
		|| type.includes('order_created')
		|| type.includes('billing.subscription.activated')
	);
}

function isCancelOrFailEvent(eventType) {
	const type = String(eventType || '').toLowerCase();
	return (
		type.includes('checkout.session.expired')
		|| type.includes('checkout.session.async_payment_failed')
		|| type.includes('customer.subscription.deleted')
		|| type.includes('subscription_cancelled')
		|| type.includes('subscription_canceled')
		|| type.includes('payment_failed')
		|| type.includes('invoice.payment_failed')
		|| type.includes('billing.subscription.cancelled')
		|| type.includes('billing.subscription.suspended')
		|| type.includes('billing.subscription.payment.failed')
	);
}

/**
 * Provider-agnostic webhook ingress with idempotency.
 * Paid plan activation happens ONLY from verified success events.
 */
export async function handleBillingWebhook(req, providerCode = '') {
	const config = await resolveBillingConfig();
	const code = providerCode || config.provider;

	if (code === 'paddle') {
		return handlePaddleBillingWebhook(req);
	}

	if (code === 'paypal') {
		return handlePayPalBillingWebhook(req);
	}

	const provider = await getBillingProvider(code);

	const verified = await provider.verifyWebhook(req).catch(() => ({ ok: false, error: 'verify_failed' }));
	if (!verified?.ok) {
		const error = new Error(verified?.error || 'Webhook signature verification failed');
		error.status = 401;
		error.errorCode = 'WEBHOOK_UNAUTHORIZED';
		throw error;
	}

	const parsed = await provider.parseWebhook(req);
	const idempotencyKey = String(parsed.idempotencyKey || '').slice(0, 180);
	if (!idempotencyKey) {
		return { ok: false, error: 'missing_idempotency_key' };
	}

	const idem = await claimIdempotencyKey({
		idempotencyKey: `webhook:${code}:${idempotencyKey}`,
		scope: 'webhook',
		provider: code,
		eventType: parsed.eventType,
		payload: parsed.payload,
	});
	if (idem.duplicate) {
		return { ok: true, duplicate: true, result: idem.result };
	}

	try {
		const eventType = String(parsed.eventType || '').toLowerCase();
		const payload = parsed.payload || {};
		const extracted = extractWebhookContext(payload);
		const providerContext = parsed.context && typeof parsed.context === 'object'
			? parsed.context
			: null;
		const workspaceKey = String(providerContext?.workspaceKey || extracted.workspaceKey || '').trim();
		const planSlug = String(providerContext?.planSlug || extracted.planSlug || '').trim().toLowerCase();
		const pack = extracted.pack || providerContext?.pack || null;
		const paymentRef = String(
			providerContext?.paymentRef
			|| extracted.paymentRef
			|| '',
		).slice(0, 180);

		let result = { handled: false, eventType };

		if (parsed.routing) {
			switch (parsed.routing) {
				case 'subscription_success': {
					if (parsed.priceValidation && parsed.priceValidation.ok === false) {
						result = {
							handled: true,
							activated: false,
							blocked: true,
							safety: 'paddle_price_plan_mismatch',
							reason: parsed.priceValidation.error,
							planSlug,
							workspaceKey,
							priceValidation: parsed.priceValidation,
						};
						break;
					}
					if (workspaceKey && planSlug) {
						const fulfillKey = String(parsed.fulfillmentKey || idempotencyKey).slice(0, 180);
						result = await fulfillSubscriptionPurchase({
							workspaceKey,
							planSlug,
							planId: providerContext?.planId || '',
							provider: code,
							idempotencyKey: `sub-fulfill:${fulfillKey}`,
							paymentRef,
							actor: `webhook:${code}`,
						});
					} else {
						result = {
							handled: false,
							deferred: true,
							activated: false,
							message: parsed.routingReason
								|| 'Webhook acknowledged; subscription fulfillment requires workspaceKey + planSlug metadata.',
						};
					}
					break;
				}
				case 'payment_failed':
					if (workspaceKey) {
						result = await handleFailedPayment(workspaceKey, {
							actor: `webhook:${code}`,
							reason: parsed.routingReason || eventType,
							idempotencyKey: `fail:${idempotencyKey}`,
						});
					} else {
						result = {
							handled: true,
							activated: false,
							ignored: true,
							reason: 'payment_failed_without_workspace',
						};
					}
					break;
				case 'cancel':
					result = {
						handled: true,
						activated: false,
						cancelled: true,
						eventType,
						reason: parsed.routingReason || eventType,
					};
					break;
				case 'deferred':
					result = {
						handled: false,
						deferred: true,
						activated: false,
						message: parsed.routingReason
							|| 'Webhook deferred; required metadata missing or invalid.',
					};
					break;
				default:
					result = {
						handled: false,
						ignored: true,
						activated: false,
						eventType,
						reason: parsed.routingReason || 'paddle_event_ignored',
					};
			}
		} else if (isCancelOrFailEvent(eventType)) {
			if (
				eventType.includes('payment_failed')
				|| eventType.includes('invoice.payment_failed')
				|| eventType.includes('billing.subscription.payment.failed')
			) {
				if (workspaceKey) {
					result = await handleFailedPayment(workspaceKey, {
						actor: `webhook:${code}`,
						reason: eventType,
						idempotencyKey: `fail:${idempotencyKey}`,
					});
				} else {
					result = { handled: true, activated: false, ignored: true, reason: 'payment_failed_without_workspace' };
				}
			} else {
				// Cancelled / expired checkout — never activate a plan.
				result = { handled: true, activated: false, cancelled: true, eventType };
			}
		} else if (
			eventType.includes('invoice.paid')
			|| eventType.includes('subscription_renewed')
			|| eventType.includes('payment.sale.completed')
		) {
			if (workspaceKey) {
				result = await renewSubscription(workspaceKey, { actor: `webhook:${code}`, force: true });
			}
		} else if (isSubscriptionSuccessEvent(eventType)) {
			if (workspaceKey && planSlug) {
				result = await fulfillSubscriptionPurchase({
					workspaceKey,
					planSlug,
					provider: code,
					idempotencyKey: `sub-fulfill:${idempotencyKey}`,
					paymentRef,
					actor: `webhook:${code}`,
				});
			} else if (workspaceKey && pack) {
				result = await fulfillCreditPackPurchase({
					workspaceKey,
					pack,
					idempotencyKey: `fulfill:${idempotencyKey}`,
					provider: code,
					paymentRef,
				});
			} else {
				result = {
					handled: false,
					deferred: true,
					activated: false,
					message: 'Webhook acknowledged; subscription fulfillment requires workspaceKey + planSlug metadata.',
				};
			}
		} else if (eventType.includes('credit')) {
			if (workspaceKey && pack) {
				result = await fulfillCreditPackPurchase({
					workspaceKey,
					pack,
					idempotencyKey: `fulfill:${idempotencyKey}`,
					provider: code,
					paymentRef,
				});
			} else {
				result = { handled: false, deferred: true, activated: false, message: 'Credit webhook missing pack metadata.' };
			}
		} else {
			result = { handled: false, ignored: true, activated: false, eventType };
		}

		await logBillingAction({
			action: `Webhook ${eventType}`,
			eventType: eventType.includes('payment_failed')
				? 'payment_failed'
				: (result?.fulfilled || result?.toPlan ? 'upgrade' : 'renewed'),
			workspaceKey,
			actor: `webhook:${code}`,
			provider: code,
			idempotencyKey,
			metadata: { eventType, result, planSlug },
		});
		await completeIdempotency(idem.record.id, result);
		return { ok: true, result };
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}
