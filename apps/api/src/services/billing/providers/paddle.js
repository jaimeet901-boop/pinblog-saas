import { BillingProvider, notImplemented } from './base.js';

/**
 * Paddle provider — creates transactions via Paddle Billing API when configured.
 * Requires PADDLE_API_KEY and a price id (config.priceIds[planSlug] or PADDLE_PRICE_<SLUG>).
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

	get apiKey() {
		return this.config?.apiKey || process.env.PADDLE_API_KEY || '';
	}

	resolvePriceId(planSlug) {
		const slug = String(planSlug || '').toLowerCase();
		const fromConfig = this.config?.priceIds?.[slug] || this.config?.prices?.[slug];
		if (fromConfig) return String(fromConfig);
		const envKey = `PADDLE_PRICE_${slug.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
		return process.env[envKey] || this.config?.defaultPriceId || process.env.PADDLE_DEFAULT_PRICE_ID || '';
	}

	async createSubscriptionCheckout(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'createSubscriptionCheckout');

		const priceId = this.resolvePriceId(input.planSlug);
		if (!priceId) {
			return {
				ready: true,
				provider: 'paddle',
				mode: 'subscription',
				checkoutUrl: null,
				message: `Paddle price id missing for plan "${input.planSlug}". Set providers.paddle.priceIds or PADDLE_PRICE_${String(input.planSlug || '').toUpperCase()}.`,
			};
		}

		const body = {
			items: [{ price_id: priceId, quantity: 1 }],
			custom_data: {
				workspaceKey: input.workspaceKey || '',
				planSlug: input.planSlug || '',
				planId: input.planId || '',
			},
		};
		if (input.customerEmail) {
			body.customer = { email: input.customerEmail };
		}
		if (input.successUrl) {
			body.checkout = {
				url: input.successUrl,
			};
		}

		const base = this.config?.sandbox || process.env.PADDLE_SANDBOX === '1'
			? 'https://sandbox-api.paddle.com'
			: 'https://api.paddle.com';
		const response = await fetch(`${base}/transactions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			return {
				ready: true,
				provider: 'paddle',
				mode: 'subscription',
				checkoutUrl: null,
				message: data?.error?.detail || data?.error?.documentation_url || `Paddle checkout failed (${response.status})`,
			};
		}

		const checkoutUrl = data?.data?.checkout?.url
			|| data?.data?.details?.checkout_url
			|| null;
		return {
			ready: true,
			provider: 'paddle',
			mode: 'subscription',
			sessionId: data?.data?.id || null,
			checkoutUrl,
			message: checkoutUrl ? 'Paddle checkout created' : 'Paddle transaction created without checkout URL',
			input: { workspaceKey: input.workspaceKey, planSlug: input.planSlug },
		};
	}

	async createCreditPackCheckout(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'createCreditPackCheckout');
		return {
			ready: true,
			provider: 'paddle',
			mode: 'payment',
			checkoutUrl: null,
			message: 'Paddle credit-pack checkout requires mapped price ids.',
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

	async verifyWebhook(req) {
		const bypass = process.env.BILLING_WEBHOOK_DEV_BYPASS === '1'
			&& process.env.NODE_ENV !== 'production';
		if (bypass) return { ok: true, bypass: true };
		const secret = this.config?.webhookSecret || process.env.PADDLE_WEBHOOK_SECRET || '';
		const signature = req.headers?.['paddle-signature'] || req.headers?.['Paddle-Signature'];
		if (!secret || !signature) {
			return { ok: false, error: 'paddle_webhook_unverified' };
		}
		return { ok: false, error: 'paddle_webhook_hmac_not_wired' };
	}
}
