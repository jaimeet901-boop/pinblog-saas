import { BillingProvider, notImplemented } from './base.js';

/**
 * Stripe provider — creates Checkout Sessions via Stripe HTTP API when credentials exist.
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

	get secretKey() {
		return this.config?.secretKey || process.env.STRIPE_SECRET_KEY || '';
	}

	async createSubscriptionCheckout(input = {}) {
		if (!this.ready) throw notImplemented('stripe', 'createSubscriptionCheckout');

		const successUrl = String(input.successUrl || '').trim();
		const cancelUrl = String(input.cancelUrl || '').trim();
		if (!successUrl || !cancelUrl) {
			return {
				ready: true,
				provider: 'stripe',
				mode: 'subscription',
				checkoutUrl: null,
				message: 'successUrl and cancelUrl are required to create a Stripe Checkout Session.',
				input: { workspaceKey: input.workspaceKey, planSlug: input.planSlug },
			};
		}

		const amountCents = Math.max(0, Math.round((Number(input.monthlyPrice) || 0) * 100));
		if (amountCents <= 0) {
			return {
				ready: true,
				provider: 'stripe',
				mode: 'subscription',
				checkoutUrl: null,
				message: 'Stripe subscription checkout requires a positive monthly price.',
			};
		}

		const currency = String(input.currency || 'usd').toLowerCase();
		const params = new URLSearchParams();
		params.set('mode', 'subscription');
		params.set('success_url', successUrl.includes('{CHECKOUT_SESSION_ID}')
			? successUrl
			: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`);
		params.set('cancel_url', cancelUrl);
		params.set('client_reference_id', String(input.workspaceKey || '').slice(0, 200));
		params.set('line_items[0][quantity]', '1');
		params.set('line_items[0][price_data][currency]', currency);
		params.set('line_items[0][price_data][unit_amount]', String(amountCents));
		params.set('line_items[0][price_data][recurring][interval]', 'month');
		params.set('line_items[0][price_data][product_data][name]', String(input.planName || input.planSlug || 'Chef IA Plan').slice(0, 120));
		if (input.customerEmail) params.set('customer_email', String(input.customerEmail));

		const metadata = {
			workspaceKey: input.workspaceKey || '',
			planSlug: input.planSlug || '',
			planId: input.planId || '',
			...(input.metadata || {}),
		};
		Object.entries(metadata).forEach(([key, value]) => {
			if (value == null || value === '') return;
			params.set(`metadata[${key}]`, String(value).slice(0, 500));
			params.set(`subscription_data[metadata][${key}]`, String(value).slice(0, 500));
		});

		if (input.idempotencyKey) {
			params.set('metadata[idempotencyKey]', String(input.idempotencyKey).slice(0, 180));
		}

		const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.secretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				...(input.idempotencyKey
					? { 'Idempotency-Key': String(input.idempotencyKey).slice(0, 180) }
					: {}),
			},
			body: params,
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			return {
				ready: true,
				provider: 'stripe',
				mode: 'subscription',
				checkoutUrl: null,
				message: data?.error?.message || `Stripe Checkout failed (${response.status})`,
				error: data?.error || null,
			};
		}

		return {
			ready: true,
			provider: 'stripe',
			mode: 'subscription',
			sessionId: data.id || null,
			checkoutUrl: data.url || null,
			message: data.url ? 'Stripe Checkout Session created' : 'Stripe session created without URL',
			input: {
				workspaceKey: input.workspaceKey,
				planSlug: input.planSlug,
				idempotencyKey: input.idempotencyKey,
			},
		};
	}

	async createCreditPackCheckout(input = {}) {
		if (!this.ready) throw notImplemented('stripe', 'createCreditPackCheckout');

		const successUrl = String(input.successUrl || '').trim();
		const cancelUrl = String(input.cancelUrl || '').trim();
		const amountCents = Math.max(0, Math.round((Number(input.price) || 0) * 100));
		if (!successUrl || !cancelUrl || amountCents <= 0) {
			return {
				ready: true,
				provider: 'stripe',
				mode: 'payment',
				checkoutUrl: null,
				message: 'Stripe credit-pack checkout requires price, successUrl, and cancelUrl.',
			};
		}

		const params = new URLSearchParams();
		params.set('mode', 'payment');
		params.set('success_url', successUrl);
		params.set('cancel_url', cancelUrl);
		params.set('line_items[0][quantity]', '1');
		params.set('line_items[0][price_data][currency]', String(input.currency || 'usd').toLowerCase());
		params.set('line_items[0][price_data][unit_amount]', String(amountCents));
		params.set('line_items[0][price_data][product_data][name]', String(input.packId || 'Credit pack').slice(0, 120));
		if (input.customerEmail) params.set('customer_email', String(input.customerEmail));
		params.set('metadata[workspaceKey]', String(input.workspaceKey || ''));
		params.set('metadata[packId]', String(input.packId || ''));
		if (input.metadata?.pack) {
			params.set('metadata[pack]', JSON.stringify(input.metadata.pack).slice(0, 500));
		}

		const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.secretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				...(input.idempotencyKey
					? { 'Idempotency-Key': String(input.idempotencyKey).slice(0, 180) }
					: {}),
			},
			body: params,
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			return {
				ready: true,
				provider: 'stripe',
				mode: 'payment',
				checkoutUrl: null,
				message: data?.error?.message || `Stripe Checkout failed (${response.status})`,
			};
		}
		return {
			ready: true,
			provider: 'stripe',
			mode: 'payment',
			sessionId: data.id || null,
			checkoutUrl: data.url || null,
			message: data.url ? 'Stripe credit-pack Checkout Session created' : 'Stripe session created without URL',
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
		const eventId = req.body?.id
			|| (req.headers?.['stripe-signature']
				? `stripe-sig-${String(req.headers['stripe-signature']).slice(0, 32)}`
				: `stripe-${Date.now()}`);
		return {
			idempotencyKey: eventId,
			eventType: req.body?.type || 'stripe.unknown',
			payload: req.body || {},
		};
	}

	async verifyWebhook(req) {
		const bypass = process.env.BILLING_WEBHOOK_DEV_BYPASS === '1'
			&& process.env.NODE_ENV !== 'production';
		if (bypass) return { ok: true, bypass: true };

		const secret = this.config?.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || '';
		const signature = req.headers?.['stripe-signature'] || req.headers?.['Stripe-Signature'];
		if (!secret) return { ok: false, error: 'stripe_webhook_secret_missing' };
		if (!signature) return { ok: false, error: 'stripe_signature_missing' };

		try {
			const Stripe = (await import('stripe')).default;
			const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || this.config?.secretKey || 'sk_unused');
			const raw = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
			stripe.webhooks.constructEvent(raw, signature, secret);
			return { ok: true };
		} catch (error) {
			// Prefer SDK verification when available; otherwise require signature header presence only in non-prod is unsafe.
			if (String(error?.message || '').includes('Cannot find package') || error?.code === 'ERR_MODULE_NOT_FOUND') {
				return { ok: false, error: 'stripe_sdk_required_for_webhook_verification' };
			}
			return { ok: false, error: error?.message || 'stripe_signature_invalid' };
		}
	}
}
