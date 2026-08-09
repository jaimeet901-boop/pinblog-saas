/**
 * Phase 3.3 — Admin assignWorkspacePlan override metadata tests.
 * Run: node --test src/services/billing/plans-assign.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildAdminAssignMetadataFields,
	resolveAdminOverrideActor,
	subscriptionPatchOmitsPaddleIdentityFields,
	validateAdminOverrideReason,
	PADDLE_IDENTITY_FIELDS,
} from './admin-plan-assign.js';
import { assignWorkspacePlan } from './assign-workspace-plan.js';

describe('admin override validation helpers', () => {
	it('accepts explicit reason field', () => {
		assert.equal(validateAdminOverrideReason({ reason: 'Support escalation' }), 'Support escalation');
	});

	it('rejects missing reason (Test 5)', () => {
		assert.throws(
			() => validateAdminOverrideReason({}),
			(err) => err.status === 422 && err.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('rejects whitespace-only reason (Test 6)', () => {
		assert.throws(
			() => validateAdminOverrideReason({ reason: '   \t  ' }),
			(err) => err.status === 422,
		);
	});

	it('uses server-side admin identity and ignores client actor spoofing (Test 7)', () => {
		const actor = resolveAdminOverrideActor(
			{ actorUserId: 'admin_user_123', actor: 'admin@example.com' },
			{ override_actor: 'attacker', actor: 'attacker@evil.test' },
		);
		assert.equal(actor, 'admin_user_123');
	});

	it('builds Phase 1 override metadata enums (Test 1 fields)', () => {
		const meta = buildAdminAssignMetadataFields('admin_user_123', 'Manual correction');
		assert.equal(meta.activation_source, 'admin_override');
		assert.equal(meta.billing_source, 'admin_override');
		assert.equal(meta.override_actor, 'admin_user_123');
		assert.equal(meta.override_reason, 'Manual correction');
	});

	it('subscription patch omits Paddle identity fields (Test 8)', () => {
		assert.equal(subscriptionPatchOmitsPaddleIdentityFields({
			plan: 'plan_pro',
			activation_source: 'admin_override',
		}), true);
		for (const field of PADDLE_IDENTITY_FIELDS) {
			assert.equal(subscriptionPatchOmitsPaddleIdentityFields({ [field]: 'value' }), false);
		}
	});
});

describe('assignWorkspacePlan integration', () => {
	const mockState = {
		plans: new Map(),
		subscriptions: new Map(),
		workspaces: new Map(),
		users: new Map(),
		updates: [],
		auditCalls: [],
	};

	function resetMockState() {
		mockState.plans.clear();
		mockState.subscriptions.clear();
		mockState.workspaces.clear();
		mockState.users.clear();
		mockState.updates = [];
		mockState.auditCalls = [];
	}

	function recordUpdate(storeKey, id, body) {
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
		mockState.updates.push({ storeKey, id, body });
		return next;
	}

	function createMockClient() {
		return {
			filter: (template) => template,
			collection(name) {
				return {
					async getOne(id) {
						if (name === 'plans') {
							const plan = mockState.plans.get(id);
							if (!plan) throw new Error('plan_not_found');
							return { ...plan };
						}
						throw new Error(`unexpected getOne ${name}`);
					},
					async getFirstListItem(_filter, _opts) {
						if (name === 'workspace_subscriptions') {
							for (const row of mockState.subscriptions.values()) {
								return { ...row, expand: row.expand || {} };
							}
							throw new Error('subscription_not_found');
						}
						if (name === 'workspaces') {
							for (const row of mockState.workspaces.values()) {
								return { ...row };
							}
							throw new Error('workspace_not_found');
						}
						throw new Error(`unexpected getFirstListItem ${name}`);
					},
					async update(id, body) {
						if (name === 'workspace_subscriptions') return recordUpdate('subscriptions', id, body);
						if (name === 'workspaces') return recordUpdate('workspaces', id, body);
						if (name === 'users') return recordUpdate('users', id, body);
						throw new Error(`unexpected update ${name}`);
					},
					async create(body) {
						const id = body.id || `${name}_${mockState.updates.length + 1}`;
						const record = { id, ...body };
						if (name === 'workspace_subscriptions') mockState.subscriptions.set(id, record);
						mockState.updates.push({ storeKey: name, id, body, created: true });
						return record;
					},
				};
			},
		};
	}

	let client;

	beforeEach(() => {
		resetMockState();
		client = createMockClient();
		mockState.plans.set('plan_pro', {
			id: 'plan_pro',
			slug: 'pro',
			name: 'Pro',
			credits: 500,
			monthly_price: 49,
		});
		mockState.plans.set('plan_free', {
			id: 'plan_free',
			slug: 'free',
			name: 'Free',
			credits: 50,
			monthly_price: 0,
		});
		mockState.workspaces.set('workspace-1', {
			id: 'workspace-1',
			workspace_key: 'demo',
			plan_slug: 'free',
			owner: 'user-1',
		});
		mockState.users.set('user-1', { id: 'user-1', plan: 'free' });
		mockState.subscriptions.set('sub-1', {
			id: 'sub-1',
			workspace_key: 'demo',
			workspace_name: 'Demo',
			plan: 'plan_free',
			entitlement_sync_version: 1,
			billing_source: 'paddle',
			provider: 'paddle',
			paddle_subscription_id: 'sub_paddle_live',
			paddle_customer_id: 'cus_paddle',
			paddle_transaction_id: 'txn_old',
			paddle_price_id: 'price_old',
			expand: { plan: { slug: 'free', monthly_price: 0 } },
		});
	});

	afterEach(() => {
		resetMockState();
	});

	it('persists override metadata and syncs mirrors (Tests 1–4, 11)', async () => {
		const result = await assignWorkspacePlan({
			workspaceKey: 'demo',
			workspaceName: 'Demo',
			planId: 'plan_pro',
			reason: 'Customer support upgrade',
		}, {
			actorUserId: 'admin_user_123',
			actor: 'admin@example.com',
		}, {
			client,
			logBillingAction: async (payload) => {
				mockState.auditCalls.push(payload);
			},
		});

		const subscription = mockState.subscriptions.get('sub-1');
		assert.equal(subscription.activation_source, 'admin_override');
		assert.equal(subscription.billing_source, 'admin_override');
		assert.equal(subscription.override_actor, 'admin_user_123');
		assert.equal(subscription.override_reason, 'Customer support upgrade');
		assert.equal(mockState.workspaces.get('workspace-1').plan_slug, 'pro');
		assert.equal(mockState.users.get('user-1').plan, 'pro');
		assert.equal(subscription.entitlement_sync_version, 2);
		assert.ok(subscription.last_entitlement_sync_at);
		assert.equal(result.planSlug, 'pro');
	});

	it('preserves Paddle identity fields and does not fabricate remote changes (Tests 8–9)', async () => {
		await assignWorkspacePlan({
			workspaceKey: 'demo',
			workspaceName: 'Demo',
			planId: 'plan_pro',
			reason: 'Local admin override only',
		}, {
			actorUserId: 'admin_user_123',
		}, {
			client,
			logBillingAction: async (payload) => {
				mockState.auditCalls.push(payload);
			},
		});

		const subscription = mockState.subscriptions.get('sub-1');
		assert.equal(subscription.paddle_subscription_id, 'sub_paddle_live');
		assert.equal(subscription.paddle_customer_id, 'cus_paddle');
		assert.equal(subscription.paddle_transaction_id, 'txn_old');
		assert.equal(subscription.paddle_price_id, 'price_old');
		assert.equal(subscription.provider, 'paddle');

		const subscriptionUpdates = mockState.updates.filter((row) => row.storeKey === 'subscriptions');
		for (const update of subscriptionUpdates) {
			assert.equal(subscriptionPatchOmitsPaddleIdentityFields(update.body), true);
		}
	});

	it('writes billing audit with actor/reason/plan metadata (Test 10)', async () => {
		await assignWorkspacePlan({
			workspaceKey: 'demo',
			workspaceName: 'Demo',
			planId: 'plan_pro',
			reason: 'Billing correction',
		}, {
			actorUserId: 'admin_user_123',
			actor: 'admin@example.com',
		}, {
			client,
			logBillingAction: async (payload) => {
				mockState.auditCalls.push(payload);
			},
		});

		assert.equal(mockState.auditCalls.length, 1);
		const audit = mockState.auditCalls[0];
		assert.equal(audit.metadata.source, 'admin_override');
		assert.equal(audit.metadata.reason, 'Billing correction');
		assert.equal(audit.metadata.overrideActor, 'admin_user_123');
		assert.equal(audit.metadata.previousPlan, 'free');
		assert.equal(audit.metadata.newPlan, 'pro');
		assert.equal(audit.metadata.workspaceKey, 'demo');
		assert.equal(audit.fromPlan, 'free');
		assert.equal(audit.toPlan, 'pro');
	});

	it('syncs workspace mirror when owner is missing (Test 12)', async () => {
		mockState.workspaces.set('workspace-1', {
			id: 'workspace-1',
			workspace_key: 'demo',
			plan_slug: 'free',
			owner: '',
		});

		await assignWorkspacePlan({
			workspaceKey: 'demo',
			workspaceName: 'Demo',
			planId: 'plan_pro',
			reason: 'Owner missing case',
		}, {
			actorUserId: 'admin_user_123',
		}, {
			client,
			logBillingAction: async () => {},
		});

		assert.equal(mockState.workspaces.get('workspace-1').plan_slug, 'pro');
		assert.equal(mockState.subscriptions.get('sub-1').override_reason, 'Owner missing case');
	});
});
