/**
 * Phase 3.2 — Scheduler autoRenew hardening tests.
 * Run: node --test src/services/billing/subscriptions-lifecycle.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	isProviderManagedPaddleSubscription,
	resolveLocalRenewalSkipReason,
	shouldSchedulerAttemptAutoRenew,
	PROVIDER_MANAGED_SKIP_REASON,
} from './provider-managed-subscription.js';

const FIXED_NOW = new Date('2026-08-09T12:00:00.000Z');
/** One day before FIXED_NOW — keeps periodDaysLeft < 0 when tests pass the same `now`. */
const EXPIRED_PERIOD_END = new Date(FIXED_NOW.getTime() - 86400000).toISOString();

function paddleSubscription(overrides = {}) {
	return {
		status: 'active',
		provider: 'paddle',
		billing_source: 'paddle',
		activation_source: 'paddle_webhook',
		paddle_subscription_id: 'sub_paddle_123',
		paddle_transaction_id: 'txn_abc',
		current_period_end: EXPIRED_PERIOD_END,
		cancel_at_period_end: false,
		...overrides,
	};
}

describe('isProviderManagedPaddleSubscription', () => {
	it('returns true when billing_source is paddle', () => {
		assert.equal(isProviderManagedPaddleSubscription({
			billing_source: 'paddle',
			provider: 'none',
		}), true);
	});

	it('returns true when provider is paddle and paddle_subscription_id is set', () => {
		assert.equal(isProviderManagedPaddleSubscription({
			billing_source: '',
			provider: 'paddle',
			paddle_subscription_id: 'sub_123',
		}), true);
	});

	it('returns true when activation_source is paddle_webhook and provider is paddle', () => {
		assert.equal(isProviderManagedPaddleSubscription({
			billing_source: '',
			provider: 'paddle',
			activation_source: 'paddle_webhook',
		}), true);
	});

	it('does not treat stripe provider as paddle-managed', () => {
		assert.equal(isProviderManagedPaddleSubscription({
			provider: 'stripe',
			provider_subscription_id: 'sub_stripe',
			billing_source: 'system',
		}), false);
	});

	it('does not treat free billing_source as paddle-managed', () => {
		assert.equal(isProviderManagedPaddleSubscription({
			provider: 'none',
			billing_source: 'free',
		}), false);
	});

	it('does not treat system billing_source as paddle-managed', () => {
		assert.equal(isProviderManagedPaddleSubscription({
			provider: 'none',
			billing_source: 'system',
		}), false);
	});

	it('does not treat paddle provider without identity as paddle-managed', () => {
		assert.equal(isProviderManagedPaddleSubscription({
			provider: 'paddle',
			billing_source: '',
			paddle_subscription_id: '',
		}), false);
	});
});

describe('resolveLocalRenewalSkipReason', () => {
	const now = FIXED_NOW;

	it('blocks expired paddle subscription local renewal (Test 1)', () => {
		const reason = resolveLocalRenewalSkipReason(paddleSubscription(), { now });
		assert.equal(reason, PROVIDER_MANAGED_SKIP_REASON);
	});

	it('blocks when paddle_subscription_id identifies provider ownership (Test 2)', () => {
		const reason = resolveLocalRenewalSkipReason({
			status: 'active',
			provider: 'paddle',
			billing_source: '',
			paddle_subscription_id: 'sub_live_999',
			current_period_end: EXPIRED_PERIOD_END,
		}, { now });
		assert.equal(reason, PROVIDER_MANAGED_SKIP_REASON);
	});

	it('allows free subscription local renewal (Test 3)', () => {
		const reason = resolveLocalRenewalSkipReason({
			status: 'active',
			provider: 'none',
			billing_source: 'free',
			current_period_end: EXPIRED_PERIOD_END,
		}, { now });
		assert.equal(reason, '');
	});

	it('allows system billing_source local renewal (Test 4)', () => {
		const reason = resolveLocalRenewalSkipReason({
			status: 'active',
			provider: 'none',
			billing_source: 'system',
			current_period_end: EXPIRED_PERIOD_END,
		}, { now });
		assert.equal(reason, '');
	});

	it('returns period_not_ended when period has not expired', () => {
		const futureEnd = new Date(now.getTime() + 7 * 86400000).toISOString();
		const reason = resolveLocalRenewalSkipReason({
			status: 'active',
			provider: 'none',
			billing_source: 'free',
			current_period_end: futureEnd,
		}, { now });
		assert.equal(reason, 'period_not_ended');
	});

	it('does not bypass provider_managed guard when force is true (Test 8)', () => {
		const reason = resolveLocalRenewalSkipReason(paddleSubscription(), { force: true, now });
		assert.equal(reason, PROVIDER_MANAGED_SKIP_REASON);
	});
});

describe('shouldSchedulerAttemptAutoRenew', () => {
	const now = FIXED_NOW;

	it('does not attempt renewal when autoRenew is false (Test 5)', () => {
		const sub = paddleSubscription();
		assert.equal(shouldSchedulerAttemptAutoRenew(sub, { autoRenew: false }, now), false);
	});

	it('does not attempt renewal when cancel_at_period_end is true (Test 6)', () => {
		const sub = paddleSubscription({ cancel_at_period_end: true });
		assert.equal(shouldSchedulerAttemptAutoRenew(sub, { autoRenew: true }, now), false);
	});

	it('attempts renewal for expired active subscription when autoRenew enabled', () => {
		const sub = {
			status: 'active',
			billing_source: 'free',
			current_period_end: EXPIRED_PERIOD_END,
			cancel_at_period_end: false,
		};
		assert.equal(shouldSchedulerAttemptAutoRenew(sub, { autoRenew: true }, now), true);
	});
});

describe('scheduler renewal safety composition', () => {
	const now = FIXED_NOW;

	it('expired paddle subscription: scheduler would attempt but local renewal is blocked (Test 1 + 7)', () => {
		const sub = paddleSubscription();
		assert.equal(shouldSchedulerAttemptAutoRenew(sub, { autoRenew: true }, now), true);
		const skipReason = resolveLocalRenewalSkipReason(sub, { now });
		assert.equal(skipReason, PROVIDER_MANAGED_SKIP_REASON);
	});

	it('repeated evaluation remains blocked without side effects (Test 7 idempotency safety)', () => {
		const sub = paddleSubscription();
		for (let i = 0; i < 3; i += 1) {
			assert.equal(resolveLocalRenewalSkipReason(sub, { now }), PROVIDER_MANAGED_SKIP_REASON);
		}
	});

	it('skipped paddle renewal implies no local paid entitlement extension (Test 8)', () => {
		const skipReason = resolveLocalRenewalSkipReason(paddleSubscription(), { now });
		assert.equal(skipReason, PROVIDER_MANAGED_SKIP_REASON);
		assert.notEqual(skipReason, '');
	});
});
