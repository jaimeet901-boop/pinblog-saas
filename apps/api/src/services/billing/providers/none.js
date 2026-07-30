import { BillingProvider } from './base.js';

export class NoneBillingProvider extends BillingProvider {
	constructor(config = {}) {
		super('none', config);
	}

	get ready() {
		return false;
	}

	get displayName() {
		return 'None';
	}

	async createSubscriptionCheckout() {
		return {
			ready: false,
			provider: 'none',
			mode: 'subscription',
			message: 'No payment provider selected. Choose Stripe, Paddle, or LemonSqueezy in Billing Providers.',
		};
	}

	async createCreditPackCheckout() {
		return {
			ready: false,
			provider: 'none',
			mode: 'payment',
			message: 'No payment provider selected. PAYG checkouts are disabled.',
		};
	}

	async cancelSubscription() {
		return { ready: false, provider: 'none', cancelled: false, localOnly: true };
	}

	async resumeSubscription() {
		return { ready: false, provider: 'none', resumed: false, localOnly: true };
	}

	async changeSubscriptionPlan() {
		return { ready: false, provider: 'none', changed: false, localOnly: true };
	}

	async parseWebhook() {
		return {
			idempotencyKey: `none-${Date.now()}`,
			eventType: 'ignored',
			payload: { ignored: true },
		};
	}

	async verifyWebhook() {
		return { ok: true, provider: 'none' };
	}
}
