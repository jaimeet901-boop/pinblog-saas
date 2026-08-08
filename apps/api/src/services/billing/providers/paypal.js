import { BillingProvider, notImplemented } from './base.js';

const PAYPAL_API_BASE = Object.freeze({
	sandbox: 'https://api-m.sandbox.paypal.com',
	live: 'https://api-m.paypal.com',
});

const HTTP_TIMEOUT_MS = 15000;

export function resolvePayPalApiBase(mode = 'sandbox') {
	const normalized = String(mode || '').trim().toLowerCase();
	if (normalized === 'live') return PAYPAL_API_BASE.live;
	return PAYPAL_API_BASE.sandbox;
}

export function encodePayPalCustomId(workspaceKey, planSlug) {
	const payload = {
		workspaceKey: String(workspaceKey || '').slice(0, 60),
		planSlug: String(planSlug || '').slice(0, 40).toLowerCase(),
	};
	const json = JSON.stringify(payload);
	if (json.length <= 127) return json;
	return `${payload.workspaceKey}|${payload.planSlug}`.slice(0, 127);
}

export function decodePayPalCustomId(customId = '') {
	const text = String(customId || '').trim();
	if (!text) return { workspaceKey: '', planSlug: '' };
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text);
			return {
				workspaceKey: String(parsed.workspaceKey || parsed.workspace_key || '').trim(),
				planSlug: String(parsed.planSlug || parsed.plan_slug || '').trim().toLowerCase(),
			};
		} catch {
			// fall through to delimiter format
		}
	}
	const [workspaceKey, planSlug] = text.split('|');
	return {
		workspaceKey: String(workspaceKey || '').trim(),
		planSlug: String(planSlug || '').trim().toLowerCase(),
	};
}

function headerValue(headers, name) {
	if (!headers) return '';
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
	return key ? String(headers[key] || '').trim() : '';
}

async function paypalFetch(url, options = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
	try {
		const response = await fetch(url, { ...options, signal: controller.signal });
		const data = await response.json().catch(() => ({}));
		return { response, data };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * PayPal provider — recurring subscriptions via PayPal Subscriptions API.
 * Requires mapped PayPal plan IDs (price mapping / providers.paypal.planIds).
 */
export class PayPalBillingProvider extends BillingProvider {
	constructor(config = {}) {
		super('paypal', config);
	}

	get ready() {
		return Boolean(this.clientId && this.clientSecret);
	}

	get displayName() {
		return 'PayPal';
	}

	get clientId() {
		return String(this.config?.clientId || process.env.PAYPAL_CLIENT_ID || '').trim();
	}

	get clientSecret() {
		return String(this.config?.clientSecret || process.env.PAYPAL_CLIENT_SECRET || '').trim();
	}

	get webhookId() {
		return String(this.config?.webhookId || process.env.PAYPAL_WEBHOOK_ID || '').trim();
	}

	get mode() {
		const raw = this.config?.mode || process.env.PAYPAL_MODE || 'sandbox';
		return String(raw).trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
	}

	get apiBase() {
		return resolvePayPalApiBase(this.mode);
	}

	resolvePlanId(planSlug) {
		const slug = String(planSlug || '').trim().toLowerCase();
		const fromConfig = this.config?.planIds?.[slug]
			|| this.config?.priceIds?.[slug]
			|| this.config?.plans?.[slug];
		if (fromConfig) return String(fromConfig).trim();
		const envKey = `PAYPAL_PLAN_${slug.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
		return String(process.env[envKey] || this.config?.defaultPlanId || process.env.PAYPAL_DEFAULT_PLAN_ID || '').trim();
	}

	async getAccessToken() {
		if (!this.ready) {
			throw notImplemented('paypal', 'getAccessToken');
		}
		const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
		const { response, data } = await paypalFetch(`${this.apiBase}/v1/oauth2/token`, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${credentials}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: 'grant_type=client_credentials',
		});
		if (!response.ok || !data?.access_token) {
			const error = new Error(data?.error_description || data?.message || `PayPal OAuth failed (${response.status})`);
			error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
			throw error;
		}
		return data.access_token;
	}

	async createSubscriptionCheckout(input = {}) {
		if (!this.ready) throw notImplemented('paypal', 'createSubscriptionCheckout');

		const successUrl = String(input.successUrl || '').trim();
		const cancelUrl = String(input.cancelUrl || '').trim();
		if (!successUrl || !cancelUrl) {
			return {
				ready: true,
				provider: 'paypal',
				mode: 'subscription',
				checkoutUrl: null,
				message: 'successUrl and cancelUrl are required to create a PayPal subscription.',
				input: { workspaceKey: input.workspaceKey, planSlug: input.planSlug },
			};
		}

		const planId = this.resolvePlanId(input.planSlug);
		if (!planId) {
			return {
				ready: true,
				provider: 'paypal',
				mode: 'subscription',
				checkoutUrl: null,
				message: `PayPal plan id missing for plan "${input.planSlug}". Set providers.paypal.planIds or price mapping.`,
			};
		}

		const customId = encodePayPalCustomId(input.workspaceKey, input.planSlug);
		const accessToken = await this.getAccessToken();
		const body = {
			plan_id: planId,
			custom_id: customId,
			application_context: {
				brand_name: String(input.planName || 'Subscription').slice(0, 127),
				user_action: 'SUBSCRIBE_NOW',
				return_url: successUrl,
				cancel_url: cancelUrl,
			},
		};
		if (input.customerEmail) {
			body.subscriber = { email_address: String(input.customerEmail).slice(0, 254) };
		}

		const { response, data } = await paypalFetch(`${this.apiBase}/v1/billing/subscriptions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
				...(input.idempotencyKey
					? { 'PayPal-Request-Id': String(input.idempotencyKey).slice(0, 108) }
					: {}),
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			return {
				ready: true,
				provider: 'paypal',
				mode: 'subscription',
				checkoutUrl: null,
				message: data?.message || data?.details?.[0]?.description || `PayPal subscription checkout failed (${response.status})`,
			};
		}

		const approveLink = Array.isArray(data?.links)
			? data.links.find((link) => String(link?.rel || '').toLowerCase() === 'approve')
			: null;
		const checkoutUrl = approveLink?.href || null;

		return {
			ready: true,
			provider: 'paypal',
			mode: 'subscription',
			sessionId: data?.id || null,
			checkoutUrl,
			message: checkoutUrl ? 'PayPal subscription approval URL created' : 'PayPal subscription created without approval URL',
			input: {
				workspaceKey: input.workspaceKey,
				planSlug: input.planSlug,
				idempotencyKey: input.idempotencyKey,
			},
		};
	}

	async createCreditPackCheckout(_input = {}) {
		if (!this.ready) throw notImplemented('paypal', 'createCreditPackCheckout');
		return {
			ready: true,
			provider: 'paypal',
			mode: 'payment',
			checkoutUrl: null,
			message: 'PayPal credit-pack checkout is not enabled in this milestone.',
		};
	}

	async cancelSubscription(input = {}) {
		if (!this.ready) throw notImplemented('paypal', 'cancelSubscription');
		const subscriptionId = String(input.subscriptionId || input.providerSubscriptionId || '').trim();
		if (!subscriptionId) {
			return {
				ready: true,
				provider: 'paypal',
				cancelled: false,
				message: 'providerSubscriptionId is required to cancel a PayPal subscription.',
			};
		}

		const accessToken = await this.getAccessToken();
		const { response, data } = await paypalFetch(
			`${this.apiBase}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify({ reason: String(input.reason || 'Customer requested cancellation').slice(0, 128) }),
			},
		);

		if (!response.ok) {
			return {
				ready: true,
				provider: 'paypal',
				cancelled: false,
				message: data?.message || `PayPal cancel subscription failed (${response.status})`,
			};
		}

		return {
			ready: true,
			provider: 'paypal',
			cancelled: true,
			localOnly: false,
			subscriptionId,
		};
	}

	async resumeSubscription(input = {}) {
		if (!this.ready) throw notImplemented('paypal', 'resumeSubscription');
		return { ready: true, provider: 'paypal', resumed: false, input };
	}

	async changeSubscriptionPlan(input = {}) {
		if (!this.ready) throw notImplemented('paypal', 'changeSubscriptionPlan');
		return { ready: true, provider: 'paypal', changed: false, input };
	}

	async retrievePayment(paymentId) {
		if (!this.ready) throw notImplemented('paypal', 'retrievePayment');
		const subscriptionId = String(paymentId || '').trim();
		if (!subscriptionId) {
			throw notImplemented('paypal', 'retrievePayment');
		}

		const accessToken = await this.getAccessToken();
		const { response, data } = await paypalFetch(
			`${this.apiBase}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: 'application/json',
				},
			},
		);

		if (!response.ok) {
			const error = new Error(data?.message || `PayPal subscription lookup failed (${response.status})`);
			error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
			throw error;
		}

		return {
			ready: true,
			provider: 'paypal',
			subscriptionId: data?.id || subscriptionId,
			status: data?.status || '',
			customId: data?.custom_id || '',
			planId: data?.plan_id || '',
			raw: data,
		};
	}

	normalizeWebhookPayload(body = {}) {
		const resource = body.resource || {};
		const customRaw = resource.custom_id
			|| resource.custom
			|| body.custom_id
			|| '';
		const decoded = decodePayPalCustomId(customRaw);
		const subscriptionId = String(
			resource.id
			|| resource.billing_agreement_id
			|| body.subscription_id
			|| '',
		).slice(0, 180);

		return {
			...body,
			workspaceKey: decoded.workspaceKey,
			planSlug: decoded.planSlug,
			metadata: {
				workspaceKey: decoded.workspaceKey,
				planSlug: decoded.planSlug,
			},
			data: {
				object: {
					id: subscriptionId,
					metadata: {
						workspaceKey: decoded.workspaceKey,
						planSlug: decoded.planSlug,
					},
				},
			},
		};
	}

	async parseWebhook(req) {
		const body = req.body && typeof req.body === 'object' ? req.body : {};
		const eventType = body.event_type || 'paypal.unknown';
		const idempotencyKey = String(
			body.id
			|| headerValue(req.headers, 'paypal-transmission-id')
			|| `paypal-${Date.now()}`,
		).slice(0, 180);

		return {
			idempotencyKey,
			eventType,
			payload: this.normalizeWebhookPayload(body),
		};
	}

	async verifyWebhook(req) {
		if (!this.ready || !this.webhookId) {
			return { ok: false, error: 'paypal_webhook_not_configured' };
		}

		const transmissionId = headerValue(req.headers, 'paypal-transmission-id');
		const transmissionTime = headerValue(req.headers, 'paypal-transmission-time');
		const transmissionSig = headerValue(req.headers, 'paypal-transmission-sig');
		const certUrl = headerValue(req.headers, 'paypal-cert-url');
		const authAlgo = headerValue(req.headers, 'paypal-auth-algo');

		if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
			return { ok: false, error: 'paypal_webhook_headers_missing' };
		}

		const webhookEvent = req.body && typeof req.body === 'object' ? req.body : null;
		if (!webhookEvent?.event_type) {
			return { ok: false, error: 'paypal_webhook_body_invalid' };
		}

		try {
			const accessToken = await this.getAccessToken();
			const { response, data } = await paypalFetch(`${this.apiBase}/v1/notifications/verify-webhook-signature`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify({
					auth_algo: authAlgo,
					cert_url: certUrl,
					transmission_id: transmissionId,
					transmission_sig: transmissionSig,
					transmission_time: transmissionTime,
					webhook_id: this.webhookId,
					webhook_event: webhookEvent,
				}),
			});

			if (!response.ok) {
				return { ok: false, error: 'paypal_webhook_verification_request_failed' };
			}

			const status = String(data?.verification_status || '').toUpperCase();
			if (status === 'SUCCESS') {
				return { ok: true };
			}

			return { ok: false, error: 'paypal_webhook_signature_invalid' };
		} catch {
			return { ok: false, error: 'paypal_webhook_verification_failed' };
		}
	}

	describe() {
		return {
			...super.describe(),
			capabilities: {
				subscriptions: true,
				creditPacks: false,
				webhooks: true,
				planChanges: false,
				cancellations: true,
			},
		};
	}
}
