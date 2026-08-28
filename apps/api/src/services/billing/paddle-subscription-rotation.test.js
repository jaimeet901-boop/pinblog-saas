/**
 * Paddle same-customer subscription rotation cleanup tests.
 * Run: node --test src/services/billing/paddle-subscription-rotation.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cancelPreviousPaddleSubscriptionAfterRotation } from './paddle-previous-subscription-cleanup.js';
import {
	classifyPaddleTransactionFulfillment,
	verifyPaddleTransactionForFulfillment,
} from './paddle-transaction-verification.js';
import { normalizeRegistryEntry } from './price-registry.js';

const noopLog = async () => null;

const registryEntries = [
	normalizeRegistryEntry({
		provider: 'paddle',
		environment: 'sandbox',
		planSlug: 'pro',
		interval: 'monthly',
		priceId: 'pri_pro_monthly',
	}),
];

const paidPlan = { id: 'plan_pro', slug: 'pro', billing_type: 'paid', credits: 1000 };

describe('Starter→Pro subscription rotation (end-to-end pure path)', () => {
	it('A: verifies + classifies plan_change with new subscription_id stored intent', () => {
		const verified = verifyPaddleTransactionForFulfillment({
			transaction: {
				id: 'txn_pro',
				status: 'completed',
				subscription_id: 'sub_pro_new',
				customer_id: 'ctm_same',
				items: [{ price: { id: 'pri_pro_monthly' } }],
				custom_data: { workspaceKey: 'ws-1', planSlug: 'pro' },
			},
			webhookContext: { workspaceKey: 'ws-1', planSlug: 'pro', transactionId: 'txn_pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-1',
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_starter',
				paddle_customer_id: 'ctm_same',
				paddle_transaction_id: 'txn_starter',
			},
		});
		assert.equal(verified.ok, true);
		assert.equal(verified.subscriptionIdRotated, true);
		assert.equal(verified.subscriptionId, 'sub_pro_new');
		assert.equal(verified.previousSubscriptionId, 'sub_starter');

		const classified = classifyPaddleTransactionFulfillment({
			subscriptionRecord: {
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_starter',
				paddle_transaction_id: 'txn_starter',
			},
			verified,
		});
		assert.equal(classified.kind, 'plan_change');
		assert.notEqual(classified.kind, 'renewal');
	});

	it('B: same subscription_id + new transaction remains renewal', () => {
		const classified = classifyPaddleTransactionFulfillment({
			subscriptionRecord: {
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_1',
				paddle_transaction_id: 'txn_old',
			},
			verified: { transactionId: 'txn_new', subscriptionId: 'sub_1' },
		});
		assert.equal(classified.kind, 'renewal');
	});

	it('C: different customer is rejected', () => {
		const verified = verifyPaddleTransactionForFulfillment({
			transaction: {
				id: 'txn_pro',
				status: 'completed',
				subscription_id: 'sub_pro_new',
				customer_id: 'ctm_attacker',
				items: [{ price: { id: 'pri_pro_monthly' } }],
				custom_data: { workspaceKey: 'ws-1', planSlug: 'pro' },
			},
			webhookContext: { workspaceKey: 'ws-1', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-1',
				paddle_subscription_id: 'sub_starter',
				paddle_customer_id: 'ctm_owner',
			},
		});
		assert.equal(verified.ok, false);
		assert.equal(verified.error, 'paddle_subscription_customer_mismatch');
	});

	it('D: different workspace is rejected', () => {
		const verified = verifyPaddleTransactionForFulfillment({
			transaction: {
				id: 'txn_pro',
				status: 'completed',
				subscription_id: 'sub_pro_new',
				customer_id: 'ctm_same',
				items: [{ price: { id: 'pri_pro_monthly' } }],
				custom_data: { workspaceKey: 'ws-1', planSlug: 'pro' },
			},
			webhookContext: { workspaceKey: 'ws-other', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-1',
				paddle_subscription_id: 'sub_starter',
				paddle_customer_id: 'ctm_same',
			},
		});
		assert.equal(verified.ok, false);
		assert.equal(verified.error, 'paddle_workspace_metadata_mismatch');
	});

	it('E: invalid/unregistered price is rejected', () => {
		const verified = verifyPaddleTransactionForFulfillment({
			transaction: {
				id: 'txn_pro',
				status: 'completed',
				subscription_id: 'sub_pro_new',
				customer_id: 'ctm_same',
				items: [{ price: { id: 'pri_unknown' } }],
				custom_data: { workspaceKey: 'ws-1', planSlug: 'pro' },
			},
			webhookContext: { workspaceKey: 'ws-1', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-1',
				paddle_subscription_id: 'sub_starter',
				paddle_customer_id: 'ctm_same',
			},
		});
		assert.equal(verified.ok, false);
		assert.equal(verified.error, 'paddle_price_not_in_registry');
	});

	it('F: plan/price mismatch is rejected', () => {
		const verified = verifyPaddleTransactionForFulfillment({
			transaction: {
				id: 'txn_pro',
				status: 'completed',
				subscription_id: 'sub_pro_new',
				customer_id: 'ctm_same',
				items: [{ price: { id: 'pri_pro_monthly' } }],
				custom_data: { workspaceKey: 'ws-1', planSlug: 'starter' },
			},
			webhookContext: { workspaceKey: 'ws-1', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-1',
				paddle_subscription_id: 'sub_starter',
				paddle_customer_id: 'ctm_same',
			},
		});
		assert.equal(verified.ok, false);
		assert.equal(verified.error, 'paddle_plan_custom_data_mismatch');
	});

	it('G: duplicate same transaction remains idempotent classification', () => {
		const classified = classifyPaddleTransactionFulfillment({
			subscriptionRecord: {
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_pro_new',
				paddle_transaction_id: 'txn_pro',
			},
			verified: { transactionId: 'txn_pro', subscriptionId: 'sub_pro_new' },
		});
		assert.equal(classified.kind, 'duplicate');
	});
});

describe('cancelPreviousPaddleSubscriptionAfterRotation', () => {
	it('H: cancels previous subscription only when ids differ', async () => {
		const calls = [];
		const result = await cancelPreviousPaddleSubscriptionAfterRotation({
			previousSubscriptionId: 'sub_old',
			newSubscriptionId: 'sub_new',
			workspaceKey: 'ws-1',
			logBillingAction: noopLog,
			cancelPreviousSubscription: async (id) => {
				calls.push(id);
				return { id, status: 'canceled' };
			},
		});
		assert.deepEqual(calls, ['sub_old']);
		assert.equal(result.attempted, true);
		assert.equal(result.ok, true);
	});

	it('H: skips cancel when previous equals new', async () => {
		let called = false;
		const result = await cancelPreviousPaddleSubscriptionAfterRotation({
			previousSubscriptionId: 'sub_same',
			newSubscriptionId: 'sub_same',
			logBillingAction: noopLog,
			cancelPreviousSubscription: async () => {
				called = true;
			},
		});
		assert.equal(called, false);
		assert.equal(result.attempted, false);
		assert.equal(result.skipped, true);
	});

	it('I: cancel failure is best-effort and does not throw', async () => {
		const result = await cancelPreviousPaddleSubscriptionAfterRotation({
			previousSubscriptionId: 'sub_old',
			newSubscriptionId: 'sub_new',
			workspaceKey: 'ws-1',
			logBillingAction: noopLog,
			cancelPreviousSubscription: async () => {
				throw new Error('paddle_remote_cancel_failed');
			},
		});
		assert.equal(result.attempted, true);
		assert.equal(result.ok, false);
		assert.equal(result.retryable, true);
		assert.match(result.error, /paddle_remote_cancel_failed/);
	});

	it('does not cancel before a cancel function is provided (observable skip)', async () => {
		const result = await cancelPreviousPaddleSubscriptionAfterRotation({
			previousSubscriptionId: 'sub_old',
			newSubscriptionId: 'sub_new',
			logBillingAction: noopLog,
			cancelPreviousSubscription: null,
		});
		assert.equal(result.attempted, false);
		assert.equal(result.retryable, true);
		assert.equal(result.error, 'paddle_previous_subscription_cancel_unavailable');
	});
});
