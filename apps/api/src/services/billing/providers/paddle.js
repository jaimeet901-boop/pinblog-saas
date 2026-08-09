import { BillingProvider, notImplemented } from './base.js';
import {
	buildPaddleWebhookParseResult,
	normalizeCheckoutBillingInterval,
	resolveCheckoutPaddlePackPriceId,
	resolveCheckoutPaddlePriceId,
	resolvePaddlePriceId,
	verifyPaddleWebhookSignature,
} from './paddle-webhook-helpers.js';
import { getPaddleSubscription, getPaddleTransaction, cancelPaddleSubscriptionAtPeriodEnd, verifyPaddleCancelAtPeriodEndResponse, PaddleApiError } from './paddle-api-client.js';
import { deriveEffectivePaddleEnvironment } from './paddle-environment.js';
import { loadRegistryEntries } from '../price-registry-resolver.js';

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
		return resolvePaddlePriceId(planSlug, this.config);
	}

	getWebhookRawBody(req) {
		if (typeof req?.rawBody === 'string' && req.rawBody) {
			return req.rawBody;
		}
		if (Buffer.isBuffer(req?.body)) {
			return req.body.toString('utf8');
		}
		if (typeof req?.body === 'string' && req.body) {
			return req.body;
		}
		return '';
	}

	async createSubscriptionCheckout(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'createSubscriptionCheckout');

		const envResult = deriveEffectivePaddleEnvironment(this.config);
		const intervalResult = normalizeCheckoutBillingInterval(
			input.billingInterval ?? input.billing_interval,
			{ defaultToMonthly: true },
		);
		if (!intervalResult.ok) {
			return {
				ready: true,
				provider: 'paddle',
				mode: 'subscription',
				checkoutUrl: null,
				errorCode: intervalResult.error,
				message: 'Invalid billing interval for checkout.',
			};
		}
		const billingInterval = intervalResult.value;

		const runtime = envResult.ok
			? {
				registryEntries: await loadRegistryEntries({
					environment: envResult.environment,
					provider: 'paddle',
					config: this.config,
				}),
				environment: envResult.environment,
				interval: billingInterval,
			}
			: { interval: billingInterval };

		const resolved = resolveCheckoutPaddlePriceId(input.planSlug, this.config, runtime);
		if (!resolved.ok) {
			return {
				ready: true,
				provider: 'paddle',
				mode: 'subscription',
				checkoutUrl: null,
				errorCode: resolved.error,
				message: resolved.error === 'paddle_price_mapping_missing'
					? 'The selected plan is temporarily unavailable for checkout. Please try again later.'
					: 'This plan is not available for Paddle checkout.',
			};
		}

		const priceId = resolved.priceId;

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
			billingInterval,
			priceId,
			priceSource: resolved.source || 'legacy',
			message: checkoutUrl ? 'Paddle checkout created' : 'Paddle transaction created without checkout URL',
			input: { workspaceKey: input.workspaceKey, planSlug: input.planSlug, billingInterval },
		};
	}

	async createCreditPackCheckout(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'createCreditPackCheckout');

		const packId = String(input.packId || '').trim();
		const envResult = deriveEffectivePaddleEnvironment(this.config);
		const runtime = envResult.ok
			? {
				registryEntries: await loadRegistryEntries({
					environment: envResult.environment,
					provider: 'paddle',
					config: this.config,
				}),
				environment: envResult.environment,
			}
			: {};

		const resolved = resolveCheckoutPaddlePackPriceId(packId, this.config, runtime);
		if (!resolved.ok) {
			return {
				ready: true,
				provider: 'paddle',
				mode: 'payment',
				checkoutUrl: null,
				errorCode: resolved.error,
				message: resolved.error === 'paddle_pack_price_mapping_missing'
					? 'This credit pack is temporarily unavailable for checkout. Please try again later.'
					: 'Credit pack checkout is not available for Paddle.',
			};
		}

		const body = {
			items: [{ price_id: resolved.priceId, quantity: 1 }],
			custom_data: {
				workspaceKey: input.workspaceKey || '',
				packId,
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
				mode: 'payment',
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
			mode: 'payment',
			sessionId: data?.data?.id || null,
			checkoutUrl,
			message: checkoutUrl ? 'Paddle credit pack checkout created' : 'Paddle transaction created without checkout URL',
			input: { workspaceKey: input.workspaceKey, packId },
		};
	}

	async cancelSubscription(input = {}) {
		if (!this.ready) throw notImplemented('paddle', 'cancelSubscription');

		const atPeriodEnd = input.atPeriodEnd !== false;
		if (!atPeriodEnd) {
			const error = new Error('Paddle immediate cancellation is not supported');
			error.status = 422;
			error.errorCode = 'PADDLE_IMMEDIATE_CANCEL_UNSUPPORTED';
			throw error;
		}

		const subscriptionId = String(
			input.paddleSubscriptionId
			|| input.providerSubscriptionId
			|| input.subscriptionId
			|| '',
		).trim();
		if (!subscriptionId) {
			const error = new Error('Paddle subscription ID is required for cancellation');
			error.status = 422;
			error.errorCode = 'PADDLE_SUBSCRIPTION_ID_MISSING';
			throw error;
		}

		const envResult = deriveEffectivePaddleEnvironment(this.config);
		if (!envResult.ok) {
			throw new PaddleApiError(envResult.error || 'paddle_environment_unconfigured', {
				code: envResult.error || 'paddle_environment_unconfigured',
			});
		}

		const fetchImpl = input.fetchImpl || fetch;
		const apiSubscription = await cancelPaddleSubscriptionAtPeriodEnd(subscriptionId, {
			environment: envResult.environment,
			config: this.config,
			fetchImpl,
			effectiveFrom: 'next_billing_period',
		});

		const verified = verifyPaddleCancelAtPeriodEndResponse(apiSubscription);
		if (!verified.ok) {
			const error = new Error(verified.error || 'Paddle cancellation response invalid');
			error.status = 502;
			error.errorCode = 'PADDLE_CANCEL_RESPONSE_INVALID';
			throw error;
		}

		return {
			ready: true,
			provider: 'paddle',
			cancelled: true,
			localOnly: false,
			subscriptionId: verified.subscriptionId || subscriptionId,
			atPeriodEnd: true,
			effectiveAt: verified.effectiveAt,
		};
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
		const body = req?.body && typeof req.body === 'object' ? req.body : {};
		return buildPaddleWebhookParseResult(body, this.config);
	}

	async verifyWebhook(req) {
		const bypass = process.env.BILLING_WEBHOOK_DEV_BYPASS === '1'
			&& process.env.NODE_ENV !== 'production';
		if (bypass) return { ok: true, bypass: true };

		const secret = this.config?.webhookSecret || process.env.PADDLE_WEBHOOK_SECRET || '';
		const signature = req.headers?.['paddle-signature'] || req.headers?.['Paddle-Signature'];
		if (!secret) {
			return { ok: false, error: 'paddle_webhook_secret_missing' };
		}
		if (!signature) {
			return { ok: false, error: 'paddle_webhook_signature_missing' };
		}

		const rawBody = this.getWebhookRawBody(req);
		return verifyPaddleWebhookSignature({
			rawBody,
			signatureHeader: signature,
			secret,
		});
	}

	resolveEnvironment() {
		return deriveEffectivePaddleEnvironment(this.config);
	}

	async fetchTransaction(transactionId, options = {}) {
		const envResult = this.resolveEnvironment();
		if (!envResult.ok) throw new Error(envResult.error);
		return getPaddleTransaction(transactionId, {
			environment: envResult.environment,
			config: this.config,
			fetchImpl: options.fetchImpl,
		});
	}

	async fetchSubscription(subscriptionId, options = {}) {
		const envResult = this.resolveEnvironment();
		if (!envResult.ok) throw new Error(envResult.error);
		return getPaddleSubscription(subscriptionId, {
			environment: envResult.environment,
			config: this.config,
			fetchImpl: options.fetchImpl,
		});
	}
}
