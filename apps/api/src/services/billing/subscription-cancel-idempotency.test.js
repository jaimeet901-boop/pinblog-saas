/**
 * Phase 4.3-D — Cancellation idempotency layer tests.
 * Run: node --test src/services/billing/subscription-cancel-idempotency.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	cancelSubscription,
	buildSubscriptionCancelIdempotencyKey,
} from './subscription-cancel.js';
import {
	buildSubscriptionCancelIdempotencyKey as buildKeyFromModule,
	CANCELLATION_IDEMPOTENCY_STALE_MS,
} from './cancellation-idempotency-keys.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(__dirname, '..', '..');

function readSrc(relativePath) {
	return readFileSync(join(apiSrc, relativePath), 'utf8');
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
	const state = {
		subscription: {
			id: 'sub1',
			workspace_key: overrides.workspaceKey ?? 'ws-kitchen',
			workspace_name: 'Kitchen',
			plan: 'plan_pro',
			status: 'active',
			billing_status: 'active',
			provider: overrides.provider ?? 'paddle',
			provider_subscription_id: overrides.provider_subscription_id ?? 'sub_paddle_1',
			paddle_subscription_id: overrides.paddle_subscription_id ?? 'sub_paddle_1',
			current_period_end: overrides.current_period_end
				|| new Date(Date.now() + 7 * 86400000).toISOString(),
			cancel_at_period_end: overrides.cancel_at_period_end ?? false,
			...overrides.subscription,
		},
		updates: [],
		syncCalls: [],
		auditCalls: [],
		providerCalls: [],
		claimCalls: [],
		idempotencyOps: [],
		idempotencyStore: overrides.idempotencyStore || new Map(),
		providerDelayMs: overrides.providerDelayMs ?? 0,
	};

	const idempotency = createMockIdempotency(state);

	const mockProvider = {
		code: state.subscription.provider,
		ready: overrides.providerReady ?? true,
		cancelSubscription: overrides.cancelSubscription || (async (input) => {
			state.providerCalls.push(input);
			if (state.providerDelayMs > 0) {
				await new Promise((resolve) => { setTimeout(resolve, state.providerDelayMs); });
			}
			return overrides.remoteResult ?? { cancelled: true };
		}),
	};

	return {
		state,
		deps: {
			client: {
				filter: (template) => template,
				collection(name) {
					if (name === 'workspace_subscriptions') {
						return {
							getFirstListItem: async () => ({
								...state.subscription,
								expand: { plan: { slug: 'pro' } },
							}),
							update: async (id, body) => {
								state.updates.push({ id, body });
								state.subscription = { ...state.subscription, ...body };
								return state.subscription;
							},
						};
					}
					throw new Error(`unexpected collection ${name}`);
				},
			},
			loadSubscription: async () => ({
				...state.subscription,
				expand: { plan: { slug: 'pro' } },
			}),
			loadPlan: async (slug) => (slug === 'free'
				? { id: 'plan_free', slug: 'free' }
				: { id: 'plan_pro', slug: 'pro' }),
			syncEntitlementMirrors: async (payload) => { state.syncCalls.push(payload); },
			logBillingAction: async (payload) => { state.auditCalls.push(payload); },
			getBillingProvider: async (code) => ({
				...mockProvider,
				code: code || mockProvider.code,
			}),
			...idempotency,
			cancellationProcessingStaleMs: overrides.cancellationProcessingStaleMs,
		},
	};
}

describe('buildSubscriptionCancelIdempotencyKey', () => {
	it('uses deterministic subscription_cancel prefix', () => {
		const key = buildSubscriptionCancelIdempotencyKey('ws-a', 'paddle', 'sub_1');
		assert.equal(key, 'subscription_cancel:ws-a:paddle:sub_1');
		assert.equal(key, buildKeyFromModule('ws-a', 'paddle', 'sub_1'));
	});

	it('different workspace produces different key', () => {
		const a = buildSubscriptionCancelIdempotencyKey('ws-a', 'paddle', 'sub_1');
		const b = buildSubscriptionCancelIdempotencyKey('ws-b', 'paddle', 'sub_1');
		assert.notEqual(a, b);
	});

	it('different provider produces different key', () => {
		const a = buildSubscriptionCancelIdempotencyKey('ws-a', 'paddle', 'sub_1');
		const b = buildSubscriptionCancelIdempotencyKey('ws-a', 'paypal', 'sub_1');
		assert.notEqual(a, b);
	});

	it('different provider subscription ID produces different key', () => {
		const a = buildSubscriptionCancelIdempotencyKey('ws-a', 'paddle', 'sub_1');
		const b = buildSubscriptionCancelIdempotencyKey('ws-a', 'paddle', 'sub_2');
		assert.notEqual(a, b);
	});
});

describe('Phase 4.3-D cancellation idempotency', () => {
	it('first cancellation claims successfully and completes', async () => {
		const { state, deps } = createHarness();
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.cancelled, true);
		assert.equal(state.claimCalls.length, 1);
		assert.equal(state.claimCalls[0].scope, 'subscription_cancel');
		assert.ok(state.idempotencyOps.some((op) => op.op === 'complete'));
		assert.equal(state.providerCalls.length, 1);
	});

	it('second identical request does not call provider', async () => {
		const store = new Map();
		const { state, deps } = createHarness({ idempotencyStore: store });
		await cancelSubscription('ws-kitchen', { deps });
		const firstProviderCalls = state.providerCalls.length;
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.alreadyScheduled, true);
		assert.equal(state.providerCalls.length, firstProviderCalls);
		assert.equal(state.updates.length, 1);
	});

	it('completed idempotency record returns stored result without provider call', async () => {
		const store = new Map();
		const key = buildSubscriptionCancelIdempotencyKey('ws-kitchen', 'paddle', 'sub_paddle_1');
		store.set(key, {
			id: 'idem_done',
			idempotency_key: key,
			scope: 'subscription_cancel',
			status: 'completed',
			result: { cancelled: true, atPeriodEnd: true, remoteConfirmed: true },
			updated: new Date().toISOString(),
			created: new Date().toISOString(),
		});
		const { state, deps } = createHarness({ idempotencyStore: store });
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.duplicate, true);
		assert.equal(result.idempotent, true);
		assert.equal(result.cancelled, true);
		assert.equal(state.providerCalls.length, 0);
		assert.equal(state.updates.length, 0);
	});

	it('already cancel_scheduled does not claim or call provider', async () => {
		const { state, deps } = createHarness({
			subscription: {
				billing_status: 'cancel_scheduled',
				cancel_at_period_end: true,
			},
		});
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.alreadyScheduled, true);
		assert.equal(state.claimCalls.length, 0);
		assert.equal(state.providerCalls.length, 0);
	});

	it('already canceled does not claim or call provider', async () => {
		const { state, deps } = createHarness({
			subscription: {
				status: 'canceled',
				billing_status: 'canceled',
				cancel_at_period_end: false,
			},
		});
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.alreadyCanceled, true);
		assert.equal(state.claimCalls.length, 0);
		assert.equal(state.providerCalls.length, 0);
	});

	it('refund_pending does not claim or call provider', async () => {
		const { state, deps } = createHarness({
			subscription: { billing_status: 'refund_pending' },
		});
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.refundPending, true);
		assert.equal(state.claimCalls.length, 0);
		assert.equal(state.providerCalls.length, 0);
	});

	it('provider failure leaves operation retryable', async () => {
		const { state, deps } = createHarness({
			remoteResult: { cancelled: false, message: 'denied' },
		});
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.errorCode === 'PROVIDER_CANCEL_FAILED',
		);
		const key = buildSubscriptionCancelIdempotencyKey('ws-kitchen', 'paddle', 'sub_paddle_1');
		const record = state.idempotencyStore.get(key);
		assert.equal(record.status, 'failed');
		assert.equal(state.updates.length, 0);
	});

	it('provider timeout leaves operation retryable', async () => {
		const { state, deps } = createHarness({
			cancelSubscription: async () => {
				const error = new Error('timeout');
				error.status = 504;
				error.errorCode = 'PROVIDER_CANCEL_FAILED';
				throw error;
			},
		});
		await assert.rejects(() => cancelSubscription('ws-kitchen', { deps }));
		const key = buildSubscriptionCancelIdempotencyKey('ws-kitchen', 'paddle', 'sub_paddle_1');
		assert.equal(state.idempotencyStore.get(key).status, 'failed');
	});

	it('retry after failure reclaims and succeeds', async () => {
		const { state, deps } = createHarness({
			remoteResult: { cancelled: false, message: 'denied' },
		});
		await assert.rejects(() => cancelSubscription('ws-kitchen', { deps }));
		deps.getBillingProvider = async (code) => ({
			code,
			ready: true,
			cancelSubscription: async (input) => {
				state.providerCalls.push(input);
				return { cancelled: true };
			},
		});
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.cancelled, true);
		assert.equal(state.providerCalls.length, 2);
		assert.ok(state.idempotencyOps.some((op) => op.op === 'reset'));
	});

	it('successful cancellation marks operation completed', async () => {
		const { state, deps } = createHarness();
		await cancelSubscription('ws-kitchen', { deps });
		const key = buildSubscriptionCancelIdempotencyKey('ws-kitchen', 'paddle', 'sub_paddle_1');
		const record = state.idempotencyStore.get(key);
		assert.equal(record.status, 'completed');
		assert.equal(record.result.cancelled, true);
	});

	it('two simultaneous attempts → only one provider call', async () => {
		const { state, deps } = createHarness({ providerDelayMs: 80 });
		const first = cancelSubscription('ws-kitchen', { deps });
		await new Promise((resolve) => { setTimeout(resolve, 5); });
		const second = cancelSubscription('ws-kitchen', { deps });
		const results = await Promise.allSettled([first, second]);
		const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
		const rejected = results.filter((entry) => entry.status === 'rejected');
		assert.equal(fulfilled.length + rejected.length, 2);
		assert.equal(state.providerCalls.length, 1);
		assert.equal(state.updates.length, 1);
		assert.ok(
			rejected.some((entry) => entry.reason?.errorCode === 'CANCELLATION_IN_PROGRESS')
			|| fulfilled.some((entry) => entry.value?.duplicate === true),
		);
	});

	it('abandoned processing claim can be recovered after stale threshold', async () => {
		const store = new Map();
		const key = buildSubscriptionCancelIdempotencyKey('ws-kitchen', 'paddle', 'sub_paddle_1');
		const staleUpdated = new Date(Date.now() - CANCELLATION_IDEMPOTENCY_STALE_MS - 1000).toISOString();
		store.set(key, {
			id: 'idem_stale',
			idempotency_key: key,
			scope: 'subscription_cancel',
			status: 'processing',
			result: {},
			updated: staleUpdated,
			created: staleUpdated,
		});
		const { state, deps } = createHarness({ idempotencyStore: store });
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.cancelled, true);
		assert.ok(state.idempotencyOps.some((op) => op.op === 'reset'));
		assert.equal(state.providerCalls.length, 1);
	});

	it('recovery does not permanently block cancellation', async () => {
		const store = new Map();
		const key = buildSubscriptionCancelIdempotencyKey('ws-kitchen', 'paddle', 'sub_paddle_1');
		store.set(key, {
			id: 'idem_failed',
			idempotency_key: key,
			scope: 'subscription_cancel',
			status: 'failed',
			result: { error: 'previous failure' },
			updated: new Date().toISOString(),
			created: new Date().toISOString(),
		});
		const { state, deps } = createHarness({ idempotencyStore: store });
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.cancelled, true);
		assert.equal(state.idempotencyStore.get(key).status, 'completed');
	});
});

describe('Phase 4.3-D regression guards (static)', () => {
	it('uses deterministic subscription_cancel idempotency key', () => {
		const source = readSrc('services/billing/subscription-cancel.js');
		assert.match(source, /buildSubscriptionCancelIdempotencyKey/);
		assert.match(source, /scope: 'subscription_cancel'/);
		assert.doesNotMatch(source, /randomUUID|crypto\.random|Date\.now\(\).*idempotency/i);
	});

	it('does not swallow provider.cancelSubscription errors', () => {
		const source = readSrc('services/billing/subscription-cancel.js');
		assert.doesNotMatch(source, /await provider\.cancelSubscription\([^)]*\)\s*\.catch/);
	});

	it('HTTP cancellation route delegates to service without duplicate idempotency (Phase 4.3-F)', () => {
		const routes = readSrc('routes/workspace/index.js');
		assert.match(routes, /subscription\/cancel/);
		assert.match(routes, /cancelWorkspaceSubscription/);
		assert.doesNotMatch(routes, /claimIdempotencyKey/);
	});

	it('does not use global getBillingProvider without provider code', () => {
		const source = readSrc('services/billing/subscription-cancel.js');
		assert.match(source, /resolveProvider\(providerCode\)/);
		assert.doesNotMatch(source, /getBillingProvider\(\s*\)/);
	});
});
