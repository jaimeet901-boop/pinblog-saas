/**
 * Phase 4.4-E — Paddle subscription reconciliation idempotency tests.
 * Run: node --test src/services/billing/paddle-subscription-reconciliation-idempotency.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildSubscriptionReconcileIdempotencyKey,
	RECONCILIATION_IDEMPOTENCY_STALE_MS,
} from './reconciliation-idempotency-keys.js';
import {
	buildSubscriptionReconcileIdempotencyKey as buildKeyFromModule,
	acquireReconciliationClaim,
} from './paddle-subscription-reconciliation-idempotency.js';
import { buildSubscriptionCancelIdempotencyKey } from './cancellation-idempotency-keys.js';
import { handlePaddleSubscriptionUpdatedEvent } from './paddle-subscription-updated-handler.js';
import { reconcilePaddleSubscription } from './paddle-subscription-reconcile.js';
import { normalizeRegistryEntry } from './price-registry.js';
import {
	buildPaddleWebhookParseResult,
	classifyPaddleWebhookEvent,
} from './providers/paddle-webhook-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(__dirname, '..', '..');

function readSrc(relativePath) {
	return readFileSync(join(apiSrc, relativePath), 'utf8');
}

const sandboxConfig = { apiKey: 'test_api_key', sandbox: true };
const handlerRegistryEntries = [
	normalizeRegistryEntry({
		provider: 'paddle',
		environment: 'sandbox',
		planSlug: 'pro',
		interval: 'monthly',
		priceId: 'pri_pro_monthly',
	}),
];

function subscriptionUpdatedPayload(overrides = {}) {
	const { data: dataOverrides = {}, ...restOverrides } = overrides;
	return {
		event_id: 'evt_sub_updated_01',
		event_type: 'subscription.updated',
		data: {
			id: 'sub_paddle_1',
			status: 'active',
			custom_data: { workspaceKey: 'ws-kitchen', planSlug: 'pro' },
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
			...dataOverrides,
		},
		...restOverrides,
	};
}

function validApiSubscription(overrides = {}) {
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
		plan: 'plan_pro',
		status: 'active',
		billing_status: 'active',
		credits_balance: 500,
		...overrides,
	};
}

function buildParsed(payload = subscriptionUpdatedPayload()) {
	return buildPaddleWebhookParseResult(payload, sandboxConfig);
}

function createMockIdempotency(state) {
	const store = state.idempotencyStore;

	return {
		claimIdempotencyKey: async ({
			idempotencyKey,
			scope,
			workspaceKey,
			provider,
			eventType,
			payload,
		}) => {
			state.claimCalls.push({ idempotencyKey, scope, workspaceKey, provider, eventType });
			if (store.has(idempotencyKey)) {
				const record = store.get(idempotencyKey);
				return {
					claimed: false,
					duplicate: true,
					record,
					result: record.result,
				};
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
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
			};
			store.set(idempotencyKey, record);
			return { claimed: true, duplicate: false, record };
		},
		completeIdempotency: async (recordId, result = {}) => {
			const record = [...store.values()].find((entry) => entry.id === recordId);
			if (record) {
				record.status = 'completed';
				record.result = result;
				record.processed_at = new Date().toISOString();
				record.updated = new Date().toISOString();
			}
			state.idempotencyOps.push({ op: 'complete', recordId, result });
			return record;
		},
		failIdempotency: async (recordId, errorMessage = '') => {
			const record = [...store.values()].find((entry) => entry.id === recordId);
			if (record) {
				record.status = 'failed';
				record.result = { error: errorMessage };
				record.processed_at = new Date().toISOString();
				record.updated = new Date().toISOString();
			}
			state.idempotencyOps.push({ op: 'fail', recordId, errorMessage });
			return record;
		},
		resetIdempotencyForRetry: async (recordId, { payload } = {}) => {
			const record = [...store.values()].find((entry) => entry.id === recordId);
			if (record) {
				record.status = 'processing';
				record.result = {};
				record.processed_at = null;
				if (payload) record.payload = payload;
				record.updated = new Date().toISOString();
			}
			state.idempotencyOps.push({ op: 'reset', recordId });
			return record;
		},
	};
}

function createHarness(overrides = {}) {
	const webhookUpdates = [];
	const subscriptionMutations = [];
	const record = { id: 'wh_1', status: 'processing' };
	const state = {
		claimCalls: [],
		idempotencyOps: [],
		idempotencyStore: overrides.idempotencyStore || new Map(),
		reconcileCalls: [],
		reconcileDelayMs: overrides.reconcileDelayMs ?? 0,
	};

	const idempotency = createMockIdempotency(state);

	const fetchImpl = overrides.fetchImpl || (async (url) => {
		assert.match(String(url), /\/subscriptions\/sub_paddle_1$/);
		return {
			ok: true,
			status: 200,
			json: async () => ({ data: validApiSubscription(overrides.apiSubscription) }),
		};
	});

	const updateWebhookEvent = async (_id, patch) => {
		webhookUpdates.push(patch);
		Object.assign(record, patch);
		return patch;
	};

	const deps = {
		loadSubscriptionByWorkspace: overrides.loadSubscriptionByWorkspace
			|| (async () => localSubscriptionRecord(overrides.localRecord)),
		loadSubscriptionByPaddleId: overrides.loadSubscriptionByPaddleId
			|| (async () => localSubscriptionRecord(overrides.localRecord)),
		loadRegistryEntries: overrides.loadRegistryEntries
			|| (async () => handlerRegistryEntries),
		loadPlan: overrides.loadPlan
			|| (async (slug) => (slug === 'pro' ? { id: 'plan_pro', slug: 'pro', billing_type: 'paid' } : null)),
		updateSubscription: overrides.updateSubscription
			|| (async (id, patch) => {
				subscriptionMutations.push({ id, patch });
			}),
		syncEntitlementMirrors: overrides.syncEntitlementMirrors || (async () => {}),
		reconcilePaddleSubscription: overrides.reconcilePaddleSubscription || (async (input) => {
			state.reconcileCalls.push(input);
			if (state.reconcileDelayMs > 0) {
				await new Promise((resolve) => { setTimeout(resolve, state.reconcileDelayMs); });
			}
			return reconcilePaddleSubscription(input);
		}),
		...idempotency,
		reconciliationProcessingStaleMs: overrides.reconciliationProcessingStaleMs,
		updateWebhookEvent,
		persistWebhookFailure: async (recordId, error, decision) => updateWebhookEvent(recordId, {
			status: 'failed',
			error: error?.message || String(error || decision || 'unknown'),
		}),
	};

	return {
		state,
		webhookUpdates,
		subscriptionMutations,
		record,
		fetchImpl,
		deps,
		async run(parsed = buildParsed(overrides.payload)) {
			return handlePaddleSubscriptionUpdatedEvent({
				config: sandboxConfig,
				parsed,
				webhookRecord: record,
				fetchImpl,
				deps,
			});
		},
	};
}

describe('buildSubscriptionReconcileIdempotencyKey', () => {
	it('uses deterministic subscription_reconcile:paddle prefix with subscription and event IDs', () => {
		const key = buildSubscriptionReconcileIdempotencyKey('sub_paddle_1', 'evt_sub_updated_01');
		assert.equal(key, 'subscription_reconcile:paddle:sub_paddle_1:evt_sub_updated_01');
		assert.equal(key, buildKeyFromModule('sub_paddle_1', 'evt_sub_updated_01'));
	});

	it('different event ID produces different key', () => {
		const a = buildSubscriptionReconcileIdempotencyKey('sub_paddle_1', 'evt_1');
		const b = buildSubscriptionReconcileIdempotencyKey('sub_paddle_1', 'evt_2');
		assert.notEqual(a, b);
	});

	it('different subscription ID produces different key', () => {
		const a = buildSubscriptionReconcileIdempotencyKey('sub_a', 'evt_1');
		const b = buildSubscriptionReconcileIdempotencyKey('sub_b', 'evt_1');
		assert.notEqual(a, b);
	});

	it('reconciliation scope differs from cancellation scope', () => {
		const reconcileKey = buildSubscriptionReconcileIdempotencyKey('sub_paddle_1', 'evt_1');
		const cancelKey = buildSubscriptionCancelIdempotencyKey('ws-kitchen', 'paddle', 'sub_paddle_1');
		assert.notEqual(reconcileKey, cancelKey);
		assert.match(reconcileKey, /^subscription_reconcile:/);
		assert.match(cancelKey, /^subscription_cancel:/);
	});
});

describe('Phase 4.4-E reconciliation idempotency', () => {
	it('first reconciliation claims successfully and completes', async () => {
		const { state, deps } = createHarness();
		const result = await handlePaddleSubscriptionUpdatedEvent({
			config: sandboxConfig,
			parsed: buildParsed(),
			webhookRecord: { id: 'wh_1', status: 'processing' },
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({ data: validApiSubscription() }),
			}),
			deps,
		});
		assert.equal(result.result.reconciled, true);
		assert.equal(state.claimCalls.length, 1);
		assert.equal(state.claimCalls[0].scope, 'subscription_reconcile');
		assert.equal(
			state.claimCalls[0].idempotencyKey,
			'subscription_reconcile:paddle:sub_paddle_1:evt_sub_updated_01',
		);
		assert.ok(state.idempotencyOps.some((op) => op.op === 'complete'));
		assert.equal(state.reconcileCalls.length, 1);
	});

	it('same event duplicate does not perform second reconciliation DB mutation', async () => {
		const store = new Map();
		const harness = createHarness({ idempotencyStore: store });
		await harness.run();
		const firstMutations = harness.subscriptionMutations.length;
		const firstReconcileCalls = harness.state.reconcileCalls.length;

		const result = await harness.run();

		assert.equal(result.result.duplicate, true);
		assert.equal(result.result.idempotent, true);
		assert.equal(result.result.reconciled, true);
		assert.equal(harness.state.reconcileCalls.length, firstReconcileCalls);
		assert.equal(harness.subscriptionMutations.length, firstMutations);
	});

	it('completed idempotency record returns stored result without reconcile call', async () => {
		const store = new Map();
		const key = buildSubscriptionReconcileIdempotencyKey('sub_paddle_1', 'evt_sub_updated_01');
		store.set(key, {
			id: 'idem_done',
			idempotency_key: key,
			scope: 'subscription_reconcile',
			status: 'completed',
			result: {
				handled: true,
				reconciled: true,
				subscriptionId: 'sub_paddle_1',
				workspaceKey: 'ws-kitchen',
				planChanged: false,
			},
			updated: new Date().toISOString(),
			created: new Date().toISOString(),
		});
		const harness = createHarness({ idempotencyStore: store });
		const result = await harness.run();
		assert.equal(result.result.duplicate, true);
		assert.equal(result.result.idempotent, true);
		assert.equal(result.result.reconciled, true);
		assert.equal(result.result.workspaceKey, 'ws-kitchen');
		assert.equal(harness.state.reconcileCalls.length, 0);
	});

	it('different event IDs allow separate reconciliation claims', async () => {
		const store = new Map();
		const harness1 = createHarness({ idempotencyStore: store });
		await harness1.run(buildParsed(subscriptionUpdatedPayload({ event_id: 'evt_a' })));

		const harness2 = createHarness({ idempotencyStore: store });
		const result = await harness2.run(buildParsed(subscriptionUpdatedPayload({ event_id: 'evt_b' })));

		assert.equal(result.result.reconciled, true);
		assert.equal(store.size, 2);
		assert.equal(harness2.state.reconcileCalls.length, 1);
	});

	it('different subscription IDs produce different keys and separate claims', async () => {
		const store = new Map();
		const harness1 = createHarness({
			idempotencyStore: store,
			localRecord: { paddle_subscription_id: 'sub_a', provider_subscription_id: 'sub_a' },
			fetchImpl: async (url) => ({
				ok: true,
				status: 200,
				json: async () => ({ data: validApiSubscription({ id: 'sub_a' }) }),
			}),
		});
		await harness1.run(buildParsed(subscriptionUpdatedPayload({
			data: { id: 'sub_a', custom_data: { workspaceKey: 'ws-kitchen' } },
		})));

		const harness2 = createHarness({
			idempotencyStore: store,
			localRecord: { paddle_subscription_id: 'sub_b', provider_subscription_id: 'sub_b' },
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({ data: validApiSubscription({ id: 'sub_b' }) }),
			}),
		});
		const result = await harness2.run(buildParsed(subscriptionUpdatedPayload({
			event_id: 'evt_sub_updated_01',
			data: { id: 'sub_b', custom_data: { workspaceKey: 'ws-kitchen' } },
		})));

		assert.equal(result.result.reconciled, true);
		assert.equal(store.size, 2);
	});

	it('claim stores workspace_key for isolation audit', async () => {
		const harness = createHarness({
			localRecord: { workspace_key: 'ws-isolated' },
			payload: subscriptionUpdatedPayload({
				data: { custom_data: { workspaceKey: 'ws-isolated', planSlug: 'pro' } },
			}),
		});
		await harness.run();
		assert.equal(harness.state.claimCalls[0].workspaceKey, 'ws-isolated');
	});

	it('reconcile failure leaves operation retryable', async () => {
		const store = new Map();
		const harness = createHarness({
			idempotencyStore: store,
			reconcilePaddleSubscription: async () => ({ ok: false, error: 'reconcile_db_error' }),
		});
		const result = await harness.run();
		assert.equal(result.result.reconciled, false);
		assert.equal(result.result.retryable, true);
		const key = buildSubscriptionReconcileIdempotencyKey('sub_paddle_1', 'evt_sub_updated_01');
		assert.equal(store.get(key).status, 'failed');
		assert.ok(harness.state.idempotencyOps.some((op) => op.op === 'fail'));
		assert.equal(harness.subscriptionMutations.length, 0);
	});

	it('retry after failure reclaims and succeeds', async () => {
		const store = new Map();
		let failOnce = true;
		const harness = createHarness({
			idempotencyStore: store,
			reconcilePaddleSubscription: async (input) => {
				harness.state.reconcileCalls.push(input);
				if (failOnce) {
					failOnce = false;
					return { ok: false, error: 'transient_error' };
				}
				return reconcilePaddleSubscription(input);
			},
		});
		const first = await harness.run();
		assert.equal(first.result.retryable, true);

		const retry = await harness.run();
		assert.equal(retry.result.reconciled, true);
		assert.equal(harness.state.reconcileCalls.length, 2);
		assert.ok(harness.state.idempotencyOps.some((op) => op.op === 'reset'));
		const key = buildSubscriptionReconcileIdempotencyKey('sub_paddle_1', 'evt_sub_updated_01');
		assert.equal(store.get(key).status, 'completed');
	});

	it('two simultaneous attempts → only one reconciliation DB mutation', async () => {
		const store = new Map();
		const harness = createHarness({
			idempotencyStore: store,
			reconcileDelayMs: 80,
		});
		const first = harness.run();
		await new Promise((resolve) => { setTimeout(resolve, 5); });
		const second = harness.run();
		const results = await Promise.all([first, second]);

		const reconciledCount = results.filter((entry) => entry.result.reconciled === true
			&& !entry.result.duplicate).length;
		const inProgressCount = results.filter((entry) => entry.result.reason === 'reconciliation_in_progress').length;
		assert.equal(reconciledCount + inProgressCount, 2);
		assert.equal(harness.subscriptionMutations.length, 1);
		assert.equal(store.size, 1);
	});

	it('abandoned processing claim can be recovered after stale threshold', async () => {
		const store = new Map();
		const key = buildSubscriptionReconcileIdempotencyKey('sub_paddle_1', 'evt_sub_updated_01');
		const staleUpdated = new Date(Date.now() - RECONCILIATION_IDEMPOTENCY_STALE_MS - 1000).toISOString();
		store.set(key, {
			id: 'idem_stale',
			idempotency_key: key,
			scope: 'subscription_reconcile',
			status: 'processing',
			result: {},
			updated: staleUpdated,
			created: staleUpdated,
		});
		const harness = createHarness({ idempotencyStore: store });
		const result = await harness.run();
		assert.equal(result.result.reconciled, true);
		assert.ok(harness.state.idempotencyOps.some((op) => op.op === 'reset'));
		assert.equal(harness.state.reconcileCalls.length, 1);
	});

	it('verification failure does not claim idempotency', async () => {
		const harness = createHarness({
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({ data: validApiSubscription({ items: [] }) }),
			}),
		});
		const result = await harness.run();
		assert.equal(result.result.verified, false);
		assert.equal(harness.state.claimCalls.length, 0);
	});
});

describe('acquireReconciliationClaim unit', () => {
	it('returns inProgress for fresh processing duplicate', async () => {
		const store = new Map();
		const key = buildSubscriptionReconcileIdempotencyKey('sub_1', 'evt_1');
		store.set(key, {
			id: 'idem_proc',
			idempotency_key: key,
			scope: 'subscription_reconcile',
			status: 'processing',
			result: {},
			updated: new Date().toISOString(),
			created: new Date().toISOString(),
		});
		const mock = createMockIdempotency({ idempotencyStore: store, claimCalls: [], idempotencyOps: [] });
		const result = await acquireReconciliationClaim({
			subscriptionId: 'sub_1',
			eventId: 'evt_1',
			workspaceKey: 'ws-a',
			deps: mock,
		});
		assert.equal(result.ok, false);
		assert.equal(result.inProgress, true);
		assert.equal(result.error, 'reconciliation_in_progress');
	});
});

describe('Phase 4.4-E regression guards (static)', () => {
	it('uses billing_idempotency infrastructure without second system', () => {
		const source = readSrc('services/billing/paddle-subscription-reconciliation-idempotency.js');
		assert.match(source, /claimIdempotencyKey|claim:/);
		assert.match(source, /scope: 'subscription_reconcile'/);
		assert.match(source, /buildSubscriptionReconcileIdempotencyKey/);
		assert.doesNotMatch(source, /randomUUID|crypto\.random|Date\.now\(\).*idempotency/i);
		assert.doesNotMatch(source, /createReconciliationIdempotency|reconciliation_idempotency_store/i);
	});

	it('handler integrates idempotency before reconcile DB writes', () => {
		const source = readSrc('services/billing/paddle-subscription-updated-handler.js');
		assert.match(source, /acquireReconciliationClaim/);
		assert.match(source, /completeReconciliationIdempotency/);
		assert.match(source, /failReconciliationIdempotency/);
		const claimIdx = source.indexOf('acquireReconciliationClaim');
		const reconcileIdx = source.indexOf('reconcileFn({');
		assert.ok(claimIdx > 0 && reconcileIdx > claimIdx);
	});

	it('transaction.completed routing unchanged', () => {
		assert.equal(classifyPaddleWebhookEvent('transaction.completed').routing, 'subscription_success');
	});

	it('cancellation routing unchanged', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.canceled').routing, 'cancel');
	});

	it('refund routing unchanged', () => {
		assert.equal(classifyPaddleWebhookEvent('adjustment.created').routing, 'refund_adjustment');
	});

	it('re-exports reconciliation key from idempotency module', () => {
		const source = readSrc('services/billing/idempotency.js');
		assert.match(source, /buildSubscriptionReconcileIdempotencyKey/);
		assert.match(source, /reconciliation-idempotency-keys/);
	});
});
