/**
 * Phase 4.4-D — Paddle subscription reconciliation DB writes tests.
 * Run: node --test src/services/billing/paddle-subscription-reconcile.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeRegistryEntry } from './price-registry.js';
import {
	buildPaddleSubscriptionReconciliationPatch,
	isRefundPendingSubscription,
	mapPaddleSubscriptionStatusToLocal,
	reconcilePaddleSubscription,
	resolveReconciliationPlanFromPrice,
} from './paddle-subscription-reconcile.js';
import { handlePaddleSubscriptionUpdatedEvent } from './paddle-subscription-updated-handler.js';
import { fetchAndVerifyPaddleSubscriptionForReconciliation } from './paddle-subscription-reconciliation.js';
import { classifyPaddleWebhookEvent } from './providers/paddle-webhook-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reconcileSource = readFileSync(join(__dirname, 'paddle-subscription-reconcile.js'), 'utf8');
const fulfillmentSource = readFileSync(join(__dirname, 'paddle-webhook-fulfillment.js'), 'utf8');
const subscriptionsSource = readFileSync(join(__dirname, 'subscriptions.js'), 'utf8');

const sandboxConfig = { apiKey: 'test_api_key', sandbox: true };
const registryEntries = [
	normalizeRegistryEntry({
		provider: 'paddle',
		environment: 'sandbox',
		planSlug: 'pro',
		interval: 'monthly',
		priceId: 'pri_pro_monthly',
	}),
	normalizeRegistryEntry({
		provider: 'paddle',
		environment: 'sandbox',
		planSlug: 'pro',
		interval: 'yearly',
		priceId: 'pri_pro_yearly',
	}),
];

const verifiedSnapshot = {
	ok: true,
	subscriptionId: 'sub_paddle_1',
	status: 'active',
	scheduledChange: null,
	cancelScheduledAtPeriodEnd: false,
	priceId: 'pri_pro_monthly',
	interval: 'monthly',
	currentBillingPeriod: {
		startsAt: '2026-08-01T00:00:00.000Z',
		endsAt: '2026-09-01T00:00:00.000Z',
	},
	customerId: 'ctm_123',
};

function localSubscription(overrides = {}) {
	return {
		id: 'local_sub_1',
		workspace_key: 'ws-kitchen',
		workspace_name: 'Kitchen',
		paddle_subscription_id: 'sub_paddle_1',
		provider: 'paddle',
		provider_subscription_id: 'sub_paddle_1',
		plan: 'plan_starter',
		status: 'active',
		billing_status: 'active',
		credits_balance: 250,
		cancel_at_period_end: false,
		paddle_price_id: 'pri_starter_monthly',
		billing_interval: 'monthly',
		current_period_start: '2026-07-01T00:00:00.000Z',
		current_period_end: '2026-08-01T00:00:00.000Z',
		...overrides,
	};
}

function createReconcileDeps(overrides = {}) {
	const state = {
		subscription: localSubscription(overrides.subscription),
		updates: [],
		mirrorCalls: [],
		auditCalls: [],
	};

	return {
		state,
		deps: {
			loadPlan: async (slug) => {
				if (slug === 'pro') return { id: 'plan_pro', slug: 'pro', billing_type: 'paid' };
				if (slug === 'starter') return { id: 'plan_starter', slug: 'starter', billing_type: 'paid' };
				return null;
			},
			updateSubscription: async (id, patch) => {
				state.updates.push({ id, patch });
				Object.assign(state.subscription, patch);
				return state.subscription;
			},
			syncEntitlementMirrors: async (input) => {
				state.mirrorCalls.push(input);
			},
			logBillingAction: async (entry) => {
				state.auditCalls.push(entry);
			},
			...overrides.deps,
		},
	};
}

describe('Phase 4.4-D reconcilePaddleSubscription', () => {
	it('reconciles identity, price, interval, and billing period fields', async () => {
		const { state, deps } = createReconcileDeps();
		const result = await reconcilePaddleSubscription({
			subscriptionRecord: state.subscription,
			verified: verifiedSnapshot,
			environment: 'sandbox',
			registryEntries,
			eventId: 'evt_1',
			deps,
		});

		assert.equal(result.ok, true);
		assert.equal(result.reconciled, true);
		assert.equal(state.updates.length, 1);
		const patch = state.updates[0].patch;
		assert.equal(patch.paddle_subscription_id, 'sub_paddle_1');
		assert.equal(patch.provider_subscription_id, 'sub_paddle_1');
		assert.equal(patch.paddle_customer_id, 'ctm_123');
		assert.equal(patch.paddle_price_id, 'pri_pro_monthly');
		assert.equal(patch.billing_interval, 'monthly');
		assert.equal(patch.billing_environment, 'sandbox');
		assert.equal(patch.current_period_start, '2026-08-01T00:00:00.000Z');
		assert.equal(patch.current_period_end, '2026-09-01T00:00:00.000Z');
		assert.equal(patch.plan, 'plan_pro');
		assert.equal(state.subscription.credits_balance, 250);
	});

	it('reconciles scheduled cancellation state', async () => {
		const { state, deps } = createReconcileDeps();
		const result = await reconcilePaddleSubscription({
			subscriptionRecord: state.subscription,
			verified: {
				...verifiedSnapshot,
				scheduledChange: { action: 'cancel', effectiveAt: '2026-09-01T00:00:00.000Z' },
				cancelScheduledAtPeriodEnd: true,
			},
			environment: 'sandbox',
			registryEntries,
			deps,
		});

		assert.equal(result.ok, true);
		assert.equal(state.updates[0].patch.cancel_at_period_end, true);
		assert.equal(state.updates[0].patch.billing_status, 'cancel_scheduled');
	});

	it('syncs plan from registry price mapping and mirrors when plan changes', async () => {
		const { state, deps } = createReconcileDeps();
		const result = await reconcilePaddleSubscription({
			subscriptionRecord: state.subscription,
			verified: verifiedSnapshot,
			environment: 'sandbox',
			registryEntries,
			deps,
		});

		assert.equal(result.planChanged, true);
		assert.equal(result.mirrorSynced, true);
		assert.equal(state.mirrorCalls.length, 1);
		assert.equal(state.mirrorCalls[0].workspaceKey, 'ws-kitchen');
		assert.equal(state.mirrorCalls[0].plan.slug, 'pro');
	});

	it('fails closed when local subscription is missing', async () => {
		const result = await reconcilePaddleSubscription({
			subscriptionRecord: null,
			verified: verifiedSnapshot,
			environment: 'sandbox',
			registryEntries,
			deps: createReconcileDeps().deps,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_reconciliation_subscription_not_found');
	});

	it('fails closed when price is not in registry', async () => {
		const { state, deps } = createReconcileDeps();
		const result = await reconcilePaddleSubscription({
			subscriptionRecord: state.subscription,
			verified: { ...verifiedSnapshot, priceId: 'pri_unknown' },
			environment: 'sandbox',
			registryEntries,
			deps,
		});
		assert.equal(result.error, 'paddle_reconciliation_price_not_in_registry');
	});

	it('fails closed on interval mismatch with registry', async () => {
		const resolution = resolveReconciliationPlanFromPrice({
			verified: { ...verifiedSnapshot, interval: 'yearly', priceId: 'pri_pro_monthly' },
			registryEntries,
			environment: 'sandbox',
		});
		assert.equal(resolution.ok, false);
		assert.equal(resolution.error, 'paddle_reconciliation_interval_mismatch');
	});

	it('preserves refund_pending billing state and plan', async () => {
		const { state, deps } = createReconcileDeps({
			subscription: {
				billing_status: 'refund_pending',
				cancel_at_period_end: true,
				plan: 'plan_pro',
				status: 'active',
			},
		});

		const result = await reconcilePaddleSubscription({
			subscriptionRecord: state.subscription,
			verified: {
				...verifiedSnapshot,
				cancelScheduledAtPeriodEnd: false,
				status: 'canceled',
			},
			environment: 'sandbox',
			registryEntries,
			deps,
		});

		assert.equal(result.ok, true);
		assert.equal(result.refundPending, true);
		const patch = state.updates[0].patch;
		assert.equal(patch.billing_status, undefined);
		assert.equal(patch.status, undefined);
		assert.equal(patch.cancel_at_period_end, undefined);
		assert.equal(patch.plan, undefined);
		assert.equal(state.subscription.billing_status, 'refund_pending');
		assert.equal(state.subscription.plan, 'plan_pro');
		assert.equal(state.mirrorCalls.length, 0);
		assert.equal(patch.paddle_price_id, 'pri_pro_monthly');
		assert.equal(patch.current_period_end, '2026-09-01T00:00:00.000Z');
	});

	it('does not mutate credits', async () => {
		const { state, deps } = createReconcileDeps({ subscription: { credits_balance: 999 } });
		await reconcilePaddleSubscription({
			subscriptionRecord: state.subscription,
			verified: verifiedSnapshot,
			environment: 'sandbox',
			registryEntries,
			deps,
		});
		assert.equal(state.subscription.credits_balance, 999);
		assert.equal(reconcileSource.includes('credits_balance'), false);
	});

	it('fails closed on unsupported Paddle status', async () => {
		const patch = buildPaddleSubscriptionReconciliationPatch({
			subscription: localSubscription(),
			verified: { ...verifiedSnapshot, status: 'paused' },
			environment: 'sandbox',
			planRecord: { id: 'plan_pro', slug: 'pro' },
		});
		assert.equal(patch.ok, false);
		assert.equal(patch.error, 'paddle_reconciliation_status_unsupported');
	});
});

describe('Phase 4.4-D handler integration', () => {
	function createMockIdempotency(store) {
		return {
			claimIdempotencyKey: async ({ idempotencyKey, scope, workspaceKey, provider, eventType, payload }) => {
				if (store.has(idempotencyKey)) {
					const record = store.get(idempotencyKey);
					return { claimed: false, duplicate: true, record, result: record.result };
				}
				const record = {
					id: `idem_${store.size + 1}`,
					idempotency_key: idempotencyKey,
					scope,
					workspace_key: workspaceKey,
					provider,
					event_type: eventType,
					status: 'processing',
					payload: payload || {},
					result: {},
					processed_at: null,
					updated: new Date().toISOString(),
					created: new Date().toISOString(),
				};
				store.set(idempotencyKey, record);
				return { claimed: true, duplicate: false, record };
			},
			completeIdempotency: async (recordId, result = {}) => {
				const record = [...store.values()].find((entry) => entry.id === recordId);
				if (record) {
					record.status = 'completed';
					record.result = result;
				}
				return record;
			},
			failIdempotency: async (recordId, errorMessage = '') => {
				const record = [...store.values()].find((entry) => entry.id === recordId);
				if (record) {
					record.status = 'failed';
					record.result = { error: errorMessage };
				}
				return record;
			},
			resetIdempotencyForRetry: async (recordId, { payload } = {}) => {
				const record = [...store.values()].find((entry) => entry.id === recordId);
				if (record) {
					record.status = 'processing';
					record.result = {};
					record.processed_at = null;
					if (payload) record.payload = payload;
				}
				return record;
			},
		};
	}

	function buildHandlerHarness(overrides = {}) {
		const state = {
			subscription: localSubscription(overrides.subscription),
			updates: [],
			webhookUpdates: [],
			mirrorCalls: [],
			idempotencyStore: overrides.idempotencyStore || new Map(),
		};

		const idempotency = createMockIdempotency(state.idempotencyStore);

		const fetchImpl = overrides.fetchImpl || (async (url) => {
			assert.match(String(url), /\/subscriptions\/sub_paddle_1$/);
			return {
				ok: true,
				status: 200,
				json: async () => ({
					data: {
						id: 'sub_paddle_1',
						status: 'active',
						customer_id: 'ctm_123',
						items: [{
							price_id: 'pri_pro_monthly',
							price: {
								id: 'pri_pro_monthly',
								billing_cycle: { interval: 'month', frequency: 1 },
							},
						}],
						current_billing_period: {
							starts_at: '2026-08-01T00:00:00.000Z',
							ends_at: '2026-09-01T00:00:00.000Z',
						},
						scheduled_change: null,
					},
				}),
			};
		});

		return {
			state,
			async run() {
				return handlePaddleSubscriptionUpdatedEvent({
					config: sandboxConfig,
					parsed: {
						idempotencyKey: 'evt_sub_updated_01',
						eventType: 'subscription.updated',
						payload: {
							event_type: 'subscription.updated',
							data: { id: 'sub_paddle_1', custom_data: { workspaceKey: 'ws-kitchen' } },
						},
						context: { subscriptionId: 'sub_paddle_1', workspaceKey: 'ws-kitchen' },
					},
					webhookRecord: { id: 'wh_1', status: 'processing' },
					fetchImpl,
					deps: {
						updateWebhookEvent: async (_id, patch) => {
							state.webhookUpdates.push(patch);
						},
						loadSubscriptionByWorkspace: async () => state.subscription,
						loadRegistryEntries: async () => registryEntries,
						loadPlan: async (slug) => (slug === 'pro'
							? { id: 'plan_pro', slug: 'pro', billing_type: 'paid' }
							: null),
						updateSubscription: async (id, patch) => {
							state.updates.push({ id, patch });
							Object.assign(state.subscription, patch);
						},
						syncEntitlementMirrors: async (input) => {
							state.mirrorCalls.push(input);
						},
						...idempotency,
						...overrides.deps,
					},
				});
			},
		};
	}

	it('handler performs verify then reconcile DB writes', async () => {
		const harness = buildHandlerHarness();
		const result = await harness.run();
		assert.equal(result.result.reconciled, true);
		assert.equal(harness.state.updates.length, 1);
		assert.equal(harness.state.webhookUpdates.some((row) => row.status === 'processed'), true);
	});

	it('fails closed when local subscription missing', async () => {
		const harness = buildHandlerHarness({
			deps: {
				loadSubscriptionByWorkspace: async () => null,
			},
		});
		const result = await harness.run();
		assert.equal(result.result.reason, 'paddle_reconciliation_subscription_not_found');
	});

	it('does not invoke activation or renewal services', () => {
		assert.equal(reconcileSource.includes('activatePaddleSubscription'), false);
		assert.equal(reconcileSource.includes('renewPaddleSubscription'), false);
		assert.equal(reconcileSource.includes('handlePaddleCancellation'), false);
		assert.equal(reconcileSource.includes('clawbackCreditPackPurchase'), false);
		assert.match(fulfillmentSource, /reconcilePaddleSubscription/);
		assert.equal(subscriptionsSource.includes('reconcilePaddleSubscription'), false);
	});
});

describe('Phase 4.4-D fulfillment isolation regression', () => {
	it('transaction.completed routing unchanged', () => {
		assert.equal(classifyPaddleWebhookEvent('transaction.completed').routing, 'subscription_success');
	});

	it('subscription.updated still routes to subscription_reconcile', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.updated').routing, 'subscription_reconcile');
	});

	it('mapPaddleSubscriptionStatusToLocal normalizes cancelled spelling', () => {
		assert.equal(mapPaddleSubscriptionStatusToLocal('cancelled'), 'canceled');
	});

	it('isRefundPendingSubscription detects refund_pending', () => {
		assert.equal(isRefundPendingSubscription({ billing_status: 'refund_pending' }), true);
		assert.equal(isRefundPendingSubscription({ billing_status: 'active' }), false);
	});
});

describe('Phase 4.4-D fetchAndVerify integration for identity mismatch', () => {
	it('identity mismatch fails before reconcile writes', async () => {
		const fetchImpl = async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				data: {
					id: 'sub_paddle_1',
					status: 'active',
					customer_id: 'ctm_123',
					items: [{
						price: {
							id: 'pri_pro_monthly',
							billing_cycle: { interval: 'month', frequency: 1 },
						},
					}],
					current_billing_period: {
						starts_at: '2026-08-01T00:00:00.000Z',
						ends_at: '2026-09-01T00:00:00.000Z',
					},
				},
			}),
		});

		const verified = await fetchAndVerifyPaddleSubscriptionForReconciliation({
			subscriptionId: 'sub_paddle_1',
			subscriptionRecord: { paddle_subscription_id: 'sub_other' },
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
		});
		assert.equal(verified.ok, false);
		assert.equal(verified.error, 'paddle_subscription_identity_mismatch');
	});
});
