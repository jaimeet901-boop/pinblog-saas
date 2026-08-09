import { decodePayPalCustomId } from './paypal.js';

export function extractPayPalWebhookContext(payload = {}) {
	const resource = payload.resource && typeof payload.resource === 'object'
		? payload.resource
		: {};
	const decoded = decodePayPalCustomId(
		resource.custom_id
		|| resource.custom
		|| payload.custom_id
		|| '',
	);

	const subscriptionId = String(
		resource.id
		|| resource.billing_agreement_id
		|| payload.subscription_id
		|| '',
	).trim().slice(0, 180);

	const saleId = String(
		resource.id
		|| resource.sale_id
		|| payload.sale_id
		|| '',
	).trim().slice(0, 180);

	return {
		workspaceKey: decoded.workspaceKey,
		planSlug: decoded.planSlug,
		subscriptionId,
		saleId,
		paymentRef: subscriptionId || saleId,
	};
}

/**
 * PayPal webhook routing — entitlement mutation only on verified activation, renewal, cancel, or failure paths.
 */
export function classifyPayPalWebhookEvent(eventType = '') {
	const type = String(eventType || '').trim().toUpperCase();

	if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
		return {
			routing: 'subscription_activation',
			routingReason: 'paypal_subscription_activated',
		};
	}

	if (type === 'PAYMENT.SALE.COMPLETED') {
		return {
			routing: 'subscription_renewal',
			routingReason: 'paypal_sale_completed',
		};
	}

	if (type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
		return {
			routing: 'cancel',
			routingReason: type.toLowerCase(),
		};
	}

	if (type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
		return {
			routing: 'payment_failed',
			routingReason: 'paypal_subscription_payment_failed',
		};
	}

	if (type === 'PAYMENT.SALE.REVERSED' || type === 'PAYMENT.SALE.REFUNDED') {
		return {
			routing: 'subscription_refund',
			routingReason: type.toLowerCase(),
		};
	}

	if (
		type === 'BILLING.SUBSCRIPTION.CREATED'
		|| type === 'BILLING.SUBSCRIPTION.UPDATED'
		|| type === 'BILLING.SUBSCRIPTION.RE-ACTIVATED'
	) {
		return {
			routing: 'ignored',
			routingReason: 'paypal_subscription_lifecycle_no_entitlement',
		};
	}

	return {
		routing: 'ignored',
		routingReason: 'paypal_event_unsupported',
	};
}

export function resolvePlanSlugFromPayPalPlanId(planId = '', planIds = {}) {
	const normalized = String(planId || '').trim();
	if (!normalized) return '';
	for (const [slug, mappedId] of Object.entries(planIds || {})) {
		if (String(mappedId || '').trim() === normalized) {
			return String(slug || '').trim().toLowerCase();
		}
	}
	return '';
}
