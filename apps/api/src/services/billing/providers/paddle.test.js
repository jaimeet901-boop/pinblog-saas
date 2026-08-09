/**
 * Paddle Billing provider — webhook security, routing, metadata, price safety.
 * Run: node --test src/services/billing/providers/paddle.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PaddleBillingProvider } from './paddle.js';
import {
	buildPaddleWebhookParseResult,
	classifyPaddleWebhookEvent,
	extractPaddleWebhookContext,
	parsePaddleSignatureHeader,
	resolveCheckoutPaddlePriceId,
	resolveExpectedPaddlePriceId,
	resolvePaddlePriceId,
	validatePaddlePriceForPlan,
	verifyPaddleWebhookSignature,
} from './paddle-webhook-helpers.js';
import { NoneBillingProvider } from './none.js';

const TEST_SECRET = 'pdl_test_secret_key_for_unit_tests_only';

function signPaddlePayload(rawBody, secret = TEST_SECRET, ts = Math.floor(Date.now() / 1000)) {
	const signedPayload = `${ts}:${rawBody}`;
	const h1 = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
	return { header: `ts=${ts};h1=${h1}`, ts, h1 };
}

function transactionCompletedFixture(overrides = {}) {
	const { data: dataOverrides = {}, ...restOverrides } = overrides;
	return {
		event_id: 'evt_01test_completed',
		event_type: 'transaction.completed',
		data: {
			id: 'txn_01test_completed',
			status: 'completed',
			subscription_id: 'sub_01test',
			custom_data: {
				workspaceKey: 'ws-kitchen',
				planSlug: 'pro',
				planId: 'plan_pro_id',
			},
			items: [{ price: { id: 'pri_pro_monthly' } }],
			...dataOverrides,
		},
		...restOverrides,
	};
}

const priceConfig = {
	priceIds: {
		starter: 'pri_starter_monthly',
		pro: 'pri_pro_monthly',
		business: 'pri_business_monthly',
		enterprise: 'pri_enterprise_monthly',
	},
	defaultPriceId: 'pri_starter_monthly',
};

describe('resolvePaddlePriceId', () => {
	it('resolves explicit starter mapping', () => {
		assert.equal(resolvePaddlePriceId('starter', priceConfig), 'pri_starter_monthly');
	});

	it('resolves explicit pro mapping', () => {
		assert.equal(resolvePaddlePriceId('pro', priceConfig), 'pri_pro_monthly');
	});

	it('resolves explicit business mapping', () => {
		assert.equal(resolvePaddlePriceId('business', priceConfig), 'pri_business_monthly');
	});

	it('resolves explicit enterprise mapping', () => {
		assert.equal(resolvePaddlePriceId('enterprise', priceConfig), 'pri_enterprise_monthly');
	});

	it('falls back to defaultPriceId when slug mapping is missing', () => {
		assert.equal(resolvePaddlePriceId('pro', { defaultPriceId: 'pri_starter_monthly' }), 'pri_starter_monthly');
	});

	it('resolveExpectedPaddlePriceId does not use default fallback', () => {
		assert.equal(resolveExpectedPaddlePriceId('pro', { defaultPriceId: 'pri_starter_monthly' }), '');
	});
});

describe('verifyPaddleWebhookSignature', () => {
	const rawBody = JSON.stringify(transactionCompletedFixture());

	it('accepts a valid signature', () => {
		const { header } = signPaddlePayload(rawBody);
		const result = verifyPaddleWebhookSignature({
			rawBody,
			signatureHeader: header,
			secret: TEST_SECRET,
		});
		assert.equal(result.ok, true);
	});

	it('rejects an invalid signature', () => {
		const { header } = signPaddlePayload(rawBody);
		const result = verifyPaddleWebhookSignature({
			rawBody,
			signatureHeader: header.replace(/h1=[^;]+$/, 'h1=deadbeef'),
			secret: TEST_SECRET,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_signature_invalid');
	});

	it('rejects missing signature header', () => {
		const result = verifyPaddleWebhookSignature({
			rawBody,
			signatureHeader: '',
			secret: TEST_SECRET,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_signature_malformed');
	});

	it('rejects malformed signature header', () => {
		const result = verifyPaddleWebhookSignature({
			rawBody,
			signatureHeader: 'not-a-valid-header',
			secret: TEST_SECRET,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_signature_malformed');
	});

	it('rejects missing raw body', () => {
		const { header } = signPaddlePayload(rawBody);
		const result = verifyPaddleWebhookSignature({
			rawBody: '',
			signatureHeader: header,
			secret: TEST_SECRET,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_webhook_raw_body_missing');
	});
});

describe('PaddleBillingProvider.verifyWebhook production bypass', () => {
	const originalNodeEnv = process.env.NODE_ENV;
	const originalBypass = process.env.BILLING_WEBHOOK_DEV_BYPASS;

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
		process.env.BILLING_WEBHOOK_DEV_BYPASS = originalBypass;
	});

	it('never bypasses verification in production', async () => {
		process.env.NODE_ENV = 'production';
		process.env.BILLING_WEBHOOK_DEV_BYPASS = '1';

		const provider = new PaddleBillingProvider({ webhookSecret: TEST_SECRET });
		const rawBody = JSON.stringify(transactionCompletedFixture());
		const { header } = signPaddlePayload(rawBody);

		const missingSignature = await provider.verifyWebhook({ rawBody, body: JSON.parse(rawBody), headers: {} });
		assert.equal(missingSignature.ok, false);

		const valid = await provider.verifyWebhook({
			rawBody,
			body: JSON.parse(rawBody),
			headers: { 'paddle-signature': header },
		});
		assert.equal(valid.ok, true);
		assert.equal(valid.bypass, undefined);
	});
});

describe('extractPaddleWebhookContext', () => {
	it('extracts data.custom_data fields', () => {
		const payload = transactionCompletedFixture();
		const context = extractPaddleWebhookContext(payload);
		assert.equal(context.workspaceKey, 'ws-kitchen');
		assert.equal(context.planSlug, 'pro');
		assert.equal(context.planId, 'plan_pro_id');
		assert.equal(context.transactionId, 'txn_01test_completed');
		assert.equal(context.subscriptionId, 'sub_01test');
		assert.equal(context.priceId, 'pri_pro_monthly');
		assert.equal(context.paymentRef, 'txn_01test_completed');
	});

	it('extracts subscription id from subscription events', () => {
		const context = extractPaddleWebhookContext({
			event_type: 'subscription.canceled',
			data: {
				id: 'sub_cancel_01',
				custom_data: { workspaceKey: 'ws-a', planSlug: 'starter' },
			},
		});
		assert.equal(context.subscriptionId, 'sub_cancel_01');
	});
});

describe('classifyPaddleWebhookEvent', () => {
	it('routes transaction.completed to subscription_success', () => {
		assert.equal(classifyPaddleWebhookEvent('transaction.completed').routing, 'subscription_success');
	});

	it('routes subscription.activated to ignored', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.activated').routing, 'ignored');
	});

	it('routes subscription.created to ignored', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.created').routing, 'ignored');
	});

	it('routes subscription.updated to ignored', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.updated').routing, 'ignored');
	});

	it('routes subscription.canceled to cancel', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.canceled').routing, 'cancel');
	});

	it('routes transaction.payment_failed to payment_failed', () => {
		assert.equal(classifyPaddleWebhookEvent('transaction.payment_failed').routing, 'payment_failed');
	});

	it('routes unknown events to ignored', () => {
		const result = classifyPaddleWebhookEvent('customer.created');
		assert.equal(result.routing, 'ignored');
		assert.match(result.routingReason, /unknown_paddle_event/);
	});
});

describe('buildPaddleWebhookParseResult', () => {
	it('marks transaction.completed as fulfillment with price validation', () => {
		const parsed = buildPaddleWebhookParseResult(transactionCompletedFixture(), priceConfig);
		assert.equal(parsed.routing, 'subscription_success');
		assert.equal(parsed.context.planSlug, 'pro');
		assert.equal(parsed.priceValidation?.ok, true);
		assert.equal(parsed.fulfillmentKey, 'paddle-txn:txn_01test_completed');
	});

	it('defers when custom_data is missing', () => {
		const parsed = buildPaddleWebhookParseResult(
			transactionCompletedFixture({
				data: {
					id: 'txn_01test_completed',
					status: 'completed',
					custom_data: {},
					items: [{ price: { id: 'pri_pro_monthly' } }],
				},
			}),
			priceConfig,
		);
		assert.equal(parsed.routing, 'deferred');
		assert.match(parsed.routingReason, /missing_workspace_or_plan_metadata/);
	});

	it('ignores non-completed transaction status', () => {
		const parsed = buildPaddleWebhookParseResult(
			transactionCompletedFixture({ data: { status: 'draft' } }),
			priceConfig,
		);
		assert.equal(parsed.routing, 'ignored');
	});
});

describe('validatePaddlePriceForPlan', () => {
	it('accepts Pro webhook price when mapping matches', () => {
		const result = validatePaddlePriceForPlan('pro', 'pri_pro_monthly', priceConfig);
		assert.equal(result.ok, true);
	});

	it('rejects Pro fulfillment when Starter price is present', () => {
		const result = validatePaddlePriceForPlan('pro', 'pri_starter_monthly', priceConfig);
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_price_plan_mismatch');
	});

	it('accepts Business webhook price when mapping matches', () => {
		const result = validatePaddlePriceForPlan('business', 'pri_business_monthly', priceConfig);
		assert.equal(result.ok, true);
	});

	it('accepts Enterprise webhook price when mapping matches', () => {
		const result = validatePaddlePriceForPlan('enterprise', 'pri_enterprise_monthly', priceConfig);
		assert.equal(result.ok, true);
	});

	it('fails safely when mapping is missing for a paid plan', () => {
		const result = validatePaddlePriceForPlan('pro', 'pri_pro_monthly', { defaultPriceId: 'pri_starter_monthly' });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_missing_price_mapping_for_pro');
	});
});

describe('parsePaddleSignatureHeader', () => {
	it('parses ts and h1 values', () => {
		const parsed = parsePaddleSignatureHeader('ts=1717000000;h1=abc123');
		assert.deepEqual(parsed, { ts: '1717000000', signatures: ['abc123'] });
	});

	it('returns null for malformed headers', () => {
		assert.equal(parsePaddleSignatureHeader('bad-header'), null);
	});
});

describe('cross-provider regression guard', () => {
	it('NoneBillingProvider webhook verification remains fail-closed', async () => {
		const provider = new NoneBillingProvider();
		const result = await provider.verifyWebhook({});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'none_provider_webhooks_disabled');
	});
});

describe('PaddleBillingProvider.parseWebhook', () => {
	it('returns provider routing metadata for transaction.completed', async () => {
		const provider = new PaddleBillingProvider(priceConfig);
		const parsed = await provider.parseWebhook({
			body: transactionCompletedFixture(),
		});
		assert.equal(parsed.routing, 'subscription_success');
		assert.equal(parsed.context.workspaceKey, 'ws-kitchen');
		assert.equal(parsed.priceValidation.ok, true);
	});

	it('blocks fulfillment metadata when Pro price does not match mapping', async () => {
		const provider = new PaddleBillingProvider(priceConfig);
		const parsed = await provider.parseWebhook({
			body: transactionCompletedFixture({
				data: {
					items: [{ price: { id: 'pri_starter_monthly' } }],
				},
			}),
		});
		assert.equal(parsed.routing, 'subscription_success');
		assert.equal(parsed.priceValidation.ok, false);
		assert.equal(parsed.priceValidation.error, 'paddle_price_plan_mismatch');
	});
});

describe('resolveCheckoutPaddlePriceId', () => {
	const fallbackOnly = { defaultPriceId: 'pri_starter_monthly' };

	it('resolves Starter with explicit starter price', () => {
		const result = resolveCheckoutPaddlePriceId('starter', priceConfig);
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_starter_monthly');
	});

	it('resolves Pro with explicit pro price', () => {
		const result = resolveCheckoutPaddlePriceId('pro', priceConfig);
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_pro_monthly');
	});

	it('resolves Business with explicit business price', () => {
		const result = resolveCheckoutPaddlePriceId('business', priceConfig);
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_business_monthly');
	});

	it('resolves Enterprise with explicit enterprise price', () => {
		const result = resolveCheckoutPaddlePriceId('enterprise', priceConfig);
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_enterprise_monthly');
	});

	it('fails Pro when mapping missing and defaultPriceId is Starter', () => {
		const result = resolveCheckoutPaddlePriceId('pro', fallbackOnly);
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_price_mapping_missing');
	});

	it('fails Business when mapping missing and defaultPriceId is Starter', () => {
		const result = resolveCheckoutPaddlePriceId('business', fallbackOnly);
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_price_mapping_missing');
	});

	it('fails Enterprise when mapping missing and defaultPriceId is Starter', () => {
		const result = resolveCheckoutPaddlePriceId('enterprise', fallbackOnly);
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_price_mapping_missing');
	});

	it('fails Starter when mapping missing and defaultPriceId exists', () => {
		const result = resolveCheckoutPaddlePriceId('starter', fallbackOnly);
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_price_mapping_missing');
	});

	it('does not use PADDLE_DEFAULT_PRICE_ID for missing paid-plan mapping', () => {
		const original = process.env.PADDLE_DEFAULT_PRICE_ID;
		process.env.PADDLE_DEFAULT_PRICE_ID = 'pri_starter_monthly';
		try {
			const result = resolveCheckoutPaddlePriceId('pro', {});
			assert.equal(result.ok, false);
			assert.equal(result.error, 'paddle_price_mapping_missing');
		} finally {
			if (original === undefined) delete process.env.PADDLE_DEFAULT_PRICE_ID;
			else process.env.PADDLE_DEFAULT_PRICE_ID = original;
		}
	});

	it('accepts explicit PADDLE_PRICE_PRO env mapping', () => {
		const original = process.env.PADDLE_PRICE_PRO;
		process.env.PADDLE_PRICE_PRO = 'pri_pro_env';
		try {
			const result = resolveCheckoutPaddlePriceId('pro', fallbackOnly);
			assert.equal(result.ok, true);
			assert.equal(result.priceId, 'pri_pro_env');
		} finally {
			if (original === undefined) delete process.env.PADDLE_PRICE_PRO;
			else process.env.PADDLE_PRICE_PRO = original;
		}
	});

	it('accepts explicit PADDLE_PRICE_BUSINESS env mapping', () => {
		const original = process.env.PADDLE_PRICE_BUSINESS;
		process.env.PADDLE_PRICE_BUSINESS = 'pri_business_env';
		try {
			const result = resolveCheckoutPaddlePriceId('business', fallbackOnly);
			assert.equal(result.ok, true);
			assert.equal(result.priceId, 'pri_business_env');
		} finally {
			if (original === undefined) delete process.env.PADDLE_PRICE_BUSINESS;
			else process.env.PADDLE_PRICE_BUSINESS = original;
		}
	});

	it('accepts explicit PADDLE_PRICE_ENTERPRISE env mapping', () => {
		const original = process.env.PADDLE_PRICE_ENTERPRISE;
		process.env.PADDLE_PRICE_ENTERPRISE = 'pri_enterprise_env';
		try {
			const result = resolveCheckoutPaddlePriceId('enterprise', fallbackOnly);
			assert.equal(result.ok, true);
			assert.equal(result.priceId, 'pri_enterprise_env');
		} finally {
			if (original === undefined) delete process.env.PADDLE_PRICE_ENTERPRISE;
			else process.env.PADDLE_PRICE_ENTERPRISE = original;
		}
	});

	it('rejects free plan slug for Paddle checkout resolution', () => {
		const result = resolveCheckoutPaddlePriceId('free', priceConfig);
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_invalid_plan_slug_for_checkout');
	});
});

describe('PaddleBillingProvider.createSubscriptionCheckout price isolation', () => {
	const originalFetch = globalThis.fetch;
	const checkoutInput = {
		planSlug: 'pro',
		workspaceKey: 'ws-test',
		planId: 'plan-pro',
		successUrl: 'https://example.com/success',
	};

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('does not call Paddle API when mapping is missing', async () => {
		let fetchCalled = false;
		globalThis.fetch = async () => {
			fetchCalled = true;
			return { ok: true, json: async () => ({}) };
		};

		const provider = new PaddleBillingProvider({
			apiKey: 'paddle_test_key',
			defaultPriceId: 'pri_starter_monthly',
		});
		const result = await provider.createSubscriptionCheckout(checkoutInput);

		assert.equal(fetchCalled, false);
		assert.equal(result.checkoutUrl, null);
		assert.equal(result.errorCode, 'paddle_price_mapping_missing');
	});

	it('does not return checkout URL when mapping is missing', async () => {
		const provider = new PaddleBillingProvider({
			apiKey: 'paddle_test_key',
			defaultPriceId: 'pri_starter_monthly',
		});
		const result = await provider.createSubscriptionCheckout({
			planSlug: 'enterprise',
			workspaceKey: 'ws-test',
		});
		assert.equal(result.checkoutUrl, null);
		assert.match(result.message, /temporarily unavailable/i);
	});

	it('creates transaction with explicit pro price when mapping exists', async () => {
		let capturedBody = null;
		globalThis.fetch = async (_url, opts) => {
			capturedBody = JSON.parse(opts.body);
			return {
				ok: true,
				json: async () => ({
					data: { id: 'txn_123', checkout: { url: 'https://checkout.paddle.test/session' } },
				}),
			};
		};

		const provider = new PaddleBillingProvider({
			apiKey: 'paddle_test_key',
			sandbox: true,
			priceIds: { pro: 'pri_pro_monthly' },
			defaultPriceId: 'pri_starter_monthly',
		});
		const result = await provider.createSubscriptionCheckout(checkoutInput);

		assert.equal(result.checkoutUrl, 'https://checkout.paddle.test/session');
		assert.equal(capturedBody.items[0].price_id, 'pri_pro_monthly');
		assert.equal(capturedBody.custom_data.planSlug, 'pro');
	});
});
