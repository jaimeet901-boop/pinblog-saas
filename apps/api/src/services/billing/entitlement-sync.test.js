/**
 * Phase 3.1 — Entitlement sync engine tests.
 * Run: node --test src/services/billing/entitlement-sync.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	ACTIVATION_SOURCES,
	BILLING_SOURCES,
	validateActivationSource,
	validateBillingSource,
} from './billing-model.js';
import {
	syncEntitlementMirrors,
	resolveAuthoritativePlanSlug,
	computeNextEntitlementSyncVersion,
	normalizeSyncSource,
} from './entitlement-sync.js';

const mockState = {
	workspaces: new Map(),
	users: new Map(),
	subscriptions: new Map(),
	updates: [],
};

function resetMockState() {
	mockState.workspaces.clear();
	mockState.users.clear();
	mockState.subscriptions.clear();
	mockState.updates = [];
}

function recordUpdate(storeKey, id, body) {
	mockState.updates.push({ collection: storeKey, id, body, at: mockState.updates.length + 1 });
	const store = mockState[storeKey];
	let existingKey = id;
	for (const [key, row] of store.entries()) {
		if (row.id === id) {
			existingKey = key;
			break;
		}
	}
	const existing = store.get(existingKey) || { id };
	const next = { ...existing, ...body };
	store.set(existingKey, next);
	return next;
}

function createMockClient() {
	return {
		filter: (template) => template,
		collection(name) {
			return {
				async getFirstListItem(_filter, _opts) {
					if (name === 'workspaces') {
						for (const row of mockState.workspaces.values()) {
							return { ...row };
						}
						throw new Error('workspace_not_found');
					}
					if (name === 'workspace_subscriptions') {
						for (const row of mockState.subscriptions.values()) {
							return { ...row };
						}
						throw new Error('subscription_not_found');
					}
					throw new Error(`unexpected collection ${name}`);
				},
				async getOne(id) {
					const row = mockState.subscriptions.get(id);
					if (!row) throw new Error('subscription_not_found');
					return { ...row };
				},
				async update(id, body) {
					if (name === 'workspaces') return recordUpdate('workspaces', id, body);
					if (name === 'users') return recordUpdate('users', id, body);
					if (name === 'workspace_subscriptions') return recordUpdate('subscriptions', id, body);
					throw new Error(`unexpected collection ${name}`);
				},
			};
		},
	};
}

describe('entitlement sync pure helpers', () => {
	it('resolveAuthoritativePlanSlug reads slug from plan record', () => {
		assert.equal(resolveAuthoritativePlanSlug({ slug: 'Pro' }), 'pro');
		assert.equal(resolveAuthoritativePlanSlug({ planSlug: 'starter' }), 'starter');
		assert.equal(resolveAuthoritativePlanSlug({}), '');
	});

	it('computeNextEntitlementSyncVersion is monotonic and never moves backwards', () => {
		assert.equal(computeNextEntitlementSyncVersion(0), 1);
		assert.equal(computeNextEntitlementSyncVersion(5), 6);
		assert.equal(computeNextEntitlementSyncVersion(undefined), 1);
		assert.equal(computeNextEntitlementSyncVersion('3'), 4);
		assert.equal(computeNextEntitlementSyncVersion(-2), 1);
	});

	it('normalizeSyncSource accepts Phase 1 activation and billing enums', () => {
		for (const value of ACTIVATION_SOURCES) {
			const result = normalizeSyncSource(value);
			assert.equal(result.ok, true);
			assert.equal(result.value, value);
			assert.equal(validateActivationSource(value).ok, true);
		}
		for (const value of BILLING_SOURCES) {
			const result = normalizeSyncSource(value);
			assert.equal(result.ok, true);
			assert.equal(result.value, value);
			assert.equal(validateBillingSource(value).ok, true);
		}
	});

	it('normalizeSyncSource rejects unknown source values', () => {
		const result = normalizeSyncSource('stripe_checkout');
		assert.equal(result.ok, false);
		assert.equal(result.value, 'stripe_checkout');
	});
});

describe('syncEntitlementMirrors', () => {
	let client;

	beforeEach(() => {
		resetMockState();
		client = createMockClient();
		mockState.workspaces.set('workspace-1', {
			id: 'workspace-1',
			workspace_key: 'demo',
			plan_slug: 'free',
			owner: 'user-1',
		});
		mockState.users.set('user-1', {
			id: 'user-1',
			plan: 'free',
		});
		mockState.subscriptions.set('sub-1', {
			id: 'sub-1',
			workspace_key: 'demo',
			entitlement_sync_version: 2,
		});
	});

	afterEach(() => {
		resetMockState();
	});

	it('updates workspace mirror with authoritative plan slug', async () => {
		const result = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			source: 'paddle_webhook',
			client,
		});

		assert.equal(result.synced, true);
		assert.equal(result.planSlug, 'pro');
		assert.equal(mockState.workspaces.get('workspace-1').plan_slug, 'pro');
	});

	it('updates owner user mirror with authoritative plan slug', async () => {
		await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			source: 'paddle_webhook',
			client,
		});

		assert.equal(mockState.users.get('user-1').plan, 'pro');
	});

	it('increments entitlement_sync_version and sets last_entitlement_sync_at', async () => {
		const result = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			source: 'paddle_webhook',
			client,
		});

		assert.equal(result.entitlementSyncVersion, 3);
		assert.ok(result.lastEntitlementSyncAt);
		const subscription = mockState.subscriptions.get('sub-1');
		assert.equal(subscription.entitlement_sync_version, 3);
		assert.ok(subscription.last_entitlement_sync_at);
	});

	it('never moves entitlement_sync_version backwards across repeated syncs', async () => {
		await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			client,
		});
		const second = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			client,
		});
		const third = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'business' },
			subscriptionId: 'sub-1',
			client,
		});

		assert.equal(second.entitlementSyncVersion, 4);
		assert.equal(third.entitlementSyncVersion, 5);
		assert.ok(third.entitlementSyncVersion > second.entitlementSyncVersion);
	});

	it('repeated sync is idempotent for mirrors and does not create extra records', async () => {
		const first = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			client,
		});
		const updateCountAfterFirst = mockState.updates.length;

		const second = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			client,
		});

		assert.equal(first.synced, true);
		assert.equal(second.synced, true);
		assert.equal(second.workspaceMirrorUpdated, false);
		assert.equal(mockState.workspaces.get('workspace-1').plan_slug, 'pro');
		assert.equal(mockState.users.get('user-1').plan, 'pro');
		assert.ok(second.entitlementSyncVersion > first.entitlementSyncVersion);
		assert.ok(mockState.updates.length > updateCountAfterFirst);
		assert.equal(mockState.subscriptions.size, 1);
		assert.equal(mockState.workspaces.size, 1);
		assert.equal(mockState.users.size, 1);
	});

	it('handles missing workspace safely without throwing', async () => {
		mockState.workspaces.clear();
		const result = await syncEntitlementMirrors({
			workspaceKey: 'missing',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			client,
		});

		assert.equal(result.synced, false);
		assert.equal(result.reason, 'workspace_not_found');
		assert.equal(mockState.subscriptions.get('sub-1').entitlement_sync_version, 2);
	});

	it('does not fail authoritative entitlement when owner user is missing', async () => {
		mockState.workspaces.set('workspace-1', {
			id: 'workspace-1',
			workspace_key: 'demo',
			plan_slug: 'free',
			owner: '',
		});

		const result = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			source: 'free',
			client,
		});

		assert.equal(result.synced, true);
		assert.equal(result.ownerMissing, true);
		assert.equal(result.userMirrorUpdated, false);
		assert.equal(mockState.workspaces.get('workspace-1').plan_slug, 'pro');
		assert.equal(mockState.subscriptions.get('sub-1').entitlement_sync_version, 3);
	});

	it('preserves Paddle activation/cancellation mirror semantics', async () => {
		const activation = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'pro' },
			subscriptionId: 'sub-1',
			actor: 'webhook:paddle',
			source: 'paddle_webhook',
			client,
		});
		assert.equal(activation.source, 'paddle_webhook');
		assert.equal(activation.sourceKind, 'activation');
		assert.equal(mockState.workspaces.get('workspace-1').plan_slug, 'pro');
		assert.equal(mockState.users.get('user-1').plan, 'pro');

		const cancellation = await syncEntitlementMirrors({
			workspaceKey: 'demo',
			plan: { slug: 'free' },
			subscriptionId: 'sub-1',
			actor: 'webhook:paddle',
			source: 'paddle_webhook',
			client,
		});
		assert.equal(cancellation.planSlug, 'free');
		assert.equal(mockState.workspaces.get('workspace-1').plan_slug, 'free');
		assert.equal(mockState.users.get('user-1').plan, 'free');
	});
});
