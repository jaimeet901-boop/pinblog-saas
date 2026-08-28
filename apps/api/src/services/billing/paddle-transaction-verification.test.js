/**
 * Paddle transaction verification tests (pure logic).
 * Run: node --test src/services/billing/paddle-transaction-verification.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyPaddleTransactionFulfillment,
	verifyPaddleTransactionForFulfillment,
	verifyPaddleTransactionPaidStatus,
} from './paddle-transaction-verification.js';
import { normalizeRegistryEntry } from './price-registry.js';

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

describe('verifyPaddleTransactionPaidStatus', () => {
	it('accepts completed', () => {
		assert.equal(verifyPaddleTransactionPaidStatus({ status: 'completed' }).ok, true);
	});

	it('rejects draft', () => {
		const result = verifyPaddleTransactionPaidStatus({ status: 'draft' });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_transaction_not_paid');
	});
});

describe('verifyPaddleTransactionForFulfillment', () => {
	const baseTransaction = {
		id: 'txn_123',
		status: 'completed',
		subscription_id: 'sub_123',
		customer_id: 'ctm_123',
		items: [{ price: { id: 'pri_pro_monthly' } }],
		custom_data: {
			workspaceKey: 'ws-kitchen',
			planSlug: 'pro',
		},
	};

	it('accepts verified paid transaction with registry price', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro', transactionId: 'txn_123' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.ok, true);
		assert.equal(result.planSlug, 'pro');
		assert.equal(result.priceId, 'pri_pro_monthly');
		assert.equal(result.subscriptionIdRotated, false);
	});

	it('fails when workspace missing', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: { ...baseTransaction, custom_data: {} },
			webhookContext: { workspaceKey: '', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: false,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_workspace_missing');
	});

	it('fails when workspace not found', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: false,
		});
		assert.equal(result.error, 'paddle_workspace_not_found');
	});

	it('fails when price not in registry', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: { ...baseTransaction, items: [{ price: { id: 'pri_unknown' } }] },
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paddle_price_not_in_registry');
	});

	it('fails when plan billing_type is free', () => {
		const catalogFreePro = { id: 'plan_pro', slug: 'pro', billing_type: 'free', credits: 0 };
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: catalogFreePro,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paddle_plan_not_paid');
	});

	it('fails on workspace metadata mismatch', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-other', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paddle_workspace_metadata_mismatch');
	});

	it('fails when subscription id rotates but stored customer is missing', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro', subscriptionId: 'sub_123' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: { paddle_subscription_id: 'sub_other', workspace_key: 'ws-kitchen' },
		});
		assert.equal(result.error, 'paddle_subscription_customer_missing');
	});

	it('fails when subscription id rotates with a different customer', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro', subscriptionId: 'sub_123' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-kitchen',
				paddle_subscription_id: 'sub_starter',
				paddle_customer_id: 'ctm_other',
			},
		});
		assert.equal(result.error, 'paddle_subscription_customer_mismatch');
	});

	it('accepts Starter→Pro rotation when same customer and new subscription_id', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: {
				...baseTransaction,
				id: 'txn_pro_upgrade',
				subscription_id: 'sub_pro_new',
			},
			webhookContext: {
				workspaceKey: 'ws-kitchen',
				planSlug: 'pro',
				transactionId: 'txn_pro_upgrade',
				subscriptionId: 'sub_pro_new',
			},
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-kitchen',
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_starter_old',
				paddle_customer_id: 'ctm_123',
				paddle_transaction_id: 'txn_starter',
			},
		});
		assert.equal(result.ok, true);
		assert.equal(result.subscriptionIdRotated, true);
		assert.equal(result.previousSubscriptionId, 'sub_starter_old');
		assert.equal(result.subscriptionId, 'sub_pro_new');
		assert.equal(result.planSlug, 'pro');
	});

	it('preserves same subscription_id without rotation flag', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro', transactionId: 'txn_123' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-kitchen',
				paddle_subscription_id: 'sub_123',
				paddle_customer_id: 'ctm_123',
			},
		});
		assert.equal(result.ok, true);
		assert.equal(result.subscriptionIdRotated, false);
		assert.equal(result.previousSubscriptionId, '');
	});

	it('fails on plan/price custom_data mismatch', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: {
				...baseTransaction,
				custom_data: { workspaceKey: 'ws-kitchen', planSlug: 'starter' },
			},
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paddle_plan_custom_data_mismatch');
	});

	it('fails when subscription record workspace differs', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				workspace_key: 'ws-other',
				paddle_subscription_id: 'sub_123',
				paddle_customer_id: 'ctm_123',
			},
		});
		assert.equal(result.error, 'paddle_workspace_subscription_mismatch');
	});

	it('accepts yearly registry price without changing verification semantics (Phase 3.8)', () => {
		const yearlyRegistry = [
			...registryEntries,
			normalizeRegistryEntry({
				provider: 'paddle',
				environment: 'sandbox',
				planSlug: 'pro',
				interval: 'yearly',
				priceId: 'pri_pro_yearly',
			}),
		];
		const result = verifyPaddleTransactionForFulfillment({
			transaction: {
				...baseTransaction,
				items: [{ price: { id: 'pri_pro_yearly' } }],
			},
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro', transactionId: 'txn_yearly' },
			registryEntries: yearlyRegistry,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_pro_yearly');
		assert.equal(result.interval, 'yearly');
	});
});

describe('classifyPaddleTransactionFulfillment', () => {
	it('classifies new subscription as activation', () => {
		const result = classifyPaddleTransactionFulfillment({
			subscriptionRecord: null,
			verified: { transactionId: 'txn_1', subscriptionId: 'sub_1' },
		});
		assert.equal(result.kind, 'activation');
	});

	it('classifies renewal when subscription active with new transaction', () => {
		const result = classifyPaddleTransactionFulfillment({
			subscriptionRecord: {
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_1',
				paddle_transaction_id: 'txn_old',
			},
			verified: { transactionId: 'txn_new', subscriptionId: 'sub_1' },
		});
		assert.equal(result.kind, 'renewal');
	});

	it('classifies duplicate when same transaction already linked', () => {
		const result = classifyPaddleTransactionFulfillment({
			subscriptionRecord: {
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_1',
				paddle_transaction_id: 'txn_same',
			},
			verified: { transactionId: 'txn_same', subscriptionId: 'sub_1' },
		});
		assert.equal(result.kind, 'duplicate');
		assert.equal(result.reason, 'same_transaction_already_linked');
	});

	it('classifies verified subscription rotation as plan_change', () => {
		const result = classifyPaddleTransactionFulfillment({
			subscriptionRecord: {
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_starter',
				paddle_transaction_id: 'txn_starter',
				paddle_customer_id: 'ctm_123',
			},
			verified: {
				transactionId: 'txn_pro',
				subscriptionId: 'sub_pro',
				subscriptionIdRotated: true,
				previousSubscriptionId: 'sub_starter',
				customerId: 'ctm_123',
			},
		});
		assert.equal(result.kind, 'plan_change');
		assert.equal(result.reason, 'subscription_id_rotated_same_customer');
	});

	it('blocks ambiguous renewal when subscription ids differ without rotation flag', () => {
		const result = classifyPaddleTransactionFulfillment({
			subscriptionRecord: {
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_1',
			},
			verified: { transactionId: 'txn_new', subscriptionId: 'sub_other' },
		});
		assert.equal(result.kind, 'blocked');
		assert.equal(result.reason, 'renewal_not_safe_to_identify');
	});
});
