import test from 'node:test';
import assert from 'node:assert/strict';
import {
	PayPalBillingProvider,
	resolvePayPalApiBase,
	encodePayPalCustomId,
	decodePayPalCustomId,
} from './paypal.js';

const originalFetch = global.fetch;

function mockFetch(handler) {
	global.fetch = async (url, options = {}) => handler(url, options);
}

function restoreFetch() {
	global.fetch = originalFetch;
}

test('PayPal provider instantiates from valid configuration', () => {
	const provider = new PayPalBillingProvider({
		clientId: 'client_test',
		clientSecret: 'secret_test',
		webhookId: 'wh_test',
		mode: 'test',
	});
	assert.equal(provider.ready, true);
	assert.equal(provider.displayName, 'PayPal');
});

test('resolvePayPalApiBase selects sandbox and live URLs', () => {
	assert.equal(resolvePayPalApiBase('sandbox'), 'https://api-m.sandbox.paypal.com');
	assert.equal(resolvePayPalApiBase('test'), 'https://api-m.sandbox.paypal.com');
	assert.equal(resolvePayPalApiBase('live'), 'https://api-m.paypal.com');
});

test('missing credentials fail safely for checkout', async () => {
	const provider = new PayPalBillingProvider({});
	assert.equal(provider.ready, false);
	await assert.rejects(
		() => provider.createSubscriptionCheckout({ workspaceKey: 'ws_1', planSlug: 'starter' }),
		(error) => error.code === 'PROVIDER_NOT_IMPLEMENTED',
	);
});

test('OAuth token request uses client credentials', async () => {
	const provider = new PayPalBillingProvider({
		clientId: 'client_test',
		clientSecret: 'secret_test',
		mode: 'sandbox',
		planIds: { starter: 'P-PLAN-STARTER' },
	});

	let tokenRequest = null;
	mockFetch(async (url, options) => {
		if (String(url).endsWith('/v1/oauth2/token')) {
			tokenRequest = { url, options };
			return {
				ok: true,
				status: 200,
				json: async () => ({ access_token: 'token_abc', token_type: 'Bearer' }),
			};
		}
		if (String(url).endsWith('/v1/billing/subscriptions')) {
			return {
				ok: true,
				status: 201,
				json: async () => ({
					id: 'I-SUB-123',
					links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-123' }],
				}),
			};
		}
		throw new Error(`Unexpected fetch: ${url}`);
	});

	try {
		const result = await provider.createSubscriptionCheckout({
			workspaceKey: 'kitchen-dev',
			planSlug: 'starter',
			successUrl: 'https://example.com/success',
			cancelUrl: 'https://example.com/cancel',
		});

		assert.ok(tokenRequest);
		assert.match(tokenRequest.url, /sandbox\.paypal\.com\/v1\/oauth2\/token$/);
		assert.equal(tokenRequest.options.method, 'POST');
		assert.equal(tokenRequest.options.body, 'grant_type=client_credentials');
		assert.match(tokenRequest.options.headers.Authorization, /^Basic /);
		assert.equal(result.checkoutUrl, 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-123');
	} finally {
		restoreFetch();
	}
});

test('checkout request contains workspaceKey and planSlug metadata', async () => {
	const provider = new PayPalBillingProvider({
		clientId: 'client_test',
		clientSecret: 'secret_test',
		mode: 'sandbox',
		planIds: { pro: 'P-PLAN-PRO' },
	});

	let subscriptionBody = null;
	mockFetch(async (url, options) => {
		if (String(url).endsWith('/v1/oauth2/token')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ access_token: 'token_abc' }),
			};
		}
		if (String(url).endsWith('/v1/billing/subscriptions')) {
			subscriptionBody = JSON.parse(options.body);
			return {
				ok: true,
				status: 201,
				json: async () => ({
					id: 'I-SUB-456',
					links: [{ rel: 'approve', href: 'https://approve.example/sub' }],
				}),
			};
		}
		throw new Error(`Unexpected fetch: ${url}`);
	});

	try {
		await provider.createSubscriptionCheckout({
			workspaceKey: 'ws_alpha',
			planSlug: 'pro',
			successUrl: 'https://example.com/success',
			cancelUrl: 'https://example.com/cancel',
		});

		assert.equal(subscriptionBody.plan_id, 'P-PLAN-PRO');
		const decoded = decodePayPalCustomId(subscriptionBody.custom_id);
		assert.equal(decoded.workspaceKey, 'ws_alpha');
		assert.equal(decoded.planSlug, 'pro');
	} finally {
		restoreFetch();
	}
});

test('invalid webhook verification fails closed', async () => {
	const provider = new PayPalBillingProvider({
		clientId: 'client_test',
		clientSecret: 'secret_test',
		webhookId: 'wh_test',
		mode: 'sandbox',
	});

	mockFetch(async (url) => {
		if (String(url).endsWith('/v1/oauth2/token')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ access_token: 'token_abc' }),
			};
		}
		if (String(url).endsWith('/v1/notifications/verify-webhook-signature')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ verification_status: 'FAILURE' }),
			};
		}
		throw new Error(`Unexpected fetch: ${url}`);
	});

	try {
		const result = await provider.verifyWebhook({
			headers: {
				'paypal-transmission-id': 'tx-1',
				'paypal-transmission-time': '2026-01-01T00:00:00Z',
				'paypal-transmission-sig': 'sig',
				'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
				'paypal-auth-algo': 'SHA256withRSA',
			},
			body: {
				id: 'WH-1',
				event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
				resource: { id: 'I-SUB', custom_id: encodePayPalCustomId('ws_1', 'starter') },
			},
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paypal_webhook_signature_invalid');
	} finally {
		restoreFetch();
	}
});

test('valid webhook verification succeeds with mocked PayPal response', async () => {
	const provider = new PayPalBillingProvider({
		clientId: 'client_test',
		clientSecret: 'secret_test',
		webhookId: 'wh_test',
		mode: 'sandbox',
	});

	mockFetch(async (url) => {
		if (String(url).endsWith('/v1/oauth2/token')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ access_token: 'token_abc' }),
			};
		}
		if (String(url).endsWith('/v1/notifications/verify-webhook-signature')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ verification_status: 'SUCCESS' }),
			};
		}
		throw new Error(`Unexpected fetch: ${url}`);
	});

	try {
		const result = await provider.verifyWebhook({
			headers: {
				'paypal-transmission-id': 'tx-2',
				'paypal-transmission-time': '2026-01-01T00:00:00Z',
				'paypal-transmission-sig': 'sig',
				'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
				'paypal-auth-algo': 'SHA256withRSA',
			},
			body: {
				id: 'WH-2',
				event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
				resource: { id: 'I-SUB', custom_id: encodePayPalCustomId('ws_2', 'starter') },
			},
		});
		assert.equal(result.ok, true);
	} finally {
		restoreFetch();
	}
});

test('parseWebhook produces idempotencyKey, eventType, and payload', async () => {
	const provider = new PayPalBillingProvider({
		clientId: 'client_test',
		clientSecret: 'secret_test',
	});
	const body = {
		id: 'WH-EVENT-9',
		event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
		resource: {
			id: 'I-SUB-999',
			custom_id: encodePayPalCustomId('ws_event', 'pro'),
		},
	};
	const parsed = await provider.parseWebhook({ headers: {}, body });
	assert.equal(parsed.idempotencyKey, 'WH-EVENT-9');
	assert.equal(parsed.eventType, 'BILLING.SUBSCRIPTION.ACTIVATED');
	assert.equal(parsed.payload.workspaceKey, 'ws_event');
	assert.equal(parsed.payload.planSlug, 'pro');
	assert.equal(parsed.payload.data.object.id, 'I-SUB-999');
});

test('recognized PayPal lifecycle event types normalize in parseWebhook', async () => {
	const provider = new PayPalBillingProvider({ clientId: 'x', clientSecret: 'y' });
	const events = [
		'BILLING.SUBSCRIPTION.ACTIVATED',
		'BILLING.SUBSCRIPTION.CANCELLED',
		'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
		'PAYMENT.SALE.COMPLETED',
	];
	for (const eventType of events) {
		const parsed = await provider.parseWebhook({
			headers: {},
			body: {
				id: `WH-${eventType}`,
				event_type: eventType,
				resource: { id: 'I-SUB', custom_id: encodePayPalCustomId('ws', 'starter') },
			},
		});
		assert.equal(parsed.eventType, eventType);
		assert.equal(parsed.payload.workspaceKey, 'ws');
		assert.equal(parsed.payload.planSlug, 'starter');
	}
});

test('encodePayPalCustomId and decodePayPalCustomId round-trip', () => {
	const encoded = encodePayPalCustomId('workspace-key', 'starter');
	const decoded = decodePayPalCustomId(encoded);
	assert.equal(decoded.workspaceKey, 'workspace-key');
	assert.equal(decoded.planSlug, 'starter');
});
