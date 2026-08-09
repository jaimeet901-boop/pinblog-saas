/**
 * Phase 4.2 — Refund / chargeback lifecycle tests.
 * Run: node --test src/services/billing/refund-lifecycle.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPaddleWebhookEvent } from './providers/paddle-webhook-helpers.js';
import { classifyPayPalWebhookEvent } from './providers/paypal-webhook-helpers.js';
import {
	buildPaddleRefundIdempotencyKey,
	classifyPaddleRefundPurchaseKind,
	extractPaddleAdjustmentFromWebhook,
	isPaddleRefundAdjustmentAction,
	verifyPaddleAdjustmentForRefund,
	verifyPaddleRefundWorkspaceIdentity,
	verifyPaddleTransactionRefundState,
} from './paddle-refund-verification.js';
import {
	buildPayPalRefundIdempotencyKey,
	extractPayPalRefundWebhookContext,
	verifyPayPalSaleReversedState,
	verifyPayPalSubscriptionRefundIdentity,
} from './paypal-refund-verification.js';
import {
	clawbackCreditPackPurchase,
	computeCreditPackClawbackAmounts,
	handleSubscriptionRefundPending,
	shouldImmediatelyDowngradeSubscription,
} from './refund-lifecycle.js';
import { normalizeRegistryEntry } from './price-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(__dirname, '..', '..');

function readSrc(relativePath) {
	return readFileSync(join(apiSrc, relativePath), 'utf8');
}

function createMockDeps(overrides = {}) {
	const state = {
		subscription: {
			id: 'sub1',
			workspace_key: 'ws-kitchen',
			workspace_name: 'Kitchen',
			plan: 'plan_pro',
			status: 'active',
			billing_status: 'active',
			provider: 'paddle',
			provider_subscription_id: 'sub_paddle_1',
			paddle_subscription_id: 'sub_paddle_1',
			purchased_credits: overrides.purchased_credits ?? 100,
			credits_balance: overrides.credits_balance ?? 150,
			current_period_end: overrides.current_period_end
				|| new Date(Date.now() + 7 * 86400000).toISOString(),
			...overrides.subscription,
		},
		plans: {
			free: { id: 'plan_free', slug: 'free' },
		},
		updates: [],
		syncCalls: [],
		auditCalls: [],
		idempotency: new Map(),
	};

	const client = {
		filter: (template) => template,
		collection(name) {
			if (name === 'workspace_subscriptions') {
				return {
					getFirstListItem: async () => ({ ...state.subscription, expand: { plan: { slug: 'pro' } } }),
					update: async (id, body) => {
						state.updates.push({ id, body });
						state.subscription = { ...state.subscription, ...body };
						return state.subscription;
					},
				};
			}
			if (name === 'plans') {
				return {
					getFirstListItem: async () => state.plans.free,
				};
			}
			if (name === 'credit_transactions') {
				return {
					getFirstListItem: async () => {
						if (overrides.missingOriginalTx) throw new Error('not found');
						return {
							id: 'ctx1',
							amount: overrides.originalAmount ?? 100,
							idempotency_key: 'paddle-pack-txn:txn_pack_1:tx',
							reference_id: 'txn_pack_1',
						};
					},
					create: async (body) => {
						state.creditTx = body;
						return { id: 'ctx_refund_1', ...body };
					},
				};
			}
			throw new Error(`unexpected collection ${name}`);
		},
	};

	return {
		state,
		deps: {
			client,
			syncEntitlementMirrors: async (payload) => { state.syncCalls.push(payload); },
			logBillingAction: async (payload) => { state.auditCalls.push(payload); },
			claimIdempotencyKey: async ({ idempotencyKey }) => {
				if (state.idempotency.has(idempotencyKey)) {
					return { duplicate: true, result: state.idempotency.get(idempotencyKey), record: { id: 'idem_dup' } };
				}
				return { duplicate: false, record: { id: 'idem_1' } };
			},
			completeIdempotency: async (_id, result) => {
				state.idempotency.set(overrides.idempotencyKey || 'paddle-refund:adj:adj_1', result);
			},
			failIdempotency: async () => {},
		},
	};
}

const proRegistry = [
	normalizeRegistryEntry({
		provider: 'paddle',
		environment: 'sandbox',
		planSlug: 'pro',
		interval: 'monthly',
		priceId: 'pri_pro_monthly',
	}),
];

const packRegistry = [
	normalizeRegistryEntry({
		provider: 'paddle',
		environment: 'sandbox',
		packId: 'pack-100',
		interval: 'one_time',
		priceId: 'pri_pack_100',
	}),
];

describe('Phase 4.2 event taxonomy', () => {
	it('Paddle routes adjustment.created to refund_adjustment', () => {
		assert.equal(classifyPaddleWebhookEvent('adjustment.created').routing, 'refund_adjustment');
	});

	it('Paddle routes adjustment.updated to refund_adjustment', () => {
		assert.equal(classifyPaddleWebhookEvent('adjustment.updated').routing, 'refund_adjustment');
	});

	it('PayPal routes PAYMENT.SALE.REVERSED to subscription_refund', () => {
		assert.equal(classifyPayPalWebhookEvent('PAYMENT.SALE.REVERSED').routing, 'subscription_refund');
	});

	it('PayPal routes PAYMENT.SALE.REFUNDED to subscription_refund', () => {
		assert.equal(classifyPayPalWebhookEvent('PAYMENT.SALE.REFUNDED').routing, 'subscription_refund');
	});

	it('unknown refund-like Paddle event remains ignored', () => {
		assert.equal(classifyPaddleWebhookEvent('transaction.refunded').routing, 'ignored');
	});
});

describe('Phase 4.2 Paddle refund verification', () => {
	it('accepts refund adjustment actions only', () => {
		assert.equal(isPaddleRefundAdjustmentAction('refund'), true);
		assert.equal(isPaddleRefundAdjustmentAction('chargeback'), true);
		assert.equal(isPaddleRefundAdjustmentAction('credit'), false);
	});

	it('extracts adjustment context from webhook payload', () => {
		const ctx = extractPaddleAdjustmentFromWebhook({
			data: {
				id: 'adj_1',
				action: 'refund',
				transaction_id: 'txn_1',
				subscription_id: 'sub_1',
			},
		});
		assert.equal(ctx.adjustmentId, 'adj_1');
		assert.equal(ctx.transactionId, 'txn_1');
	});

	it('verifies refund adjustment with transaction id', () => {
		const result = verifyPaddleAdjustmentForRefund({
			adjustment: { id: 'adj_1', action: 'refund', transaction_id: 'txn_1' },
		});
		assert.equal(result.ok, true);
		assert.equal(result.adjustmentId, 'adj_1');
	});

	it('rejects non-refund adjustment action', () => {
		const result = verifyPaddleAdjustmentForRefund({
			adjustment: { id: 'adj_1', action: 'credit', transaction_id: 'txn_1' },
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_adjustment_not_refund');
	});

	it('accepts refunded transaction status', () => {
		assert.equal(verifyPaddleTransactionRefundState({ status: 'refunded' }).ok, true);
	});

	it('rejects completed transaction as refund', () => {
		assert.equal(verifyPaddleTransactionRefundState({ status: 'completed' }).ok, false);
	});

	it('classifies subscription refund from registry', () => {
		const result = classifyPaddleRefundPurchaseKind({
			transaction: {
				status: 'refunded',
				details: { line_items: [{ price_id: 'pri_pro_monthly' }] },
				subscription_id: 'sub_1',
			},
			registryEntries: proRegistry,
			environment: 'sandbox',
		});
		assert.equal(result.ok, true);
		assert.equal(result.kind, 'subscription');
		assert.equal(result.planSlug, 'pro');
	});

	it('classifies credit pack refund from registry', () => {
		const result = classifyPaddleRefundPurchaseKind({
			transaction: {
				status: 'refunded',
				details: { line_items: [{ price_id: 'pri_pack_100' }] },
			},
			registryEntries: packRegistry,
			environment: 'sandbox',
		});
		assert.equal(result.ok, true);
		assert.equal(result.kind, 'credit_pack');
		assert.equal(result.packId, 'pack-100');
	});

	it('rejects workspace subscription identity mismatch', () => {
		const result = verifyPaddleRefundWorkspaceIdentity({
			transaction: { custom_data: { workspaceKey: 'ws-kitchen' }, subscription_id: 'sub_other' },
			webhookContext: { workspaceKey: 'ws-kitchen' },
			subscriptionRecord: { workspace_key: 'ws-kitchen', paddle_subscription_id: 'sub_paddle_1' },
			kind: 'subscription',
			subscriptionId: 'sub_other',
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_refund_subscription_identity_mismatch');
	});

	it('buildPaddleRefundIdempotencyKey prefers adjustment id', () => {
		assert.equal(
			buildPaddleRefundIdempotencyKey({ adjustmentId: 'adj_1', transactionId: 'txn_1' }),
			'paddle-refund:adj:adj_1',
		);
	});
});

describe('Phase 4.2 PayPal refund verification', () => {
	it('accepts reversed sale state', () => {
		assert.equal(verifyPayPalSaleReversedState({ state: 'REVERSED' }).ok, true);
	});

	it('rejects completed sale as reversal', () => {
		assert.equal(verifyPayPalSaleReversedState({ state: 'COMPLETED' }).ok, false);
	});

	it('extracts PayPal refund webhook context', () => {
		const ctx = extractPayPalRefundWebhookContext({
			resource: {
				id: 'sale_1',
				billing_agreement_id: 'I-SUB1',
				custom_id: 'ws-kitchen|pro',
			},
		});
		assert.equal(ctx.saleId, 'sale_1');
		assert.equal(ctx.subscriptionId, 'I-SUB1');
		assert.equal(ctx.workspaceKey, 'ws-kitchen');
	});

	it('rejects subscription identity mismatch', () => {
		const result = verifyPayPalSubscriptionRefundIdentity({
			sale: { saleId: 'sale_1', billingAgreementId: 'I-OTHER' },
			webhookContext: { workspaceKey: 'ws-kitchen', saleId: 'sale_1', subscriptionId: 'I-OTHER' },
			subscriptionRecord: {
				workspace_key: 'ws-kitchen',
				provider: 'paypal',
				provider_subscription_id: 'I-SUB1',
			},
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paypal_refund_subscription_identity_mismatch');
	});

	it('buildPayPalRefundIdempotencyKey uses sale id', () => {
		assert.equal(buildPayPalRefundIdempotencyKey({ saleId: 'sale_1' }), 'paypal-refund:sale:sale_1');
	});
});

describe('Phase 4.2 credit pack clawback math', () => {
	it('deducts purchased credits first then balance', () => {
		const result = computeCreditPackClawbackAmounts({
			purchasedCredits: 100,
			balance: 150,
			clawbackAmount: 100,
		});
		assert.equal(result.fromPurchased, 100);
		assert.equal(result.nextPurchased, 0);
		assert.equal(result.nextBalance, 50);
	});

	it('clamps balance at zero when pack credits partially consumed', () => {
		const result = computeCreditPackClawbackAmounts({
			purchasedCredits: 20,
			balance: 30,
			clawbackAmount: 100,
		});
		assert.equal(result.fromPurchased, 20);
		assert.equal(result.nextPurchased, 0);
		assert.equal(result.nextBalance, 0);
	});

	it('does not deduct more than clawback amount', () => {
		const result = computeCreditPackClawbackAmounts({
			purchasedCredits: 100,
			balance: 1000,
			clawbackAmount: 50,
		});
		assert.equal(result.nextPurchased, 50);
		assert.equal(result.nextBalance, 950);
	});
});

describe('Phase 4.2 subscription refund pending lifecycle', () => {
	it('preserves paid plan until period end (refund_pending + cancel_at_period_end)', async () => {
		const { state, deps } = createMockDeps();
		const result = await handleSubscriptionRefundPending({
			workspaceKey: 'ws-kitchen',
			provider: 'paddle',
			providerSubscriptionId: 'sub_paddle_1',
			transactionId: 'txn_1',
			idempotencyKey: 'paddle-refund:adj:adj_1',
			eventId: 'evt_1',
			deps,
		});
		assert.equal(result.handled, true);
		assert.equal(result.refundPending, true);
		assert.equal(result.downgraded, false);
		assert.equal(state.subscription.plan, 'plan_pro');
		assert.equal(state.subscription.billing_status, 'refund_pending');
		assert.equal(state.subscription.cancel_at_period_end, true);
		assert.equal(state.syncCalls.length, 0);
	});

	it('downgrades immediately when period already ended', async () => {
		const { state, deps } = createMockDeps({
			current_period_end: new Date(Date.now() - 86400000).toISOString(),
		});
		const result = await handleSubscriptionRefundPending({
			workspaceKey: 'ws-kitchen',
			provider: 'paypal',
			providerSubscriptionId: 'sub_paddle_1',
			saleId: 'sale_1',
			idempotencyKey: 'paypal-refund:sale:sale_1',
			deps,
		});
		assert.equal(result.downgraded, true);
		assert.equal(state.subscription.plan, 'plan_free');
		assert.equal(state.subscription.billing_status, 'refunded');
		assert.equal(state.syncCalls.length, 1);
	});

	it('does not extend current_period_end on refund pending', async () => {
		const periodEnd = new Date(Date.now() + 5 * 86400000).toISOString();
		const { state, deps } = createMockDeps({ current_period_end: periodEnd });
		await handleSubscriptionRefundPending({
			workspaceKey: 'ws-kitchen',
			provider: 'paddle',
			providerSubscriptionId: 'sub_paddle_1',
			idempotencyKey: 'paddle-refund:adj:adj_2',
			deps,
		});
		assert.equal(state.subscription.current_period_end, periodEnd);
	});

	it('duplicate refund is idempotent', async () => {
		const { deps } = createMockDeps({ idempotencyKey: 'paddle-refund:adj:adj_dup' });
		deps.claimIdempotencyKey = async ({ idempotencyKey }) => ({
			duplicate: true,
			result: { handled: true, refundPending: true },
			record: { id: 'idem_dup' },
		});
		const result = await handleSubscriptionRefundPending({
			workspaceKey: 'ws-kitchen',
			provider: 'paddle',
			providerSubscriptionId: 'sub_paddle_1',
			idempotencyKey: 'paddle-refund:adj:adj_dup',
			deps,
		});
		assert.equal(result.duplicate, true);
	});

	it('identity mismatch fails closed', async () => {
		const { deps } = createMockDeps();
		const result = await handleSubscriptionRefundPending({
			workspaceKey: 'ws-kitchen',
			provider: 'paddle',
			providerSubscriptionId: 'sub_wrong',
			idempotencyKey: 'paddle-refund:adj:adj_bad',
			deps,
		});
		assert.equal(result.handled, false);
		assert.equal(result.error, 'paddle_subscription_identity_mismatch');
	});
});

describe('Phase 4.2 credit pack clawback handler', () => {
	it('claws back verified pack purchase credits', async () => {
		const { state, deps } = createMockDeps();
		const result = await clawbackCreditPackPurchase({
			workspaceKey: 'ws-kitchen',
			transactionId: 'txn_pack_1',
			idempotencyKey: 'paddle-refund:txn:txn_pack_1',
			deps,
		});
		assert.equal(result.handled, true);
		assert.equal(result.clawedBack, 100);
		assert.equal(state.subscription.purchased_credits, 0);
		assert.equal(state.subscription.credits_balance, 50);
	});

	it('fails closed when original pack purchase cannot be identified', async () => {
		const { deps } = createMockDeps({ missingOriginalTx: true });
		const result = await clawbackCreditPackPurchase({
			workspaceKey: 'ws-kitchen',
			transactionId: 'txn_unknown',
			idempotencyKey: 'paddle-refund:txn:txn_unknown',
			deps,
		});
		assert.equal(result.handled, false);
		assert.equal(result.error, 'original_pack_purchase_not_found');
	});
});

describe('Phase 4.2 period-end helper', () => {
	it('shouldImmediatelyDowngradeSubscription detects expired period', () => {
		assert.equal(
			shouldImmediatelyDowngradeSubscription(new Date(Date.now() - 1000).toISOString()),
			true,
		);
		assert.equal(
			shouldImmediatelyDowngradeSubscription(new Date(Date.now() + 86400000).toISOString()),
			false,
		);
	});
});

describe('Phase 4.2 certified paths unchanged (static)', () => {
	it('Paddle transaction verification core untouched', () => {
		const source = readSrc('services/billing/paddle-transaction-verification.js');
		assert.match(source, /verifyPaddleTransactionForFulfillment/);
		assert.doesNotMatch(source, /refund-lifecycle/);
	});

	it('PayPal activation verification untouched', () => {
		const source = readSrc('services/billing/paypal-transaction-verification.js');
		assert.match(source, /verifyPayPalSubscriptionForActivation/);
		assert.doesNotMatch(source, /refund-lifecycle/);
	});

	it('billing_type enforcement unchanged (Phase 4.1)', () => {
		const source = readSrc('services/workspace-billing.js');
		assert.match(source, /resolveAuthoritativePlanBillingType/);
	});

	it('upgradeSubscription HTTP gate remains blocked', () => {
		const routes = readSrc('routes/workspace/index.js');
		assert.doesNotMatch(routes, /subscription\/upgrade/);
	});

	it('Paddle HMAC verification unchanged', () => {
		const source = readSrc('services/billing/providers/paddle-webhook-helpers.js');
		assert.match(source, /verifyPaddleWebhookSignature/);
	});
});

describe('Phase 4.2 idempotency key stability', () => {
	it('same Paddle refund transaction yields stable idempotency key', () => {
		const a = buildPaddleRefundIdempotencyKey({ adjustmentId: 'adj_99', transactionId: 'txn_99' });
		const b = buildPaddleRefundIdempotencyKey({ adjustmentId: 'adj_99', transactionId: 'txn_99' });
		assert.equal(a, b);
	});

	it('same PayPal sale yields stable idempotency key regardless of event id', () => {
		const a = buildPayPalRefundIdempotencyKey({ saleId: 'sale_abc' });
		const b = buildPayPalRefundIdempotencyKey({ saleId: 'sale_abc' });
		assert.equal(a, b);
		assert.equal(a, 'paypal-refund:sale:sale_abc');
	});

	it('PayPal refund idempotency key uses provider refund id when available', () => {
		const a = buildPayPalRefundIdempotencyKey({ saleId: 'sale_abc', refundId: 'refund_xyz' });
		const b = buildPayPalRefundIdempotencyKey({ saleId: 'sale_abc', refundId: 'refund_xyz' });
		assert.equal(a, b);
		assert.equal(a, 'paypal-refund:sale_abc:refund_xyz');
	});
});
