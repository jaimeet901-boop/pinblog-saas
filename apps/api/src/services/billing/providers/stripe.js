import { BillingProvider, notImplemented } from './base.js';

/**
 * Stripe provider interface (SDK not connected).
 * Wire STRIPE_SECRET_KEY / webhook secret when enabling production checkout.
 */
export class StripeBillingProvider extends BillingProvider {
	constructor(config = {}) {
		super('stripe', config);
	}

	get ready() {
		return Boolean(this.config?.secretKey || process.env.STRIPE_SECRET_KEY);
	}

	get displayName() {
		return 'Stripe';
	}

	async createSubscriptionCheckout(input = {}) {
		if (!this.ready) throw notImplemented('stripe', 'createSubscriptionCheckout');
		return {
			ready: true,
			provider: 'stripe',
			mode: 'subscription',
			sessionId: null,
			checkoutUrl: null,
			message: 'Stripe credentials detected but SDK checkout is not wired yet.',
			input: {
				workspaceKey: input.workspaceKey,
				planSlug: input.planSlug,
				idempotencyKey: input.idempotencyKey,
			},
		};
	}

	async createCreditPackCheckout(input = {}) {
		if (!this.ready) throw notImplemented('stripe', 'createCreditPackCheckout');
		return {
			ready: true,
			provider: 'stripe',
			mode: 'payment',
			sessionId: null,
			checkoutUrl: null,
			message: 'Stripe credentials detected but SDK credit-pack checkout is not wired yet.',
			input: {
				workspaceKey: input.workspaceKey,
				packId: input.packId,
				idempotencyKey: input.idempotencyKey,
			},
		};
	}

	async cancelSubscription(input = {}) {
		if (!this.ready) throw notImplemented('stripe', 'cancelSubscription');
		return { ready: true, provider: 'stripe', cancelled: false, localOnly: false, input };
	}

	async resumeSubscription(input = {}) {
		if (!this.ready) throw notImplemented('stripe', 'resumeSubscription');
		return { ready: true, provider: 'stripe', resumed: false, input };
	}

	async changeSubscriptionPlan(input = {}) {
		if (!this.ready) throw notImplemented('stripe', 'changeSubscriptionPlan');
		return { ready: true, provider: 'stripe', changed: false, input };
	}

	async parseWebhook(req) {
		const eventId = req.headers?.['stripe-signature']
			? `stripe-sig-${String(req.headers['stripe-signature']).slice(0, 32)}`
			: `stripe-${Date.now()}`;
		return {
			idempotencyKey: req.body?.id || eventId,
			eventType: req.body?.type || 'stripe.unknown',
			payload: req.body || {},
		};
	}
}
