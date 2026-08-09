/**
 * Phase 3.6 — PayPal transaction verification tests (pure logic).
 * Run: node --test src/services/billing/paypal-transaction-verification.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodePayPalCustomId } from './providers/paypal.js';
import {
	buildPayPalActivationIdempotencyKey,
	buildPayPalRenewalIdempotencyKey,
	classifyPayPalActivationFulfillment,
	classifyPayPalRenewalFulfillment,
	verifyPayPalSaleCompletedState,
	verifyPayPalSaleForRenewal,
	verifyPayPalSubscriptionActiveStatus,
	verifyPayPalSubscriptionForActivation,
	verifyPayPalSubscriptionForCancellation,
} from './paypal-transaction-verification.js';

const planIds = { pro: 'P-PLAN-PRO', starter: 'P-PLAN-STARTER' };
const paidPlan = { id: 'plan_pro', slug: 'pro', billing_type: 'paid', credits: 500 };
const customId = encodePayPalCustomId('ws-kitchen', 'pro');

describe('PayPal subscription status verification', () => {
	it('accepts ACTIVE subscription status', () => {
		assert.equal(verifyPayPalSubscriptionActiveStatus({ status: 'ACTIVE' }).ok, true);
	});

	it('rejects non-active subscription status (Test 12)', () => {
		const result = verifyPayPalSubscriptionActiveStatus({ status: 'APPROVAL_PENDING' });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paypal_subscription_not_active');
	});
});

describe('verifyPayPalSubscriptionForActivation', () => {
	const baseSubscription = {
		subscriptionId: 'I-SUB-100',
		status: 'ACTIVE',
		customId,
		planId: 'P-PLAN-PRO',
	};

	it('accepts verified active subscription (Test 1 path)', () => {
		const result = verifyPayPalSubscriptionForActivation({
			subscription: baseSubscription,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro', subscriptionId: 'I-SUB-100' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.ok, true);
		assert.equal(result.planSlug, 'pro');
		assert.equal(result.subscriptionId, 'I-SUB-100');
	});

	it('fails when workspace missing (Test 10)', () => {
		const result = verifyPayPalSubscriptionForActivation({
			subscription: { ...baseSubscription, customId: '' },
			webhookContext: { workspaceKey: '', planSlug: 'pro' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: false,
		});
		assert.equal(result.error, 'paypal_workspace_missing');
	});

	it('fails when workspace not found (Test 10)', () => {
		const result = verifyPayPalSubscriptionForActivation({
			subscription: baseSubscription,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: false,
		});
		assert.equal(result.error, 'paypal_workspace_not_found');
	});

	it('fails on workspace metadata mismatch (Test 9)', () => {
		const result = verifyPayPalSubscriptionForActivation({
			subscription: baseSubscription,
			webhookContext: { workspaceKey: 'ws-other', planSlug: 'pro' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paypal_workspace_metadata_mismatch');
	});

	it('fails on plan metadata mismatch (Test 11)', () => {
		const result = verifyPayPalSubscriptionForActivation({
			subscription: baseSubscription,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'starter' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paypal_plan_metadata_mismatch');
	});

	it('fails when plan id is not mapped (Test 11)', () => {
		const result = verifyPayPalSubscriptionForActivation({
			subscription: { ...baseSubscription, planId: 'P-UNKNOWN' },
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paypal_plan_not_mapped');
	});

	it('fails on subscription identity mismatch (Test 7)', () => {
		const result = verifyPayPalSubscriptionForActivation({
			subscription: baseSubscription,
			webhookContext: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				provider: 'paypal',
				provider_subscription_id: 'I-SUB-OTHER',
			},
		});
		assert.equal(result.error, 'paypal_subscription_identity_mismatch');
	});
});

describe('verifyPayPalSaleForRenewal', () => {
	const subscription = {
		subscriptionId: 'I-SUB-200',
		status: 'ACTIVE',
		customId,
		planId: 'P-PLAN-PRO',
	};

	it('accepts completed sale linked to active subscription (Test 16 path)', () => {
		const result = verifyPayPalSaleForRenewal({
			sale: { saleId: 'SALE-1', state: 'COMPLETED', billingAgreementId: 'I-SUB-200' },
			subscription,
			webhookContext: { workspaceKey: 'ws-kitchen', saleId: 'SALE-1', subscriptionId: 'I-SUB-200' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: true,
			subscriptionRecord: {
				provider: 'paypal',
				provider_subscription_id: 'I-SUB-200',
			},
		});
		assert.equal(result.ok, true);
		assert.equal(result.saleId, 'SALE-1');
	});

	it('fails when sale is not completed (Test 12)', () => {
		const result = verifyPayPalSaleForRenewal({
			sale: { saleId: 'SALE-2', state: 'PENDING' },
			subscription,
			webhookContext: { workspaceKey: 'ws-kitchen', saleId: 'SALE-2' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paypal_sale_not_completed');
	});

	it('fails on sale/subscription mismatch (Test 8)', () => {
		const result = verifyPayPalSaleForRenewal({
			sale: { saleId: 'SALE-3', state: 'COMPLETED', billingAgreementId: 'I-SUB-WRONG' },
			subscription,
			webhookContext: { workspaceKey: 'ws-kitchen', saleId: 'SALE-3', subscriptionId: 'I-SUB-200' },
			planIds,
			planRecord: paidPlan,
			workspaceExists: true,
		});
		assert.equal(result.error, 'paypal_sale_subscription_mismatch');
	});
});

describe('PayPal fulfillment classification and idempotency keys', () => {
	it('buildPayPalActivationIdempotencyKey scopes by subscription id (Test 14)', () => {
		assert.equal(
			buildPayPalActivationIdempotencyKey('I-SUB-ABC'),
			'sub-fulfill:paypal-sub:I-SUB-ABC',
		);
	});

	it('buildPayPalRenewalIdempotencyKey scopes by sale id (Test 14)', () => {
		assert.equal(buildPayPalRenewalIdempotencyKey('SALE-XYZ'), 'paypal-renew:sale:SALE-XYZ');
	});

	it('classifies active PayPal subscription as duplicate activation (Test 13)', () => {
		const kind = classifyPayPalActivationFulfillment({
			subscriptionRecord: {
				status: 'active',
				provider: 'paypal',
				billing_source: 'system',
				provider_subscription_id: 'I-SUB-1',
			},
			verified: { subscriptionId: 'I-SUB-1' },
		});
		assert.equal(kind.kind, 'duplicate');
	});

	it('classifies renewal when local subscription is linked', () => {
		const kind = classifyPayPalRenewalFulfillment({
			subscriptionRecord: {
				provider: 'paypal',
				provider_subscription_id: 'I-SUB-1',
			},
			verified: { subscriptionId: 'I-SUB-1', saleId: 'SALE-1' },
		});
		assert.equal(kind.kind, 'renewal');
	});

	it('verifyPayPalSubscriptionForCancellation accepts cancelled status (Test 17 path)', () => {
		const result = verifyPayPalSubscriptionForCancellation({ status: 'CANCELLED' });
		assert.equal(result.ok, true);
		assert.equal(result.immediate, true);
	});
});

describe('verifyPayPalSaleCompletedState', () => {
	it('accepts COMPLETED sale state', () => {
		assert.equal(verifyPayPalSaleCompletedState({ state: 'completed' }).ok, true);
	});
});
