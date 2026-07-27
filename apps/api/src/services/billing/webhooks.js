import { getBillingProvider, resolveBillingConfig } from './providers/index.js';
import { claimIdempotencyKey, completeIdempotency, failIdempotency } from './idempotency.js';
import { fulfillCreditPackPurchase } from './payg.js';
import { handleFailedPayment, renewSubscription } from './subscriptions.js';
import { logBillingAction } from './audit.js';

/**
 * Provider-agnostic webhook ingress with idempotency.
 */
export async function handleBillingWebhook(req, providerCode = '') {
	const config = await resolveBillingConfig();
	const code = providerCode || config.provider;
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
		const workspaceKey = payload.workspaceKey
			|| payload.metadata?.workspaceKey
			|| payload.data?.meta?.workspace_key
			|| '';

		let result = { handled: false, eventType };

		if (eventType.includes('payment_failed') || eventType.includes('invoice.payment_failed')) {
			if (workspaceKey) {
				result = await handleFailedPayment(workspaceKey, {
					actor: `webhook:${code}`,
					reason: eventType,
					idempotencyKey: `fail:${idempotencyKey}`,
				});
			}
		} else if (eventType.includes('invoice.paid') || eventType.includes('subscription_payment_success') || eventType.includes('subscription_renewed')) {
			if (workspaceKey) {
				result = await renewSubscription(workspaceKey, { actor: `webhook:${code}`, force: true });
			}
		} else if (eventType.includes('credit') || eventType.includes('order_created') || eventType.includes('checkout.session.completed')) {
			if (workspaceKey && (payload.pack || payload.metadata?.pack)) {
				result = await fulfillCreditPackPurchase({
					workspaceKey,
					pack: payload.pack || payload.metadata?.pack,
					idempotencyKey: `fulfill:${idempotencyKey}`,
					provider: code,
					paymentRef: payload.id || payload.data?.id || '',
				});
			} else {
				result = { handled: false, deferred: true, message: 'Webhook acknowledged; fulfillment mapping pending provider wiring.' };
			}
		} else {
			result = { handled: false, ignored: true, eventType };
		}

		await logBillingAction({
			action: `Webhook ${eventType}`,
			eventType: eventType.includes('payment_failed') ? 'payment_failed' : 'renewed',
			workspaceKey,
			actor: `webhook:${code}`,
			provider: code,
			idempotencyKey,
			metadata: { eventType, result },
		});
		await completeIdempotency(idem.record.id, result);
		return { ok: true, result };
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}
