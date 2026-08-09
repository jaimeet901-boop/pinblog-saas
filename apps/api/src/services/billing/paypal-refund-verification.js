import { decodePayPalCustomId } from './providers/paypal.js';

/** PayPal sale states indicating reversal/refund (Phase 4.2). */
export const PAYPAL_REVERSED_SALE_STATES = Object.freeze(['REVERSED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

export function verifyPayPalSaleReversedState(sale = {}) {
	const state = String(sale?.state || sale?.status || '').trim().toUpperCase();
	if (!state) return { ok: false, error: 'paypal_sale_state_missing' };
	if (!PAYPAL_REVERSED_SALE_STATES.includes(state)) {
		return { ok: false, error: 'paypal_sale_not_reversed', state };
	}
	return { ok: true, state };
}

export function extractPayPalRefundWebhookContext(payload = {}) {
	const resource = payload.resource && typeof payload.resource === 'object'
		? payload.resource
		: {};
	const decoded = decodePayPalCustomId(
		resource.custom_id
		|| resource.custom
		|| payload.custom_id
		|| '',
	);

	const saleId = String(
		resource.id
		|| resource.sale_id
		|| payload.sale_id
		|| '',
	).trim().slice(0, 180);

	const subscriptionId = String(
		resource.billing_agreement_id
		|| resource.subscription_id
		|| payload.subscription_id
		|| '',
	).trim().slice(0, 180);

	return {
		workspaceKey: decoded.workspaceKey,
		planSlug: decoded.planSlug,
		saleId,
		subscriptionId,
		paymentRef: saleId || subscriptionId,
	};
}

export function verifyPayPalSubscriptionRefundIdentity({
	sale = {},
	webhookContext = {},
	subscriptionRecord = null,
} = {}) {
	const saleId = String(sale.saleId || sale.id || webhookContext.saleId || '').trim();
	if (!saleId) return { ok: false, error: 'paypal_refund_sale_id_missing' };

	const billingAgreementId = String(
		sale.billingAgreementId
		|| sale.billing_agreement_id
		|| webhookContext.subscriptionId
		|| '',
	).trim();

	const workspaceKey = String(webhookContext.workspaceKey || '').trim();
	if (!workspaceKey) return { ok: false, error: 'paypal_refund_workspace_missing' };

	if (subscriptionRecord) {
		if (subscriptionRecord.workspace_key && subscriptionRecord.workspace_key !== workspaceKey) {
			return { ok: false, error: 'paypal_refund_workspace_subscription_mismatch' };
		}
		if (subscriptionRecord.provider === 'paypal'
			&& subscriptionRecord.provider_subscription_id
			&& billingAgreementId
			&& subscriptionRecord.provider_subscription_id !== billingAgreementId) {
			return { ok: false, error: 'paypal_refund_subscription_identity_mismatch' };
		}
	}

	return {
		ok: true,
		saleId,
		subscriptionId: billingAgreementId,
		workspaceKey,
	};
}

export function buildPayPalRefundIdempotencyKey({ saleId = '', refundId = '' } = {}) {
	const sale = String(saleId || '').trim();
	const refund = String(refundId || '').trim();
	if (sale && refund) return `paypal-refund:${sale}:${refund}`.slice(0, 180);
	if (sale) return `paypal-refund:sale:${sale}`.slice(0, 180);
	return '';
}
