/**
 * Paddle Billing provider — webhook security, routing, metadata, price safety.
 * Run: node --test src/services/billing/providers/paddle.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PaddleBillingProvider } from './paddle.js';
import {
	buildPaddleWebhookParseResult,
	classifyPaddleWebhookEvent,
	extractPaddleWebhookContext,
	normalizeCheckoutBillingInterval,
	parsePaddleSignatureHeader,
	resolveCheckoutPaddlePriceId,
	resolveExpectedPaddlePriceId,
	resolveExpectedPaddlePriceIdForInterval,
	resolvePaddlePriceId,
	validatePaddlePriceForPlan,
	verifyPaddleWebhookSignature,
} from './paddle-webhook-helpers.js';
import { normalizeRegistryEntry } from '../price-registry.js';
import { NoneBillingProvider } from './none.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const helpersSource = readFileSync(join(__dirname, 'paddle-webhook-helpers.js'), 'utf8');
const fulfillmentSource = readFileSync(
	join(__dirname, '..', 'paddle-webhook-fulfillment.js'),
	'utf8',
);

function subscriptionUpdatedFixture(overrides = {}) {
	const { data: dataOverrides = {}, ...restOverrides } = overrides;
	return {
		event_id: 'evt_01test_sub_updated',
		event_type: 'subscription.updated',
		data: {
			id: 'sub_01test',
			status: 'active',
			custom_data: {
				workspaceKey: 'ws-kitchen',
				planSlug: 'pro',
			},
			items: [{ price: { id: 'pri_pro_monthly' } }],
			...dataOverrides,
		},
		...restOverrides,
	};
}

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

	it('accepts slightly delayed event within 300s tolerance', () => {
		const ts = Math.floor(Date.now() / 1000) - 120;
		const signedPayload = `${ts}:${rawBody}`;
		const h1 = crypto.createHmac('sha256', TEST_SECRET).update(signedPayload, 'utf8').digest('hex');
		const result = verifyPaddleWebhookSignature({
			rawBody,
			signatureHeader: `ts=${ts};h1=${h1}`,
			secret: TEST_SECRET,
			toleranceSeconds: 300,
		});
		assert.equal(result.ok, true);
	});

	it('rejects expired event beyond tolerance', () => {
		const ts = Math.floor(Date.now() / 1000) - 400;
		const signedPayload = `${ts}:${rawBody}`;
		const h1 = crypto.createHmac('sha256', TEST_SECRET).update(signedPayload, 'utf8').digest('hex');
		const result = verifyPaddleWebhookSignature({
			rawBody,
			signatureHeader: `ts=${ts};h1=${h1}`,
			secret: TEST_SECRET,
			toleranceSeconds: 300,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_webhook_timestamp_expired');
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

	it('routes subscription.updated to subscription_reconcile (Phase 4.4-B)', () => {
		const result = classifyPaddleWebhookEvent('subscription.updated');
		assert.equal(result.routing, 'subscription_reconcile');
		assert.equal(result.routingReason, 'subscription_updated_reconciliation');
	});

	it('routes subscription.canceled to cancel', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.canceled').routing, 'cancel');
	});

	it('routes adjustment.created to refund_adjustment (Phase 4.2)', () => {
		assert.equal(classifyPaddleWebhookEvent('adjustment.created').routing, 'refund_adjustment');
	});

	it('routes adjustment.updated to refund_adjustment (Phase 4.2)', () => {
		assert.equal(classifyPaddleWebhookEvent('adjustment.updated').routing, 'refund_adjustment');
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

describe('Phase 4.4-B subscription.updated reconciliation routing', () => {
	it('subscription.updated routes to subscription_reconcile', () => {
		const result = classifyPaddleWebhookEvent('subscription.updated');
		assert.equal(result.routing, 'subscription_reconcile');
		assert.equal(result.routingReason, 'subscription_updated_reconciliation');
	});

	it('subscription.updated no longer routes to ignored', () => {
		const result = classifyPaddleWebhookEvent('subscription.updated');
		assert.notEqual(result.routing, 'ignored');
	});

	it('buildPaddleWebhookParseResult preserves subscription_reconcile routing', () => {
		const parsed = buildPaddleWebhookParseResult(subscriptionUpdatedFixture());
		assert.equal(parsed.routing, 'subscription_reconcile');
		assert.equal(parsed.routingReason, 'subscription_updated_reconciliation');
		assert.equal(parsed.eventType, 'subscription.updated');
	});

	it('transaction.completed remains fulfillment (subscription_success)', () => {
		assert.equal(
			classifyPaddleWebhookEvent('transaction.completed').routing,
			'subscription_success',
		);
	});

	it('subscription.canceled remains cancellation routing', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.canceled').routing, 'cancel');
		assert.equal(classifyPaddleWebhookEvent('subscription.cancelled').routing, 'cancel');
	});

	it('adjustment refund routing remains unchanged', () => {
		assert.equal(classifyPaddleWebhookEvent('adjustment.created').routing, 'refund_adjustment');
		assert.equal(classifyPaddleWebhookEvent('adjustment.updated').routing, 'refund_adjustment');
	});

	it('unknown event routing remains unchanged', () => {
		const result = classifyPaddleWebhookEvent('customer.created');
		assert.equal(result.routing, 'ignored');
		assert.match(result.routingReason, /unknown_paddle_event/);
	});

	it('subscription.activated and subscription.created remain ignored (not reconcile)', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.activated').routing, 'ignored');
		assert.equal(classifyPaddleWebhookEvent('subscription.created').routing, 'ignored');
	});

	it('classifier does not reference activation or renewal handlers', () => {
		assert.equal(helpersSource.includes('activatePaddleSubscription'), false);
		assert.equal(helpersSource.includes('renewPaddleSubscription'), false);
	});

	it('fulfillment ingress registers subscription_reconcile handler (Phase 4.4-C)', () => {
		assert.match(fulfillmentSource, /routing === 'subscription_reconcile'/);
		assert.match(fulfillmentSource, /handlePaddleSubscriptionUpdatedEvent/);
		assert.match(fulfillmentSource, /paddle-subscription-updated-handler\.js/);
		assert.equal(fulfillmentSource.includes('reconcilePaddleSubscription'), true);
	});

	it('subscription_reconcile route is separate from subscription_success fulfillment', () => {
		const reconcile = classifyPaddleWebhookEvent('subscription.updated');
		const fulfill = classifyPaddleWebhookEvent('transaction.completed');
		assert.equal(reconcile.routing, 'subscription_reconcile');
		assert.equal(fulfill.routing, 'subscription_success');
		assert.notEqual(reconcile.routing, fulfill.routing);
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

describe('Phase 3.8 — yearly price key normalization', () => {
	const legacyConfigWithYearly = {
		priceIds: {
			pro: 'pri_pro_monthly',
			pro_yearly: 'pri_pro_yearly',
		},
	};

	const registryEntriesBoth = [
		normalizeRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			planSlug: 'pro',
			interval: 'monthly',
			priceId: 'pri_registry_pro_monthly',
		}),
		normalizeRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			planSlug: 'pro',
			interval: 'yearly',
			priceId: 'pri_registry_pro_yearly',
		}),
	];

	it('resolves monthly registry row when interval is monthly', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			registryEntries: registryEntriesBoth,
			environment: 'sandbox',
			interval: 'monthly',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_registry_pro_monthly');
		assert.equal(result.interval, 'monthly');
		assert.equal(result.source, 'registry');
	});

	it('resolves yearly registry row when interval is yearly', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			registryEntries: registryEntriesBoth,
			environment: 'sandbox',
			interval: 'yearly',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_registry_pro_yearly');
		assert.equal(result.interval, 'yearly');
		assert.equal(result.source, 'registry');
	});

	it('uses plan_slug pro not pro_yearly for yearly registry lookup', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			registryEntries: registryEntriesBoth,
			environment: 'sandbox',
			interval: 'yearly',
		});
		assert.equal(result.planSlug, 'pro');
		assert.equal(result.priceId, 'pri_registry_pro_yearly');
	});

	it('fails closed when registry authoritative but yearly row missing', () => {
		const monthlyOnlyRegistry = [registryEntriesBoth[0]];
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			registryEntries: monthlyOnlyRegistry,
			environment: 'sandbox',
			interval: 'yearly',
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_price_not_in_registry');
		assert.equal(result.interval, 'yearly');
	});

	it('legacy monthly fallback uses priceIds[planSlug]', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			interval: 'monthly',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_pro_monthly');
		assert.equal(result.source, 'legacy');
	});

	it('legacy yearly fallback uses priceIds[planSlug_yearly]', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			interval: 'yearly',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_pro_yearly');
		assert.equal(result.source, 'legacy');
	});

	it('fails closed on yearly request when only monthly legacy mapping exists', () => {
		const result = resolveCheckoutPaddlePriceId('pro', { priceIds: { pro: 'pri_pro_monthly' } }, {
			interval: 'yearly',
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_price_mapping_missing');
		assert.equal(result.interval, 'yearly');
	});

	it('does not use yearly key when interval is monthly', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			interval: 'monthly',
		});
		assert.equal(result.priceId, 'pri_pro_monthly');
		assert.notEqual(result.priceId, 'pri_pro_yearly');
	});

	it('normalizes YEARLY interval casing', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			interval: 'YEARLY',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_pro_yearly');
	});

	it('rejects invalid interval values', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly, {
			interval: 'weekly',
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'invalid_billing_interval');
	});

	it('defaults missing interval to monthly', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfigWithYearly);
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_pro_monthly');
		assert.equal(result.interval, 'monthly');
	});

	it('resolveExpectedPaddlePriceIdForInterval resolves yearly env key', () => {
		const prev = process.env.PADDLE_PRICE_PRO_YEARLY;
		process.env.PADDLE_PRICE_PRO_YEARLY = 'pri_pro_env_yearly';
		try {
			assert.equal(
				resolveExpectedPaddlePriceIdForInterval('pro', {}, 'yearly'),
				'pri_pro_env_yearly',
			);
		} finally {
			if (prev === undefined) delete process.env.PADDLE_PRICE_PRO_YEARLY;
			else process.env.PADDLE_PRICE_PRO_YEARLY = prev;
		}
	});

	it('validatePaddlePriceForPlan accepts yearly legacy mapping at webhook parse', () => {
		const result = validatePaddlePriceForPlan('pro', 'pri_pro_yearly', legacyConfigWithYearly);
		assert.equal(result.ok, true);
		assert.equal(result.interval, 'yearly');
	});

	it('validatePaddlePriceForPlan accepts yearly registry price by price id', () => {
		const result = validatePaddlePriceForPlan('pro', 'pri_registry_pro_yearly', legacyConfigWithYearly, {
			registryEntries: registryEntriesBoth,
			environment: 'sandbox',
		});
		assert.equal(result.ok, true);
		assert.equal(result.interval, 'yearly');
		assert.equal(result.source, 'registry');
	});

	it('normalizeCheckoutBillingInterval defaults to monthly', () => {
		assert.deepEqual(normalizeCheckoutBillingInterval(undefined), { ok: true, value: 'monthly' });
	});

	it('normalizeCheckoutBillingInterval accepts Yearly casing', () => {
		assert.deepEqual(normalizeCheckoutBillingInterval('Yearly'), { ok: true, value: 'yearly' });
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
		assert.equal(capturedBody.custom_data.workspaceKey, 'ws-test');
		assert.equal(capturedBody.custom_data.planId, 'plan-pro');
		assert.equal(Object.hasOwn(capturedBody, 'checkout'), false);
		assert.equal(result.billingInterval, 'monthly');
		assert.equal(result.priceId, 'pri_pro_monthly');
	});

	it('creates transaction with yearly price when billingInterval is yearly', async () => {
		let capturedBody = null;
		globalThis.fetch = async (_url, opts) => {
			capturedBody = JSON.parse(opts.body);
			return {
				ok: true,
				json: async () => ({
					data: { id: 'txn_yearly', checkout: { url: 'https://checkout.paddle.test/yearly' } },
				}),
			};
		};

		const provider = new PaddleBillingProvider({
			apiKey: 'paddle_test_key',
			sandbox: true,
			priceIds: {
				pro: 'pri_pro_monthly',
				pro_yearly: 'pri_pro_yearly',
			},
		});
		const result = await provider.createSubscriptionCheckout({
			...checkoutInput,
			billingInterval: 'yearly',
		});

		assert.equal(result.checkoutUrl, 'https://checkout.paddle.test/yearly');
		assert.equal(result.billingInterval, 'yearly');
		assert.equal(result.priceId, 'pri_pro_yearly');
		assert.equal(capturedBody.items[0].price_id, 'pri_pro_yearly');
		assert.equal(Object.hasOwn(capturedBody, 'checkout'), false);
	});

	it('rejects invalid billingInterval without calling Paddle API', async () => {
		let fetchCalled = false;
		globalThis.fetch = async () => {
			fetchCalled = true;
			return { ok: true, json: async () => ({}) };
		};

		const provider = new PaddleBillingProvider({
			apiKey: 'paddle_test_key',
			sandbox: true,
			priceIds: { pro: 'pri_pro_monthly', pro_yearly: 'pri_pro_yearly' },
		});
		const result = await provider.createSubscriptionCheckout({
			...checkoutInput,
			billingInterval: 'quarterly',
		});

		assert.equal(fetchCalled, false);
		assert.equal(result.errorCode, 'invalid_billing_interval');
		assert.equal(result.checkoutUrl, null);
	});
});
