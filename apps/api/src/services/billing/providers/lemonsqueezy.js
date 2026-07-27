import { BillingProvider, notImplemented } from './base.js';

/**
 * Lemon Squeezy provider — creates checkouts when store + variant mapping exist.
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

	get apiKey() {
		return this.config?.apiKey || process.env.LEMONSQUEEZY_API_KEY || '';
	}

	get storeId() {
		return this.config?.storeId || process.env.LEMONSQUEEZY_STORE_ID || '';
	}

	resolveVariantId(planSlug) {
		const slug = String(planSlug || '').toLowerCase();
		const fromConfig = this.config?.variantIds?.[slug] || this.config?.variants?.[slug];
		if (fromConfig) return String(fromConfig);
		const envKey = `LEMONSQUEEZY_VARIANT_${slug.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
		return process.env[envKey] || this.config?.defaultVariantId || process.env.LEMONSQUEEZY_DEFAULT_VARIANT_ID || '';
	}

	async createSubscriptionCheckout(input = {}) {
		if (!this.ready) throw notImplemented('lemonsqueezy', 'createSubscriptionCheckout');

		const storeId = this.storeId;
		const variantId = this.resolveVariantId(input.planSlug);
		if (!storeId || !variantId) {
			return {
				ready: true,
				provider: 'lemonsqueezy',
				mode: 'subscription',
				checkoutUrl: null,
				message: !storeId
					? 'Lemon Squeezy store id missing (LEMONSQUEEZY_STORE_ID).'
					: `Lemon Squeezy variant id missing for plan "${input.planSlug}".`,
			};
		}

		const attributes = {
			checkout_data: {
				email: input.customerEmail || undefined,
				custom: {
					workspaceKey: input.workspaceKey || '',
					planSlug: input.planSlug || '',
					planId: input.planId || '',
				},
			},
			product_options: {
				redirect_url: input.successUrl || undefined,
			},
		};

		const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				Accept: 'application/vnd.api+json',
				'Content-Type': 'application/vnd.api+json',
			},
			body: JSON.stringify({
				data: {
					type: 'checkouts',
					attributes,
					relationships: {
						store: { data: { type: 'stores', id: String(storeId) } },
						variant: { data: { type: 'variants', id: String(variantId) } },
					},
				},
			}),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			return {
				ready: true,
				provider: 'lemonsqueezy',
				mode: 'subscription',
				checkoutUrl: null,
				message: data?.errors?.[0]?.detail || `Lemon Squeezy checkout failed (${response.status})`,
			};
		}

		const checkoutUrl = data?.data?.attributes?.url || null;
		return {
			ready: true,
			provider: 'lemonsqueezy',
			mode: 'subscription',
			sessionId: data?.data?.id || null,
			checkoutUrl,
			message: checkoutUrl ? 'Lemon Squeezy checkout created' : 'Lemon Squeezy checkout created without URL',
			input: { workspaceKey: input.workspaceKey, planSlug: input.planSlug },
		};
	}

	async createCreditPackCheckout(input = {}) {
		if (!this.ready) throw notImplemented('lemonsqueezy', 'createCreditPackCheckout');
		return {
			ready: true,
			provider: 'lemonsqueezy',
			mode: 'payment',
			checkoutUrl: null,
			message: 'Lemon Squeezy credit-pack checkout requires variant mapping.',
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
