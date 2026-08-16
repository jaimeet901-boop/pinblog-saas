/**
 * PR-09 — Paddle-only credit pack purchase helpers.
 * Gate on billing.provider + billing.checkoutEnabled (active runtime provider).
 * Do not use subscription.provider. Do not expose Stripe, Lemon, or PayPal Buy.
 */

export const CREDIT_PACKS_PATH = '/workspace/v1/credits/packs';

export const CREDIT_PACK_PURCHASE_PATH = '/workspace/v1/credits/packs/purchase';

export const CREDIT_PACK_CHECKOUT_SUCCESS_PATH = '/app/subscription?checkout=success';

export const CREDIT_PACK_CHECKOUT_CANCEL_PATH = '/app/subscription?checkout=cancel';

export const PAYPAL_CREDIT_PACK_UNAVAILABLE_MESSAGE = 'PayPal credit-pack checkout is not enabled in this milestone.';

function normalize(value) {
	return String(value || '').trim().toLowerCase();
}

export function resolveBillingProvider(billing) {
	return normalize(billing?.provider);
}

export function listCreditPackItems(creditPacks) {
	const items = Array.isArray(creditPacks?.items) ? creditPacks.items : [];
	return items.filter((pack) => {
		const id = String(pack?.id || '').trim();
		const credits = Number(pack?.credits) || 0;
		return Boolean(id) && credits > 0 && pack?.active !== false;
	});
}

export function canBuyCreditPack(billing) {
	if (!billing || typeof billing !== 'object') return false;
	if (resolveBillingProvider(billing) !== 'paddle') return false;
	return billing.checkoutEnabled === true;
}

export function creditPackPurchaseHiddenReason(billing) {
	const provider = resolveBillingProvider(billing);
	if (provider === 'stripe' || provider === 'lemonsqueezy') return 'hidden';
	if (provider === 'paypal') return 'paypal_stub';
	if (provider !== 'paddle') return 'unavailable';
	if (billing.checkoutEnabled !== true) return 'checkout_disabled';
	return '';
}

export function buildCreditPackPurchaseBody(packId, origin = '') {
	const id = String(packId || '').trim();
	const base = String(origin || '').replace(/\/$/, '');
	return {
		packId: id,
		successUrl: base ? `${base}${CREDIT_PACK_CHECKOUT_SUCCESS_PATH}` : '',
		cancelUrl: base ? `${base}${CREDIT_PACK_CHECKOUT_CANCEL_PATH}` : '',
	};
}

export function resolveCreditPackCheckoutUrl(payload = {}) {
	if (payload.status !== 'checkout_pending') {
		return { ok: false, reason: 'not_checkout_pending' };
	}
	const raw = String(payload.checkoutUrl || payload.checkout?.checkoutUrl || '').trim();
	if (!raw) {
		return { ok: false, reason: 'checkout_url_missing' };
	}
	try {
		const url = new URL(raw);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return { ok: false, reason: 'checkout_url_invalid' };
		}
		return { ok: true, checkoutUrl: url.href };
	} catch {
		return { ok: false, reason: 'checkout_url_invalid' };
	}
}

export function describeCreditPackPurchaseFailure(payload = {}) {
	if (payload.status === 'provider_required') {
		return payload.message || 'Connect a payment provider and enable checkout to sell credit packs.';
	}
	if (payload.status === 'checkout_pending') {
		return payload.checkout?.message
			|| payload.message
			|| 'Credit pack checkout could not be started. Please try again later.';
	}
	return payload.message || 'Credit pack checkout could not be started. Please try again later.';
}
