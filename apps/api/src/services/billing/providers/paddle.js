import { BillingProvider, notImplemented } from './base.js';

/**
 * Paddle provider interface (SDK not connected).
 */
export class PaddleBillingProvider extends BillingProvider {
	constructor(config = {}) {
		super('paddle', config);
	}

	get ready() {
		return Boolean(this.config?.apiKey || process.env.PADDLE_API_KEY);
	}

	get displayName() {
		return 'Paddle';
	}

	async createSubscriptionCheckout(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'createSubscriptionCheckout');
		return {
			ready: true,
			provider: 'paddle',
			mode: 'subscription',
			checkoutUrl: null,
			message: 'Paddle credentials detected but checkout is not wired yet.',
			input,
		};
	}

	async createCreditPackCheckout(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'createCreditPackCheckout');
		return {
			ready: true,
			provider: 'paddle',
			mode: 'payment',
			checkoutUrl: null,
			message: 'Paddle credentials detected but credit-pack checkout is not wired yet.',
			input,
		};
	}

	async cancelSubscription(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'cancelSubscription');
		return { ready: true, provider: 'paddle', cancelled: false, input };
	}

	async resumeSubscription(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'resumeSubscription');
		return { ready: true, provider: 'paddle', resumed: false, input };
	}

	async changeSubscriptionPlan(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'changeSubscriptionPlan');
		return { ready: true, provider: 'paddle', changed: false, input };
	}

	async parseWebhook(req) {
		return {
			idempotencyKey: req.body?.event_id || req.body?.notification_id || `paddle-${Date.now()}`,
			eventType: req.body?.event_type || req.body?.alert_name || 'paddle.unknown',
			payload: req.body || {},
		};
	}
}
