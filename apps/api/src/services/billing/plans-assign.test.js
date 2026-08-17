/**
 * Phase 3.3 — Admin assignWorkspacePlan override metadata tests.
 * Run: node --test src/services/billing/plans-assign.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildAdminAssignMetadataFields,
	resolveAdminOverrideActor,
	subscriptionPatchOmitsPaddleIdentityFields,
	validateAdminOverrideReason,
	PADDLE_IDENTITY_FIELDS,
} from './admin-plan-assign.js';
import { assignWorkspacePlan } from './assign-workspace-plan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assignSource = readFileSync(join(__dirname, 'assign-workspace-plan.js'), 'utf8');

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
			filter: (template, params = {}) => ({ template, params }),
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
					async getFirstListItem(filterExpr, _opts) {
						const key = String(filterExpr?.params?.key || '').trim();
						if (name === 'workspace_subscriptions') {
							for (const row of mockState.subscriptions.values()) {
								if (!key || row.workspace_key === key) {
									return { ...row, expand: row.expand || {} };
								}
							}
							throw new Error('subscription_not_found');
						}
						if (name === 'workspaces') {
							for (const row of mockState.workspaces.values()) {
								if (!key || row.workspace_key === key) {
									return { ...row };
								}
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
			name: 'Demo',
			workspace_key: 'demo',
			plan_slug: 'free',
			owner: 'user-1',
			billing_email: 'owner@example.com',
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
			name: 'Demo',
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

	it('requires reason before any subscription write', async () => {
		await assert.rejects(
			() => assignWorkspacePlan({
				workspaceKey: 'demo',
				planId: 'plan_pro',
			}, { actorUserId: 'admin_user_123' }, {
				client,
				logBillingAction: async (payload) => mockState.auditCalls.push(payload),
			}),
			(err) => err.status === 422 && err.errorCode === 'VALIDATION_ERROR',
		);
		assert.equal(mockState.updates.length, 0);
		assert.equal(mockState.auditCalls.length, 0);
	});

	it('rejects a nonexistent workspace before any subscription write', async () => {
		await assert.rejects(
			() => assignWorkspacePlan({
				workspaceKey: 'missing-workspace',
				workspaceName: 'Sunday Kitchen',
				planId: 'plan_pro',
				reason: 'Support correction',
			}, { actorUserId: 'admin_user_123' }, {
				client,
				logBillingAction: async (payload) => mockState.auditCalls.push(payload),
			}),
			(err) => err.status === 404 && err.errorCode === 'WORKSPACE_NOT_FOUND',
		);
		assert.equal(mockState.updates.length, 0);
		assert.equal(mockState.auditCalls.length, 0);
		assert.equal(mockState.subscriptions.get('sub-1').plan, 'plan_free');
	});

	it('does not treat workspaceName as the authoritative workspaceKey', async () => {
		await assert.rejects(
			() => assignWorkspacePlan({
				workspaceName: 'Sunday Kitchen',
				ownerEmail: 'owner@example.com',
				planId: 'plan_pro',
				reason: 'Support correction',
			}, { actorUserId: 'admin_user_123' }, {
				client,
				logBillingAction: async (payload) => mockState.auditCalls.push(payload),
			}),
			(err) => err.status === 422 && err.errorCode === 'VALIDATION_ERROR',
		);
		assert.equal(mockState.updates.length, 0);
		assert.equal(
			[...mockState.subscriptions.values()].some((row) => row.workspace_key === 'sunday-kitchen'),
			false,
		);
	});

	it('does not create an orphan subscription when the workspace does not exist', async () => {
		mockState.workspaces.clear();
		await assert.rejects(
			() => assignWorkspacePlan({
				workspaceKey: 'orphan-key',
				workspaceName: 'Orphan',
				planId: 'plan_pro',
				reason: 'Support correction',
			}, { actorUserId: 'admin_user_123' }, {
				client,
				logBillingAction: async () => {},
			}),
			(err) => err.status === 404 && err.errorCode === 'WORKSPACE_NOT_FOUND',
		);
		assert.equal(
			mockState.updates.some((row) => row.created && (row.storeKey === 'workspace_subscriptions' || row.storeKey === 'subscriptions')),
			false,
		);
		assert.equal(
			[...mockState.subscriptions.values()].some((row) => row.workspace_key === 'orphan-key'),
			false,
		);
	});

	it('writes subscription, billing event, audit, and entitlement sync with the canonical workspace_key', async () => {
		const syncCalls = [];
		const result = await assignWorkspacePlan({
			workspaceKey: 'demo',
			workspaceName: 'Ignored display name',
			planId: 'plan_pro',
			reason: 'Canonical key assignment',
		}, {
			actorUserId: 'admin_user_123',
			actor: 'admin@example.com',
		}, {
			client,
			syncEntitlementMirrors: async (payload) => {
				syncCalls.push(payload);
				return { synced: true };
			},
			logBillingAction: async (payload) => {
				mockState.auditCalls.push(payload);
			},
		});

		const subscription = mockState.subscriptions.get('sub-1');
		assert.equal(result.workspaceKey, 'demo');
		assert.equal(subscription.workspace_key, 'demo');
		assert.equal(syncCalls[0].workspaceKey, 'demo');
		assert.equal(mockState.auditCalls[0].workspaceKey, 'demo');
		assert.equal(mockState.auditCalls[0].metadata.workspaceKey, 'demo');
		assert.equal(mockState.auditCalls[0].eventType, 'upgrade');
	});

	it('ignores client actor spoofing on assign', async () => {
		await assignWorkspacePlan({
			workspaceKey: 'demo',
			planId: 'plan_pro',
			reason: 'Actor spoof check',
			override_actor: 'attacker',
			actor: 'attacker@evil.test',
		}, {
			actorUserId: 'admin_user_123',
			actor: 'admin@example.com',
		}, {
			client,
			logBillingAction: async (payload) => mockState.auditCalls.push(payload),
		});

		assert.equal(mockState.subscriptions.get('sub-1').override_actor, 'admin_user_123');
		assert.equal(mockState.auditCalls[0].metadata.overrideActor, 'admin_user_123');
	});

	it('customer subscription lookup uses the same canonical workspace_key', async () => {
		mockState.workspaces.set('workspace-2', {
			id: 'workspace-2',
			name: 'Other',
			workspace_key: 'other-ws',
			plan_slug: 'free',
			owner: 'user-2',
		});
		mockState.subscriptions.set('sub-2', {
			id: 'sub-2',
			workspace_key: 'other-ws',
			workspace_name: 'Other',
			plan: 'plan_free',
			expand: { plan: { slug: 'free', monthly_price: 0 } },
		});

		await assignWorkspacePlan({
			workspaceKey: 'demo',
			planId: 'plan_pro',
			reason: 'Customer reflection',
		}, {
			actorUserId: 'admin_user_123',
		}, {
			client,
			logBillingAction: async () => {},
		});

		const customerKey = 'demo';
		const customerSubscription = [...mockState.subscriptions.values()]
			.find((row) => row.workspace_key === customerKey);
		const otherSubscription = mockState.subscriptions.get('sub-2');
		assert.equal(customerSubscription.plan, 'plan_pro');
		assert.equal(otherSubscription.plan, 'plan_free');
		assert.equal(otherSubscription.workspace_key, 'other-ws');
	});
});

describe('assignWorkspacePlan isolation source guards', () => {
	it('does not slugify workspaceName into the authoritative key', () => {
		assert.doesNotMatch(assignSource, /slugify\(/);
		assert.doesNotMatch(
			assignSource,
			/workspaceKey \|\| payload\.workspace_key \|\| payload\.workspaceName/,
		);
		assert.match(assignSource, /WORKSPACE_NOT_FOUND/);
	});
});
