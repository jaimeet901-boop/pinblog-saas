/**
 * Phase 4.5 — Admin workspace plan drift protection tests.
 * Run: node --test src/services/admin/admin-workspace-plan-drift.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ADMIN_WORKSPACE_PLAN_ASSIGN_DIRECTIVE,
	buildAdminWorkspaceAllowedPatch,
	rejectDirectWorkspacePlanPatch,
} from './admin-workspace-plan-drift-guard.js';
import { assignWorkspacePlan } from '../billing/assign-workspace-plan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspacesSource = readFileSync(join(__dirname, 'workspaces.js'), 'utf8');
const guardSource = readFileSync(join(__dirname, 'admin-workspace-plan-drift-guard.js'), 'utf8');

describe('Phase 4.5 rejectDirectWorkspacePlanPatch', () => {
	it('rejects payload.plan with 422 directing to plans assign', () => {
		assert.throws(
			() => rejectDirectWorkspacePlanPatch({ plan: 'pro' }),
			(err) => err.status === 422
				&& err.errorCode === 'WORKSPACE_PLAN_PATCH_FORBIDDEN'
				&& String(err.message).includes(ADMIN_WORKSPACE_PLAN_ASSIGN_DIRECTIVE),
		);
	});

	it('rejects payload.plan_slug with 422 directing to plans assign', () => {
		assert.throws(
			() => rejectDirectWorkspacePlanPatch({ plan_slug: 'pro' }),
			(err) => err.status === 422
				&& err.errorCode === 'WORKSPACE_PLAN_PATCH_FORBIDDEN'
				&& String(err.message).includes(ADMIN_WORKSPACE_PLAN_ASSIGN_DIRECTIVE),
		);
	});

	it('allows name and status patches', () => {
		assert.doesNotThrow(() => rejectDirectWorkspacePlanPatch({ name: 'New Name' }));
		assert.doesNotThrow(() => rejectDirectWorkspacePlanPatch({ status: 'active' }));
	});
});

describe('Phase 4.5 buildAdminWorkspaceAllowedPatch', () => {
	it('PATCH with plan throws before any patch fields are built', () => {
		assert.throws(
			() => buildAdminWorkspaceAllowedPatch({ plan: 'pro' }),
			(err) => err.status === 422
				&& String(err.message).includes('POST /admin/v1/plans/assign'),
		);
	});

	it('PATCH with plan_slug throws before any patch fields are built', () => {
		assert.throws(
			() => buildAdminWorkspaceAllowedPatch({ plan_slug: 'pro' }),
			(err) => err.status === 422
				&& String(err.message).includes('POST /admin/v1/plans/assign'),
		);
	});

	it('PATCH with name builds allowed update only', () => {
		const patch = buildAdminWorkspaceAllowedPatch({ name: 'New Name' });
		assert.deepEqual(patch, { name: 'New Name' });
		assert.equal('plan_slug' in patch, false);
	});

	it('PATCH with status builds allowed update only', () => {
		const patch = buildAdminWorkspaceAllowedPatch({ status: 'active' });
		assert.deepEqual(patch, { status: 'active' });
		assert.equal('plan_slug' in patch, false);
	});

	it('rejects mixed plan + allowed fields without partial patch', () => {
		assert.throws(
			() => buildAdminWorkspaceAllowedPatch({ name: 'New Name', plan: 'pro' }),
			(err) => err.status === 422,
		);
	});
});

describe('Phase 4.5 assignWorkspacePlan regression', () => {
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

	function createAssignClient() {
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
					async getFirstListItem() {
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

	beforeEach(() => {
		resetMockState();
		mockState.plans.set('plan_pro', {
			id: 'plan_pro',
			slug: 'pro',
			name: 'Pro',
			credits: 500,
			monthly_price: 49,
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
			expand: { plan: { slug: 'free', monthly_price: 0 } },
		});
	});

	it('assignWorkspacePlan still updates authoritative subscription and mirror', async () => {
		mockState.plans.set('plan_free', {
			id: 'plan_free',
			slug: 'free',
			name: 'Free',
			credits: 50,
			monthly_price: 0,
		});

		const result = await assignWorkspacePlan({
			workspaceKey: 'demo',
			workspaceName: 'Demo',
			planId: 'plan_pro',
			reason: 'Support correction',
		}, {
			actorUserId: 'admin_user_123',
		}, {
			client: createAssignClient(),
			logBillingAction: async (payload) => {
				mockState.auditCalls.push(payload);
			},
		});

		assert.equal(result.planSlug, 'pro');
		assert.equal(mockState.workspaces.get('workspace-1').plan_slug, 'pro');
		assert.equal(mockState.subscriptions.get('sub-1').plan, 'plan_pro');
		assert.equal(mockState.auditCalls.length, 1);
	});
});

describe('Phase 4.5 static guards', () => {
	it('does not silently reroute plan patches to assign', () => {
		const fnBlock = workspacesSource.match(
			/export async function updateAdminWorkspace[\s\S]*?(?=\nexport async function|\nexport function|$)/,
		)?.[0] || '';
		assert.match(workspacesSource, /buildAdminWorkspaceAllowedPatch/);
		assert.match(guardSource, /WORKSPACE_PLAN_PATCH_FORBIDDEN/);
		assert.doesNotMatch(fnBlock, /assignWorkspacePlan/);
		assert.doesNotMatch(fnBlock, /payload\.plan != null\) updates\.plan_slug/);
	});

	it('guard runs before PocketBase workspace update', () => {
		const guardIdx = workspacesSource.indexOf('buildAdminWorkspaceAllowedPatch(payload)');
		const updateIdx = workspacesSource.indexOf("collection('workspaces').update");
		assert.ok(guardIdx > 0 && updateIdx > guardIdx);
	});
});
