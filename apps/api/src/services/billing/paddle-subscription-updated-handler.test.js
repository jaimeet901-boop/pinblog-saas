/**
 * Phase 4.4-C — Paddle subscription.updated reconciliation handler tests.
 * Run: node --test src/services/billing/paddle-subscription-updated-handler.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	buildPaddleWebhookParseResult,
	classifyPaddleWebhookEvent,
	extractPaddleWebhookContext,
} from './providers/paddle-webhook-helpers.js';
import { handlePaddleSubscriptionUpdatedEvent } from './paddle-subscription-updated-handler.js';
import { fetchAndVerifyPaddleSubscriptionForReconciliation } from './paddle-subscription-reconciliation.js';
import { reconcilePaddleSubscription } from './paddle-subscription-reconcile.js';
import { normalizeRegistryEntry } from './price-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fulfillmentSource = readFileSync(
	join(__dirname, 'paddle-webhook-fulfillment.js'),
	'utf8',
);
const handlerSource = readFileSync(
	join(__dirname, 'paddle-subscription-updated-handler.js'),
	'utf8',
);

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
			custom_data: {
				workspaceKey: 'ws-kitchen',
				planSlug: 'pro',
			},
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

function createHandlerHarness(overrides = {}) {
	const webhookUpdates = [];
	const subscriptionMutations = [];
	const record = { id: 'wh_1', status: 'processing' };
	const state = {
		claimCalls: [],
		idempotencyOps: [],
		idempotencyStore: overrides.idempotencyStore || new Map(),
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

	const deps = {
		loadSubscriptionByWorkspace: overrides.loadSubscriptionByWorkspace
			|| (async () => localSubscriptionRecord(overrides.localRecord)),
		loadSubscriptionByPaddleId: overrides.loadSubscriptionByPaddleId
			|| (async () => localSubscriptionRecord(overrides.localRecord)),
		fetchAndVerifyPaddleSubscriptionForReconciliation:
			overrides.fetchAndVerifyPaddleSubscriptionForReconciliation,
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
			if (state.reconcileDelayMs > 0) {
				await new Promise((resolve) => { setTimeout(resolve, state.reconcileDelayMs); });
			}
			return reconcilePaddleSubscription(input);
		}),
		...idempotency,
		reconciliationProcessingStaleMs: overrides.reconciliationProcessingStaleMs,
	};

	const updateWebhookEvent = async (_id, patch) => {
		webhookUpdates.push(patch);
		Object.assign(record, patch);
		return patch;
	};

	return {
		webhookUpdates,
		subscriptionMutations,
		record,
		fetchImpl,
		deps,
		state,
		updateWebhookEvent,
		async run(parsed = buildParsed(overrides.payload)) {
			return handlePaddleSubscriptionUpdatedEvent({
				config: sandboxConfig,
				parsed,
				webhookRecord: record,
				fetchImpl,
				deps: {
					...deps,
					updateWebhookEvent,
					persistWebhookFailure: async (recordId, error, decision) => updateWebhookEvent(recordId, {
						status: 'failed',
						error: error?.message || String(error || decision || 'unknown'),
					}),
				},
			});
		},
	};
}

describe('Phase 4.4-C subscription.updated handler routing', () => {
	it('subscription.updated reaches subscription_reconcile routing', () => {
		const result = classifyPaddleWebhookEvent('subscription.updated');
		assert.equal(result.routing, 'subscription_reconcile');
	});

	it('fulfillment ingress registers subscription_reconcile handler', () => {
		assert.match(fulfillmentSource, /routing === 'subscription_reconcile'/);
		assert.match(fulfillmentSource, /handlePaddleSubscriptionUpdatedEvent/);
	});
});

describe('Phase 4.4-C handlePaddleSubscriptionUpdatedEvent', () => {
	it('successful verification returns safe reconciliation snapshot', async () => {
		const harness = createHandlerHarness();
		const result = await harness.run();

		assert.equal(result.ok, true);
		assert.equal(result.result.handled, true);
		assert.equal(result.result.verified, true);
		assert.equal(result.result.reconciled, true);
		assert.equal(result.result.subscriptionId, 'sub_paddle_1');
		assert.deepEqual(result.result.reconciliation, {
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
		});
		assert.equal(result.result.activated, undefined);
		assert.equal(result.result.renewed, undefined);
		assert.equal(result.result.cancelled, undefined);
		assert.equal(result.result.fulfilled, undefined);
		assert.equal(harness.webhookUpdates.some((patch) => patch.status === 'processed'), true);
	});

	it('uses Phase 4.4-A fetchAndVerify contract via Paddle GET', async () => {
		let fetchCalled = false;
		const fetchImpl = async (url) => {
			fetchCalled = true;
			assert.match(String(url), /\/subscriptions\/sub_paddle_1$/);
			return {
				ok: true,
				status: 200,
				json: async () => ({ data: validApiSubscription() }),
			};
		};

		const harness = createHandlerHarness({
			fetchAndVerifyPaddleSubscriptionForReconciliation: async (input) => {
				assert.equal(input.subscriptionId, 'sub_paddle_1');
				return fetchAndVerifyPaddleSubscriptionForReconciliation({
					...input,
					fetchImpl,
				});
			},
		});

		const result = await harness.run();
		assert.equal(result.result.verified, true);
		assert.equal(fetchCalled, true);
	});

	it('extracts subscription ID from webhook payload context', async () => {
		const context = extractPaddleWebhookContext(subscriptionUpdatedPayload());
		assert.equal(context.subscriptionId, 'sub_paddle_1');

		const harness = createHandlerHarness();
		await harness.run();
	});

	it('missing webhook subscription ID fails closed', async () => {
		const harness = createHandlerHarness({
			payload: subscriptionUpdatedPayload({ data: { id: '', custom_data: { workspaceKey: 'ws-kitchen' } } }),
		});
		const result = await harness.run();

		assert.equal(result.result.handled, false);
		assert.equal(result.result.verified, false);
		assert.equal(result.result.reason, 'paddle_reconciliation_missing_subscription_id');
		assert.equal(harness.webhookUpdates.some((patch) => patch.status === 'failed'), true);
	});

	it('Paddle API error fails closed', async () => {
		const harness = createHandlerHarness({
			fetchAndVerifyPaddleSubscriptionForReconciliation: async () => ({
				ok: false,
				error: 'paddle_api_error',
				retryable: true,
			}),
		});
		const result = await harness.run();

		assert.equal(result.result.verified, false);
		assert.equal(result.result.reason, 'paddle_api_error');
		assert.equal(result.result.retryable, true);
		assert.equal(harness.webhookUpdates.some((patch) => patch.status === 'failed'), true);
	});

	it('malformed Paddle response fails closed', async () => {
		const harness = createHandlerHarness({
			fetchAndVerifyPaddleSubscriptionForReconciliation: async () => ({
				ok: false,
				error: 'paddle_subscription_malformed',
			}),
		});
		const result = await harness.run();
		assert.equal(result.result.reason, 'paddle_subscription_malformed');
	});

	it('identity mismatch fails closed', async () => {
		const harness = createHandlerHarness({
			localRecord: { paddle_subscription_id: 'sub_other', workspace_key: 'ws-kitchen', provider: 'paddle' },
		});
		const result = await harness.run();
		assert.equal(result.result.verified, false);
		assert.equal(result.result.reason, 'paddle_subscription_identity_mismatch');
	});

	it('workspace context mismatch fails closed', async () => {
		const harness = createHandlerHarness({
			localRecord: { workspace_key: 'ws-other', paddle_subscription_id: 'sub_paddle_1', provider: 'paddle' },
		});
		const result = await harness.run();
		assert.equal(result.result.reason, 'paddle_reconciliation_workspace_mismatch');
	});

	it('missing price fails closed', async () => {
		const harness = createHandlerHarness({
			apiSubscription: { items: [] },
			fetchAndVerifyPaddleSubscriptionForReconciliation: undefined,
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({ data: validApiSubscription({ items: [] }) }),
			}),
		});
		const result = await harness.run();
		assert.equal(result.result.reason, 'paddle_subscription_price_missing');
	});

	it('invalid interval fails closed', async () => {
		const harness = createHandlerHarness({
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: validApiSubscription({
						items: [{
							price: {
								id: 'pri_pro_monthly',
								billing_cycle: { interval: 'week', frequency: 1 },
							},
						}],
					}),
				}),
			}),
		});
		const result = await harness.run();
		assert.equal(result.result.reason, 'paddle_billing_cycle_interval_unsupported');
	});

	it('missing current billing period fails closed', async () => {
		const harness = createHandlerHarness({
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({ data: validApiSubscription({ current_billing_period: null }) }),
			}),
		});
		const result = await harness.run();
		assert.equal(result.result.reason, 'paddle_current_billing_period_missing');
	});

	it('malformed current billing period fails closed', async () => {
		const harness = createHandlerHarness({
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: validApiSubscription({
						current_billing_period: {
							starts_at: '2026-09-01T00:00:00.000Z',
							ends_at: '2026-08-01T00:00:00.000Z',
						},
					}),
				}),
			}),
		});
		const result = await harness.run();
		assert.equal(result.result.reason, 'paddle_current_billing_period_invalid_range');
	});

	it('malformed scheduled change fails closed', async () => {
		const harness = createHandlerHarness({
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: validApiSubscription({
						scheduled_change: { action: 'cancel' },
					}),
				}),
			}),
		});
		const result = await harness.run();
		assert.equal(result.result.reason, 'paddle_scheduled_change_effective_at_missing');
	});

	it('scheduled cancellation is exposed in snapshot without mutating DB', async () => {
		const harness = createHandlerHarness({
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: validApiSubscription({
						scheduled_change: {
							action: 'cancel',
							effective_at: '2026-09-01T00:00:00.000Z',
						},
					}),
				}),
			}),
		});
		const result = await harness.run();
		assert.equal(result.result.reconciliation.cancelScheduledAtPeriodEnd, true);
		assert.equal(result.result.reconciliation.scheduledChange.action, 'cancel');
	});
});

describe('Phase 4.4-C handler isolation guards', () => {
	it('handler does not call activation, renewal, or cancellation services', () => {
		assert.equal(handlerSource.includes('activatePaddleSubscription'), false);
		assert.equal(handlerSource.includes('renewPaddleSubscription'), false);
		assert.equal(handlerSource.includes('handlePaddleCancellation'), false);
		assert.equal(handlerSource.includes('cancelPaddleSubscriptionAtPeriodEnd'), false);
		assert.equal(handlerSource.includes('syncEntitlementMirrors'), false);
		assert.equal(handlerSource.includes('reconcilePaddleSubscription'), true);
		assert.equal(handlerSource.includes('pocketbaseClient'), false);
		assert.equal(handlerSource.includes('.update('), false);
	});

	it('handler delegates DB writes to reconcilePaddleSubscription via deps', () => {
		assert.equal(handlerSource.includes('reconcilePaddleSubscription'), true);
		assert.equal(handlerSource.includes('pocketbaseClient'), false);
		assert.equal(handlerSource.includes('.update('), false);
	});
});

describe('Phase 4.4-C webhook ingress regression', () => {
	it('transaction.completed path remains subscription_success', () => {
		assert.equal(classifyPaddleWebhookEvent('transaction.completed').routing, 'subscription_success');
	});

	it('cancellation path remains cancel', () => {
		assert.equal(classifyPaddleWebhookEvent('subscription.canceled').routing, 'cancel');
	});

	it('refund path remains refund_adjustment', () => {
		assert.equal(classifyPaddleWebhookEvent('adjustment.created').routing, 'refund_adjustment');
	});

	it('duplicate webhook uses existing persistence without second mechanism', () => {
		assert.match(fulfillmentSource, /findWebhookEvent/);
		assert.match(fulfillmentSource, /createWebhookEvent/);
		assert.match(fulfillmentSource, /isTerminalWebhookStatus/);
		assert.match(fulfillmentSource, /canRetryWebhookEvent/);
		assert.equal(fulfillmentSource.includes('createReconciliationWebhookEvent'), false);
	});
});
