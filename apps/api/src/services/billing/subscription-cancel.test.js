/**
 * Phase 4.3-A — cancelSubscription() fail-closed rewrite tests.
 * Run: node --test src/services/billing/subscription-cancel.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancelSubscription } from './subscription-cancel.js';
import { PaddleBillingProvider } from './providers/paddle.js';
import { PaddleApiError } from './providers/paddle-api-client.js';
import { PayPalBillingProvider } from './providers/paypal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(__dirname, '..', '..');

function createMockIdempotencyForHarness(state) {
	const store = state.idempotencyStore || new Map();
	state.idempotencyStore = store;
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
			}
			return record;
		},
		failIdempotency: async (recordId, errorMessage = '') => {
			const record = [...store.values()].find((entry) => entry.id === recordId);
			if (record) {
				record.status = 'failed';
				record.result = { error: errorMessage };
				record.processed_at = new Date().toISOString();
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
				record.updated = new Date().toISOString();
			}
			return record;
		},
	};
}

function readSrc(relativePath) {
	return readFileSync(join(apiSrc, relativePath), 'utf8');
}

function createHarness(overrides = {}) {
	const state = {
		subscription: {
			id: 'sub1',
			workspace_key: 'ws-kitchen',
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
		globalProviderCode: overrides.globalProviderCode ?? 'paypal',
		idempotencyStore: overrides.idempotencyStore || new Map(),
	};

	const client = {
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
	};

	const mockProvider = {
		code: overrides.mockProviderCode ?? state.subscription.provider,
		ready: overrides.providerReady ?? true,
		cancelSubscription: overrides.cancelSubscription || (async (input) => {
			state.providerCalls.push(input);
			return overrides.remoteResult ?? { cancelled: false, message: 'stub not confirmed' };
		}),
	};

	return {
		state,
		deps: {
			client,
			loadSubscription: async () => ({
				...state.subscription,
				expand: { plan: { slug: 'pro' } },
			}),
			loadPlan: async (slug) => (slug === 'free'
				? { id: 'plan_free', slug: 'free' }
				: { id: 'plan_pro', slug: 'pro' }),
			syncEntitlementMirrors: async (payload) => { state.syncCalls.push(payload); },
			logBillingAction: async (payload) => { state.auditCalls.push(payload); },
			getBillingProvider: async (code) => {
				state.resolvedProviderCode = code;
				if (code === state.globalProviderCode && overrides.forceGlobalMismatch) {
					return { ...mockProvider, code: state.globalProviderCode };
				}
				return { ...mockProvider, code: code || mockProvider.code };
			},
			...createMockIdempotencyForHarness(state),
		},
		mockProvider,
	};
}

describe('Phase 4.3-A cancelSubscription', () => {
	it('Paddle remote success → local period-end scheduling', async () => {
		const { state, deps } = createHarness({
			remoteResult: { cancelled: true },
		});
		const result = await cancelSubscription('ws-kitchen', { deps, atPeriodEnd: true });
		assert.equal(result.cancelled, true);
		assert.equal(result.remoteConfirmed, true);
		assert.equal(state.subscription.cancel_at_period_end, true);
		assert.equal(state.subscription.billing_status, 'cancel_scheduled');
		assert.equal(state.subscription.plan, 'plan_pro');
		assert.equal(state.subscription.status, 'active');
		assert.equal(state.providerCalls.length, 1);
	});

	it('Paddle remote failure → zero local mutation', async () => {
		const { state, deps } = createHarness({
			remoteResult: { cancelled: false, message: 'paddle stub' },
		});
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.errorCode === 'PROVIDER_CANCEL_FAILED',
		);
		assert.equal(state.updates.length, 0);
		assert.equal(state.subscription.billing_status, 'active');
	});

	it('Paddle remote throw → zero local mutation', async () => {
		const { state, deps } = createHarness({
			cancelSubscription: async () => {
				const error = new Error('timeout');
				error.status = 504;
				error.errorCode = 'PROVIDER_CANCEL_FAILED';
				throw error;
			},
		});
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.errorCode === 'PROVIDER_CANCEL_FAILED',
		);
		assert.equal(state.updates.length, 0);
	});

	it('PayPal remote success → local scheduling', async () => {
		const { state, deps } = createHarness({
			provider: 'paypal',
			provider_subscription_id: 'I-PAYPAL-1',
			paddle_subscription_id: '',
			remoteResult: { cancelled: true },
		});
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.cancelled, true);
		assert.equal(state.resolvedProviderCode, 'paypal');
		assert.equal(state.subscription.billing_status, 'cancel_scheduled');
		assert.equal(state.providerCalls[0].providerSubscriptionId, 'I-PAYPAL-1');
	});

	it('PayPal remote failure → zero local mutation', async () => {
		const { state, deps } = createHarness({
			provider: 'paypal',
			provider_subscription_id: 'I-PAYPAL-1',
			paddle_subscription_id: '',
			remoteResult: { cancelled: false, message: 'PayPal rejected' },
		});
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.errorCode === 'PROVIDER_CANCEL_FAILED',
		);
		assert.equal(state.updates.length, 0);
	});

	it('provider selected from subscription.provider not global config', async () => {
		const { state, deps } = createHarness({
			provider: 'paddle',
			globalProviderCode: 'paypal',
			remoteResult: { cancelled: true },
		});
		await cancelSubscription('ws-kitchen', { deps });
		assert.equal(state.resolvedProviderCode, 'paddle');
	});

	it('missing/unsupported provider → fail closed', async () => {
		const { state, deps } = createHarness({
			subscription: { provider: 'unknown_vendor' },
		});
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.errorCode === 'UNSUPPORTED_PROVIDER',
		);
		assert.equal(state.updates.length, 0);
	});

	it('missing provider subscription ID → fail closed', async () => {
		const { state, deps } = createHarness({
			provider: 'paddle',
			provider_subscription_id: '',
			paddle_subscription_id: '',
		});
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.errorCode === 'PROVIDER_SUBSCRIPTION_ID_MISSING',
		);
		assert.equal(state.updates.length, 0);
		assert.equal(state.providerCalls.length, 0);
	});

	it('atPeriodEnd=true preserves plan and status on remote success', async () => {
		const periodEnd = new Date(Date.now() + 10 * 86400000).toISOString();
		const { state, deps } = createHarness({
			current_period_end: periodEnd,
			remoteResult: { cancelled: true },
		});
		await cancelSubscription('ws-kitchen', { deps, atPeriodEnd: true });
		assert.equal(state.subscription.plan, 'plan_pro');
		assert.equal(state.subscription.status, 'active');
		assert.equal(state.subscription.current_period_end, periodEnd);
	});

	it('atPeriodEnd=false only downgrades after remote success', async () => {
		const { state, deps } = createHarness({
			remoteResult: { cancelled: false },
		});
		await assert.rejects(() => cancelSubscription('ws-kitchen', { deps, atPeriodEnd: false }));
		assert.equal(state.updates.length, 0);
		assert.equal(state.syncCalls.length, 0);
	});

	it('immediate downgrade syncs entitlement mirrors after remote success', async () => {
		const { state, deps } = createHarness({
			remoteResult: { cancelled: true },
		});
		await cancelSubscription('ws-kitchen', { deps, atPeriodEnd: false });
		assert.equal(state.subscription.plan, 'plan_free');
		assert.equal(state.subscription.status, 'canceled');
		assert.equal(state.syncCalls.length, 1);
		assert.equal(state.syncCalls[0].plan.slug, 'free');
	});

	it('already cancel_scheduled → no second provider call', async () => {
		const { state, deps } = createHarness({
			subscription: {
				billing_status: 'cancel_scheduled',
				cancel_at_period_end: true,
			},
		});
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.alreadyScheduled, true);
		assert.equal(state.providerCalls.length, 0);
		assert.equal(state.updates.length, 0);
	});

	it('refund_pending is preserved — no provider call or billing_status overwrite', async () => {
		const { state, deps } = createHarness({
			subscription: {
				billing_status: 'refund_pending',
				cancel_at_period_end: true,
			},
			remoteResult: { cancelled: true },
		});
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.refundPending, true);
		assert.equal(result.preserved, true);
		assert.equal(state.providerCalls.length, 0);
		assert.equal(state.updates.length, 0);
		assert.equal(state.subscription.billing_status, 'refund_pending');
	});

	it('free/none path remains safe (local schedule)', async () => {
		const { state, deps } = createHarness({
			provider: 'none',
			provider_subscription_id: '',
			paddle_subscription_id: '',
		});
		const result = await cancelSubscription('ws-kitchen', { deps, atPeriodEnd: true });
		assert.equal(result.localOnly, true);
		assert.equal(state.providerCalls.length, 0);
		assert.equal(state.subscription.billing_status, 'cancel_scheduled');
	});

	it('provider not ready → fail closed', async () => {
		const { state, deps } = createHarness({
			providerReady: false,
		});
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.errorCode === 'PROVIDER_NOT_READY',
		);
		assert.equal(state.updates.length, 0);
	});

	it('failed remote attempt is audit logged', async () => {
		const { state, deps } = createHarness({
			remoteResult: { cancelled: false, message: 'denied' },
		});
		await assert.rejects(() => cancelSubscription('ws-kitchen', { deps }));
		assert.ok(state.auditCalls.some((entry) => entry.action.includes('Cancellation failed')));
	});

	it('successful remote cancellation is audit logged', async () => {
		const { state, deps } = createHarness({
			remoteResult: { cancelled: true },
		});
		await cancelSubscription('ws-kitchen', { deps });
		assert.ok(state.auditCalls.some((entry) => entry.action === 'Cancellation scheduled'));
	});
});

function paddleCancelFetchImpl(status = 200, subscriptionId = 'sub_paddle_1') {
	return async (url, options = {}) => ({
		ok: status >= 200 && status < 300,
		status,
		json: async () => ({
			data: {
				id: subscriptionId,
				status: 'active',
				scheduled_change: {
					action: 'cancel',
					effective_at: '2026-09-08T10:00:00.000Z',
				},
			},
		}),
	});
}

function createPaddleProviderHarness(fetchImpl) {
	const { state, deps } = createHarness({ provider: 'paddle' });
	const paddle = new PaddleBillingProvider({ apiKey: 'test_key', sandbox: true });
	deps.getBillingProvider = async (code) => {
		state.resolvedProviderCode = code;
		return {
			code: 'paddle',
			ready: true,
			cancelSubscription: (input) => paddle.cancelSubscription({ ...input, fetchImpl }),
		};
	};
	return { state, deps };
}

function createPayPalCancelFetchImpl({
	subscriptionId = 'I-PAYPAL-1',
	initialStatus = 'ACTIVE',
	afterActionStatus = 'SUSPENDED',
	actionStatus = 204,
} = {}) {
	let getCount = 0;
	return async (url, options = {}) => {
		const u = String(url);
		if (u.endsWith('/v1/oauth2/token')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ access_token: 'token_abc' }),
			};
		}
		const subPath = `/v1/billing/subscriptions/${subscriptionId}`;
		if (u.includes(subPath)) {
			if (u.endsWith('/suspend') || u.endsWith('/cancel')) {
				return {
					ok: actionStatus >= 200 && actionStatus < 300,
					status: actionStatus,
					json: async () => ({}),
				};
			}
			getCount += 1;
			const status = getCount === 1 ? initialStatus : afterActionStatus;
			return {
				ok: true,
				status: 200,
				json: async () => ({ id: subscriptionId, status }),
			};
		}
		throw new Error(`Unexpected fetch: ${url}`);
	};
}

function createPayPalProviderHarness(fetchImpl) {
	const { state, deps } = createHarness({
		provider: 'paypal',
		provider_subscription_id: 'I-PAYPAL-1',
		paddle_subscription_id: '',
	});
	const paypal = new PayPalBillingProvider({
		clientId: 'client_test',
		clientSecret: 'secret_test',
		mode: 'sandbox',
	});
	deps.getBillingProvider = async (code) => {
		state.resolvedProviderCode = code;
		return {
			code: 'paypal',
			ready: true,
			cancelSubscription: (input) => paypal.cancelSubscription({ ...input, fetchImpl }),
		};
	};
	return { state, deps };
}

describe('Phase 4.3-B Paddle cancel integration (subscription-cancel.js frozen)', () => {
	it('Paddle success returns cancelled:true and schedules locally', async () => {
		const periodEnd = new Date(Date.now() + 10 * 86400000).toISOString();
		const { state, deps } = createPaddleProviderHarness(paddleCancelFetchImpl());
		state.subscription.current_period_end = periodEnd;
		const result = await cancelSubscription('ws-kitchen', { deps, atPeriodEnd: true });
		assert.equal(result.cancelled, true);
		assert.equal(result.remoteConfirmed, true);
		assert.equal(state.subscription.billing_status, 'cancel_scheduled');
		assert.equal(state.subscription.plan, 'plan_pro');
		assert.equal(state.subscription.status, 'active');
		assert.equal(state.subscription.current_period_end, periodEnd);
	});

	it('Paddle API failure → zero local mutation', async () => {
		const { state, deps } = createPaddleProviderHarness(
			async () => ({
				ok: false,
				status: 400,
				json: async () => ({ error: { detail: 'bad request' } }),
			}),
		);
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.status === 400 || err.errorCode === 'PROVIDER_CANCEL_FAILED',
		);
		assert.equal(state.updates.length, 0);
	});

	it('Paddle timeout → zero local mutation', async () => {
		const abortError = new Error('aborted');
		abortError.name = 'AbortError';
		const { state, deps } = createPaddleProviderHarness(async () => {
			throw abortError;
		});
		await assert.rejects(() => cancelSubscription('ws-kitchen', { deps }));
		assert.equal(state.updates.length, 0);
	});

	it('refund_pending remains untouched with real Paddle provider wrapper', async () => {
		const { state, deps } = createPaddleProviderHarness(paddleCancelFetchImpl());
		state.subscription.billing_status = 'refund_pending';
		state.subscription.cancel_at_period_end = true;
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.refundPending, true);
		assert.equal(state.updates.length, 0);
	});
});

describe('Phase 4.3-C PayPal cancel integration (subscription-cancel.js frozen)', () => {
	it('PayPal success returns cancelled:true and schedules locally', async () => {
		const periodEnd = new Date(Date.now() + 10 * 86400000).toISOString();
		const { state, deps } = createPayPalProviderHarness(createPayPalCancelFetchImpl());
		state.subscription.current_period_end = periodEnd;
		const result = await cancelSubscription('ws-kitchen', { deps, atPeriodEnd: true });
		assert.equal(result.cancelled, true);
		assert.equal(result.remoteConfirmed, true);
		assert.equal(state.resolvedProviderCode, 'paypal');
		assert.equal(state.subscription.billing_status, 'cancel_scheduled');
		assert.equal(state.subscription.plan, 'plan_pro');
		assert.equal(state.subscription.status, 'active');
		assert.equal(state.subscription.current_period_end, periodEnd);
	});

	it('PayPal API failure → zero local mutation', async () => {
		const { state, deps } = createPayPalProviderHarness(
			createPayPalCancelFetchImpl({ actionStatus: 400 }),
		);
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.status === 400 || err.errorCode === 'PROVIDER_CANCEL_FAILED',
		);
		assert.equal(state.updates.length, 0);
	});

	it('PayPal timeout → zero local mutation', async () => {
		const abortError = new Error('aborted');
		abortError.name = 'AbortError';
		const { state, deps } = createPayPalProviderHarness(async () => {
			throw abortError;
		});
		await assert.rejects(() => cancelSubscription('ws-kitchen', { deps }));
		assert.equal(state.updates.length, 0);
	});

	it('PayPal cancelled:false path → zero local mutation', async () => {
		const { state, deps } = createHarness({
			provider: 'paypal',
			provider_subscription_id: 'I-PAYPAL-1',
			paddle_subscription_id: '',
			remoteResult: { cancelled: false, message: 'PayPal rejected' },
		});
		await assert.rejects(
			() => cancelSubscription('ws-kitchen', { deps }),
			(err) => err.errorCode === 'PROVIDER_CANCEL_FAILED',
		);
		assert.equal(state.updates.length, 0);
	});

	it('provider selection from subscription.provider (PayPal not global)', async () => {
		const { state, deps } = createPayPalProviderHarness(createPayPalCancelFetchImpl());
		await cancelSubscription('ws-kitchen', { deps });
		assert.equal(state.resolvedProviderCode, 'paypal');
	});

	it('refund_pending remains untouched with real PayPal provider wrapper', async () => {
		const { state, deps } = createPayPalProviderHarness(createPayPalCancelFetchImpl());
		state.subscription.billing_status = 'refund_pending';
		state.subscription.cancel_at_period_end = true;
		const result = await cancelSubscription('ws-kitchen', { deps });
		assert.equal(result.refundPending, true);
		assert.equal(state.updates.length, 0);
	});

	it('immediate PayPal cancellation syncs entitlement mirrors after remote success', async () => {
		const { state, deps } = createPayPalProviderHarness(createPayPalCancelFetchImpl({
			afterActionStatus: 'CANCELLED',
		}));
		await cancelSubscription('ws-kitchen', { deps, atPeriodEnd: false });
		assert.equal(state.subscription.plan, 'plan_free');
		assert.equal(state.subscription.status, 'canceled');
		assert.equal(state.syncCalls.length, 1);
		assert.equal(state.syncCalls[0].plan.slug, 'free');
	});
});

describe('Phase 4.3-A regression guards (static)', () => {
	it('upgradeSubscription HTTP gate remains blocked', () => {
		const routes = readSrc('routes/workspace/index.js');
		assert.doesNotMatch(routes, /subscription\/upgrade/);
	});

	it('cancelSubscription does not swallow provider.cancelSubscription errors', () => {
		const source = readSrc('services/billing/subscription-cancel.js');
		assert.doesNotMatch(source, /await provider\.cancelSubscription\([^)]*\)\s*\.catch/);
		assert.match(source, /PROVIDER_CANCEL_FAILED/);
		assert.match(source, /resolveSubscriptionProviderCode/);
		assert.match(source, /resolveProvider\(providerCode\)/);
	});

	it('Paddle cancellation webhook handler unchanged entrypoint', () => {
		const source = readSrc('services/billing/paddle-webhook-fulfillment.js');
		assert.match(source, /handlePaddleCancelEvent/);
		assert.match(source, /handlePaddleCancellation/);
	});

	it('PayPal cancellation webhook handler unchanged entrypoint', () => {
		const source = readSrc('services/billing/paypal-webhook-fulfillment.js');
		assert.match(source, /handlePayPalCancelEvent/);
		assert.match(source, /handlePayPalCancellation/);
	});

	it('Phase 4.3-D uses subscription_cancel idempotency scope', () => {
		const source = readSrc('services/billing/subscription-cancel.js');
		assert.match(source, /scope: 'subscription_cancel'/);
		assert.match(source, /buildSubscriptionCancelIdempotencyKey/);
		assert.match(source, /CANCELLATION_IN_PROGRESS/);
	});
});
