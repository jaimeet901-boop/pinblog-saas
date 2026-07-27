import { BillingProvider, notImplemented } from './base.js';

/**
 * Lemon Squeezy provider interface (SDK not connected).
 */
export class LemonSqueezyBillingProvider extends BillingProvider {
	constructor(config = {}) {
		super('lemonsqueezy', config);
	}

	get ready() {
		return Boolean(this.config?.apiKey || process.env.LEMONSQUEEZY_API_KEY);
	}

	get displayName() {
		return 'Lemon Squeezy';
	}

	async createSubscriptionCheckout(input = {}) {
		if (!this.ready) throw notImplemented('lemonsqueezy', 'createSubscriptionCheckout');
		return {
			ready: true,
			provider: 'lemonsqueezy',
			mode: 'subscription',
			checkoutUrl: null,
			message: 'Lemon Squeezy credentials detected but checkout is not wired yet.',
			input,
		};
	}

	async createCreditPackCheckout(input = {}) {
		if (!this.ready) throw notImplemented('lemonsqueezy', 'createCreditPackCheckout');
		return {
			ready: true,
			provider: 'lemonsqueezy',
			mode: 'payment',
			checkoutUrl: null,
			message: 'Lemon Squeezy credentials detected but credit-pack checkout is not wired yet.',
			input,
		};
	}

	async cancelSubscription(input = {}) {
		if (!this.ready) throw notImplemented('lemonsqueezy', 'cancelSubscription');
		return { ready: true, provider: 'lemonsqueezy', cancelled: false, input };
	}

	async resumeSubscription(input = {}) {
		if (!this.ready) throw notImplemented('lemonsqueezy', 'resumeSubscription');
		return { ready: true, provider: 'lemonsqueezy', resumed: false, input };
	}

	async changeSubscriptionPlan(input = {}) {
		if (!this.ready) throw notImplemented('lemonsqueezy', 'changeSubscriptionPlan');
		return { ready: true, provider: 'lemonsqueezy', changed: false, input };
	}

	async parseWebhook(req) {
		return {
			idempotencyKey: req.body?.meta?.event_name
				? `${req.body.meta.event_name}-${req.body?.data?.id || Date.now()}`
				: `lemonsqueezy-${Date.now()}`,
			eventType: req.body?.meta?.event_name || 'lemonsqueezy.unknown',
			payload: req.body || {},
		};
	}

	async verifyWebhook(req) {
		const bypass = process.env.BILLING_WEBHOOK_DEV_BYPASS === '1'
			&& process.env.NODE_ENV !== 'production';
		if (bypass) return { ok: true, bypass: true };
		const secret = this.config?.webhookSecret || process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '';
		const signature = req.headers?.['x-signature'] || req.headers?.['X-Signature'];
		if (!secret || !signature) {
			return { ok: false, error: 'lemonsqueezy_webhook_unverified' };
		}
		return { ok: false, error: 'lemonsqueezy_webhook_hmac_not_wired' };
	}
}
