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
const freePlan = { id: 'plan_free', slug: 'free', billing_type: 'free', credits: 0 };

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

	it('fails on subscription identity mismatch', () => {
		const result = verifyPaddleTransactionForFulfillment({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro', subscriptionId: 'sub_123' },
			registryEntries,
			environment: 'sandbox',
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: { paddle_subscription_id: 'sub_other' },
		});
		assert.equal(result.error, 'paddle_subscription_identity_mismatch');
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

	it('blocks ambiguous renewal', () => {
		const result = classifyPaddleTransactionFulfillment({
			subscriptionRecord: {
				status: 'active',
				billing_source: 'paddle',
				paddle_subscription_id: 'sub_1',
			},
			verified: { transactionId: 'txn_new', subscriptionId: 'sub_other' },
		});
		assert.equal(result.kind, 'blocked');
	});
});
