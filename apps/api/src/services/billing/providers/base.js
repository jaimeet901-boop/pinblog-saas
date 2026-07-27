/**
 * Billing provider contract — all providers implement this interface.
 * Concrete SDKs are not wired yet; methods return structured stubs / NotImplemented.
 */

export const BILLING_PROVIDERS = Object.freeze(['none', 'stripe', 'paddle', 'lemonsqueezy']);

export class BillingProviderError extends Error {
	constructor(message, { code = 'BILLING_ERROR', status = 502, details = null } = {}) {
		super(message);
		this.name = 'BillingProviderError';
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

export function notImplemented(provider, method) {
	const error = new BillingProviderError(
		`${provider} billing provider: ${method} is not connected yet`,
		{ code: 'PROVIDER_NOT_IMPLEMENTED', status: 501 },
	);
	error.provider = provider;
	error.method = method;
	return error;
}

/**
 * @typedef {object} CheckoutSessionInput
 * @property {string} workspaceKey
 * @property {string} [planSlug]
 * @property {string} [packId]
 * @property {string} [successUrl]
 * @property {string} [cancelUrl]
 * @property {string} [customerEmail]
 * @property {string} [idempotencyKey]
 * @property {object} [metadata]
 */

/**
 * @typedef {object} CheckoutSessionResult
 * @property {boolean} ready
 * @property {string} provider
 * @property {string} [checkoutUrl]
 * @property {string} [sessionId]
 * @property {string} mode subscription|payment
 * @property {string} [message]
 */

/**
 * Base class for payment providers.
 */
export class BillingProvider {
	constructor(code, config = {}) {
		this.code = code;
		this.config = config || {};
	}

	get ready() {
		return false;
	}

	get displayName() {
		return this.code;
	}

	async createSubscriptionCheckout(_input) {
		throw notImplemented(this.code, 'createSubscriptionCheckout');
	}

	async createCreditPackCheckout(_input) {
		throw notImplemented(this.code, 'createCreditPackCheckout');
	}

	async cancelSubscription(_input) {
		throw notImplemented(this.code, 'cancelSubscription');
	}

	async resumeSubscription(_input) {
		throw notImplemented(this.code, 'resumeSubscription');
	}

	async changeSubscriptionPlan(_input) {
		throw notImplemented(this.code, 'changeSubscriptionPlan');
	}

	/**
	 * Verify inbound webhook authenticity. Providers must fail closed when not verified.
	 * @returns {Promise<{ ok: boolean, error?: string, bypass?: boolean }>}
	 */
	async verifyWebhook(_req) {
		return { ok: false, error: 'webhook_verification_not_implemented' };
	}

	/**
	 * Verify and normalize an inbound webhook payload.
	 * @returns {Promise<{ idempotencyKey: string, eventType: string, payload: object }>}
	 */
	async parseWebhook(_req) {
		throw notImplemented(this.code, 'parseWebhook');
	}

	async retrievePayment(_paymentId) {
		throw notImplemented(this.code, 'retrievePayment');
	}

	describe() {
		return {
			code: this.code,
			name: this.displayName,
			ready: this.ready,
			checkoutEnabled: this.ready,
			capabilities: {
				subscriptions: true,
				creditPacks: true,
				webhooks: true,
				planChanges: true,
				cancellations: true,
			},
			message: this.ready
				? `${this.displayName} is configured`
				: `${this.displayName} interface is registered; connect credentials to enable checkout`,
		};
	}
}
