/**
 * Phase 4.4-A — Paddle subscription reconciliation verification contract tests.
 * Run: node --test src/services/billing/paddle-subscription-reconciliation.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PaddleApiError } from './providers/paddle-api-client.js';
import { verifyPaddleSubscriptionForCancellation } from './paddle-transaction-verification.js';
import {
	extractPaddleCurrentBillingPeriod,
	extractPaddleScheduledChange,
	extractPaddleSubscriptionBillingInterval,
	extractPaddleSubscriptionPriceId,
	fetchAndVerifyPaddleSubscriptionForReconciliation,
	normalizePaddleBillingCycleInterval,
	parsePaddleAuthoritativeIsoDate,
	verifyPaddleSubscriptionForReconciliation,
	verifyPaddleSubscriptionIdentity,
} from './paddle-subscription-reconciliation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reconciliationSource = readFileSync(
	join(__dirname, 'paddle-subscription-reconciliation.js'),
	'utf8',
);

const sandboxConfig = { apiKey: 'test_api_key', sandbox: true };

function validPaddleSubscription(overrides = {}) {
	return {
		id: 'sub_paddle_1',
		status: 'active',
		customer_id: 'ctm_123',
		items: [{
			price_id: 'pri_pro_monthly',
			price: {
				id: 'pri_pro_monthly',
				billing_cycle: { interval: 'month', frequency: 1 },
			},
			quantity: 1,
		}],
		current_billing_period: {
			starts_at: '2026-08-01T00:00:00.000Z',
			ends_at: '2026-09-01T00:00:00.000Z',
		},
		scheduled_change: null,
		...overrides,
	};
}

function localSubscriptionRecord(overrides = {}) {
	return {
		id: 'local_sub_1',
		workspace_key: 'ws-kitchen',
		paddle_subscription_id: 'sub_paddle_1',
		provider: 'paddle',
		provider_subscription_id: 'sub_paddle_1',
		...overrides,
	};
}

describe('Phase 4.4-A verifyPaddleSubscriptionForReconciliation', () => {
	it('valid Paddle subscription → successful verified contract', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription(),
			subscriptionRecord: localSubscriptionRecord(),
			expectedSubscriptionId: 'sub_paddle_1',
		});
		assert.equal(result.ok, true);
		assert.equal(result.subscriptionId, 'sub_paddle_1');
		assert.equal(result.status, 'active');
		assert.equal(result.priceId, 'pri_pro_monthly');
		assert.equal(result.interval, 'monthly');
		assert.equal(result.currentBillingPeriod.startsAt, '2026-08-01T00:00:00.000Z');
		assert.equal(result.currentBillingPeriod.endsAt, '2026-09-01T00:00:00.000Z');
		assert.equal(result.scheduledChange, null);
		assert.equal(result.cancelScheduledAtPeriodEnd, false);
		assert.equal(result.customerId, 'ctm_123');
		assert.equal(result.cancelled, undefined);
		assert.equal(result.activated, undefined);
		assert.equal(result.renewed, undefined);
	});

	it('missing Paddle subscription object → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({ subscription: null });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_missing');
	});

	it('missing Paddle subscription ID → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({ id: '' }),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_id_missing');
	});

	it('subscription identity match with local record', () => {
		const result = verifyPaddleSubscriptionIdentity({
			subscription: validPaddleSubscription(),
			subscriptionRecord: localSubscriptionRecord(),
			expectedSubscriptionId: 'sub_paddle_1',
		});
		assert.equal(result.ok, true);
		assert.equal(result.subscriptionId, 'sub_paddle_1');
	});

	it('subscription identity mismatch with local paddle_subscription_id → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription(),
			subscriptionRecord: localSubscriptionRecord({ paddle_subscription_id: 'sub_other' }),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_identity_mismatch');
	});

	it('expected subscription ID mismatch → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription(),
			expectedSubscriptionId: 'sub_expected_other',
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_id_mismatch');
	});

	it('valid status extraction', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({ status: 'Past_Due' }),
		});
		assert.equal(result.ok, true);
		assert.equal(result.status, 'past_due');
	});

	it('missing status → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({ status: '' }),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_status_missing');
	});

	it('scheduled cancellation extraction', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({
				scheduled_change: {
					action: 'cancel',
					effective_at: '2026-09-01T00:00:00.000Z',
				},
			}),
		});
		assert.equal(result.ok, true);
		assert.deepEqual(result.scheduledChange, {
			action: 'cancel',
			effectiveAt: '2026-09-01T00:00:00.000Z',
		});
		assert.equal(result.cancelScheduledAtPeriodEnd, true);
	});

	it('null scheduled change is allowed', () => {
		const scheduled = extractPaddleScheduledChange(validPaddleSubscription());
		assert.equal(scheduled.ok, true);
		assert.equal(scheduled.scheduledChange, null);
	});

	it('malformed scheduled change → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({ scheduled_change: 'invalid' }),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_scheduled_change_malformed');
	});

	it('cancel action without effective_at → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({
				scheduled_change: { action: 'cancel' },
			}),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_scheduled_change_effective_at_missing');
	});

	it('valid Paddle price extraction', () => {
		const price = extractPaddleSubscriptionPriceId(validPaddleSubscription());
		assert.equal(price.ok, true);
		assert.equal(price.priceId, 'pri_pro_monthly');
	});

	it('missing price → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({ items: [] }),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_price_missing');
	});

	it('ambiguous multiple prices → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({
				items: [
					{ price: { id: 'pri_a', billing_cycle: { interval: 'month', frequency: 1 } } },
					{ price: { id: 'pri_b', billing_cycle: { interval: 'month', frequency: 1 } } },
				],
			}),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_price_ambiguous');
	});

	it('valid billing interval extraction (yearly)', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({
				items: [{
					price: {
						id: 'pri_pro_yearly',
						billing_cycle: { interval: 'year', frequency: 1 },
					},
				}],
			}),
		});
		assert.equal(result.ok, true);
		assert.equal(result.interval, 'yearly');
		assert.equal(result.priceId, 'pri_pro_yearly');
	});

	it('missing billing cycle → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({
				items: [{ price: { id: 'pri_pro_monthly' } }],
			}),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_billing_cycle_missing');
	});

	it('unsupported billing cycle frequency → fail closed', () => {
		const normalized = normalizePaddleBillingCycleInterval({ interval: 'month', frequency: 3 });
		assert.equal(normalized.ok, false);
		assert.equal(normalized.error, 'paddle_billing_cycle_frequency_unsupported');
	});

	it('unsupported billing cycle interval → fail closed', () => {
		const normalized = normalizePaddleBillingCycleInterval({ interval: 'week', frequency: 1 });
		assert.equal(normalized.ok, false);
		assert.equal(normalized.error, 'paddle_billing_cycle_interval_unsupported');
	});

	it('valid current billing period extraction', () => {
		const period = extractPaddleCurrentBillingPeriod(validPaddleSubscription());
		assert.equal(period.ok, true);
		assert.equal(period.currentBillingPeriod.startsAt, '2026-08-01T00:00:00.000Z');
		assert.equal(period.currentBillingPeriod.endsAt, '2026-09-01T00:00:00.000Z');
	});

	it('missing current billing period → fail closed', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({ current_billing_period: null }),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_current_billing_period_missing');
	});

	it('malformed period dates → fail closed', () => {
		const invalidStart = parsePaddleAuthoritativeIsoDate('not-a-date', 'current_billing_period_starts_at');
		assert.equal(invalidStart.ok, false);
		assert.equal(invalidStart.error, 'paddle_current_billing_period_starts_at_invalid');

		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription({
				current_billing_period: {
					starts_at: '2026-09-01T00:00:00.000Z',
					ends_at: '2026-08-01T00:00:00.000Z',
				},
			}),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_current_billing_period_invalid_range');
	});
});

describe('Phase 4.4-A fetchAndVerifyPaddleSubscriptionForReconciliation', () => {
	it('Paddle API failure → fail closed', async () => {
		const fetchImpl = async () => ({
			ok: false,
			status: 500,
			json: async () => ({ error: { code: 'internal_error', detail: 'fail' } }),
		});
		const result = await fetchAndVerifyPaddleSubscriptionForReconciliation({
			subscriptionId: 'sub_paddle_1',
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
		});
		assert.equal(result.ok, false);
		assert.match(result.error, /paddle|internal_error/i);
	});

	it('missing subscription ID on fetch → fail closed', async () => {
		const result = await fetchAndVerifyPaddleSubscriptionForReconciliation({
			subscriptionId: '',
			environment: 'sandbox',
			config: sandboxConfig,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_id_missing');
	});

	it('malformed Paddle API success body → fail closed', async () => {
		const fetchImpl = async () => ({
			ok: true,
			status: 200,
			json: async () => ({ data: null }),
		});
		const result = await fetchAndVerifyPaddleSubscriptionForReconciliation({
			subscriptionId: 'sub_paddle_1',
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_malformed');
	});

	it('successful fetch + verify contract', async () => {
		const fetchImpl = async (url) => {
			assert.match(url, /\/subscriptions\/sub_paddle_1$/);
			return {
				ok: true,
				status: 200,
				json: async () => ({ data: validPaddleSubscription() }),
			};
		};
		const result = await fetchAndVerifyPaddleSubscriptionForReconciliation({
			subscriptionId: 'sub_paddle_1',
			subscriptionRecord: localSubscriptionRecord(),
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
		});
		assert.equal(result.ok, true);
		assert.equal(result.subscriptionId, 'sub_paddle_1');
		assert.equal(result.interval, 'monthly');
	});

	it('network error → fail closed', async () => {
		const fetchImpl = async () => {
			throw new Error('network down');
		};
		const result = await fetchAndVerifyPaddleSubscriptionForReconciliation({
			subscriptionId: 'sub_paddle_1',
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_api_request_failed');
	});
});

describe('Phase 4.4-A safety guards', () => {
	it('verification module does not import PocketBase or subscription mutation paths', () => {
		assert.equal(reconciliationSource.includes('pocketbaseClient'), false);
		assert.equal(reconciliationSource.includes('activatePaddleSubscription'), false);
		assert.equal(reconciliationSource.includes('renewPaddleSubscription'), false);
		assert.equal(reconciliationSource.includes('handlePaddleCancellation'), false);
		assert.equal(reconciliationSource.includes('syncEntitlementMirrors'), false);
		assert.equal(reconciliationSource.includes('cancelPaddleSubscriptionAtPeriodEnd'), false);
	});

	it('verification result never exposes fulfillment success flags', () => {
		const result = verifyPaddleSubscriptionForReconciliation({
			subscription: validPaddleSubscription(),
		});
		assert.equal(result.ok, true);
		for (const forbidden of ['cancelled', 'activated', 'renewed', 'fulfilled', 'duplicate']) {
			assert.equal(result[forbidden], undefined, `must not expose ${forbidden}`);
		}
	});

	it('billing interval uses existing contract normalization only', () => {
		const interval = extractPaddleSubscriptionBillingInterval(
			validPaddleSubscription(),
			'pri_pro_monthly',
		);
		assert.equal(interval.ok, true);
		assert.equal(interval.value, 'monthly');
	});
});

describe('Phase 4.4-A regression — existing Paddle cancellation verification', () => {
	it('verifyPaddleSubscriptionForCancellation unchanged behavior', () => {
		const result = verifyPaddleSubscriptionForCancellation({
			status: 'active',
			scheduled_change: {
				action: 'cancel',
				effective_at: '2026-09-08T10:00:00.000Z',
			},
		});
		assert.equal(result.ok, true);
		assert.equal(result.cancelAtPeriodEnd, true);
		assert.equal(result.immediate, false);
	});

	it('verifyPaddleSubscriptionForCancellation rejects missing status', () => {
		const result = verifyPaddleSubscriptionForCancellation({});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_status_missing');
	});
});

describe('Phase 4.4-A PaddleApiError propagation shape', () => {
	it('maps PaddleApiError code on fetch failure', async () => {
		const fetchImpl = async () => {
			throw new PaddleApiError('missing', { code: 'paddle_subscription_id_missing', status: 404 });
		};
		const result = await fetchAndVerifyPaddleSubscriptionForReconciliation({
			subscriptionId: 'sub_missing',
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_id_missing');
		assert.equal(result.status, 404);
	});
});
