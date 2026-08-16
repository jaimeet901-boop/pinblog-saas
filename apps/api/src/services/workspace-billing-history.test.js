/**
 * PR-19 — Workspace customer billing history tests.
 * Run: node --test src/services/workspace-billing-history.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	getWorkspaceBillingHistory,
	isCustomerFacingBillingEvent,
	mapCustomerBillingEvent,
} from './workspace-billing-history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(__dirname, '..');

function readSrc(relativePath) {
	return readFileSync(join(apiSrc, relativePath), 'utf8');
}

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function testAssertCapability(req, capability) {
	const membership = req.workspaceMembership || { role: req.workspaceRole || 'viewer' };
	if (membership.status === 'suspended') {
		throw httpError(403, 'Member is suspended', 'MEMBER_SUSPENDED');
	}
	const role = String(membership.role || req.workspaceRole || 'viewer').toLowerCase();
	if (role === 'owner' || role === 'administrator') return;
	if (role === 'custom') {
		const perms = Array.isArray(membership.permissions) ? membership.permissions : [];
		if (perms.includes(capability)) return;
	}
	throw httpError(403, `Missing capability: ${capability}`, 'FORBIDDEN');
}

function createReq(overrides = {}) {
	return {
		workspaceKey: overrides.workspaceKey ?? 'ws-kitchen',
		workspaceRole: overrides.workspaceRole ?? 'owner',
		workspaceMembership: overrides.workspaceMembership ?? {
			role: overrides.workspaceRole ?? 'owner',
			status: overrides.membershipStatus ?? 'active',
			permissions: overrides.permissions,
		},
		query: overrides.query || {},
	};
}

function withDeps(listEvents, extra = {}) {
	return {
		assertCapability: testAssertCapability,
		listEvents,
		...extra,
	};
}

function eventRow(overrides = {}) {
	return {
		id: overrides.id || 'ev1',
		workspace_key: overrides.workspace_key ?? 'ws-kitchen',
		event_type: overrides.event_type || 'credits_purchased',
		message: overrides.message || 'Paddle credit pack fulfilled',
		occurred_at: overrides.occurred_at || '2026-08-16T12:00:00.000Z',
		from_plan: overrides.from_plan || '',
		to_plan: overrides.to_plan || '',
		metadata: overrides.metadata || {
			amountSnapshot: 9,
			currencySnapshot: 'USD',
			providerSnapshot: 'paddle',
		},
	};
}

describe('PR-19 customer event allowlist', () => {
	it('includes Paddle credits_purchased', () => {
		assert.equal(isCustomerFacingBillingEvent(eventRow()), true);
		const mapped = mapCustomerBillingEvent(eventRow());
		assert.equal(mapped.type, 'credits_purchased');
		assert.equal(mapped.label, 'Credit pack');
		assert.equal(mapped.amount, 9);
		assert.equal(mapped.provider, 'paddle');
	});

	it('includes customer cancellation and drops claim/idempotency noise', () => {
		assert.equal(isCustomerFacingBillingEvent(eventRow({
			event_type: 'cancelled',
			message: 'Cancellation scheduled',
		})), true);
		assert.equal(isCustomerFacingBillingEvent(eventRow({
			event_type: 'cancelled',
			message: 'Cancellation claim acquired',
		})), false);
		assert.equal(isCustomerFacingBillingEvent(eventRow({
			event_type: 'cancelled',
			message: 'Cancellation duplicate — operation in progress',
		})), false);
	});

	it('does not treat checkout topup as a purchase', () => {
		assert.equal(isCustomerFacingBillingEvent(eventRow({
			event_type: 'topup',
			message: 'Credit pack checkout started',
		})), false);
	});
});

describe('PR-19 getWorkspaceBillingHistory', () => {
	it('returns only the authenticated workspace rows', async () => {
		const listedKeys = [];
		const result = await getWorkspaceBillingHistory(createReq(), {}, withDeps(async (workspaceKey) => {
			listedKeys.push(workspaceKey);
			return {
				items: [
					eventRow({ id: 'mine', workspace_key: 'ws-kitchen' }),
					eventRow({ id: 'other', workspace_key: 'ws-other', message: 'Other workspace pack' }),
				],
			};
		}));
		assert.deepEqual(listedKeys, ['ws-kitchen']);
		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].id, 'mine');
	});

	it('ignores a client-supplied workspace key', async () => {
		const listedKeys = [];
		const req = createReq({
			workspaceKey: 'ws-kitchen',
			query: { workspaceKey: 'ws-other', workspace_id: 'ws-other' },
		});
		await getWorkspaceBillingHistory(req, req.query, withDeps(async (workspaceKey) => {
			listedKeys.push(workspaceKey);
			return { items: [eventRow()] };
		}));
		assert.deepEqual(listedKeys, ['ws-kitchen']);
	});

	it('surfaces Paddle credits_purchased and customer cancellation together', async () => {
		const result = await getWorkspaceBillingHistory(createReq(), {}, withDeps(async () => ({
			items: [
				eventRow({ id: 'pack', event_type: 'credits_purchased', message: 'Paddle credit pack fulfilled' }),
				eventRow({
					id: 'cancel',
					event_type: 'cancelled',
					message: 'Cancellation scheduled',
					metadata: { providerSnapshot: 'paddle' },
				}),
				eventRow({
					id: 'topup',
					event_type: 'topup',
					message: 'Credit pack checkout started',
				}),
				eventRow({
					id: 'claim',
					event_type: 'cancelled',
					message: 'Cancellation claim acquired',
				}),
			],
		})));
		assert.deepEqual(result.items.map((row) => row.id), ['pack', 'cancel']);
		assert.equal(result.items[0].type, 'credits_purchased');
		assert.equal(result.items[1].type, 'cancelled');
	});

	it('returns an empty list when the workspace has no customer-facing events', async () => {
		const result = await getWorkspaceBillingHistory(createReq(), {}, withDeps(async () => ({
			items: [
				eventRow({ event_type: 'topup', message: 'Credit pack checkout started' }),
			],
		})));
		assert.deepEqual(result.items, []);
		assert.equal(result.totalItems, 0);
	});

	it('denies viewers and allows owners', async () => {
		await assert.rejects(
			() => getWorkspaceBillingHistory(createReq({ workspaceRole: 'viewer' }), {}, withDeps(async () => ({ items: [] }))),
			(err) => err.status === 403 && err.errorCode === 'FORBIDDEN',
		);
		await assert.rejects(
			() => getWorkspaceBillingHistory(createReq({ workspaceRole: 'editor' }), {}, withDeps(async () => ({ items: [] }))),
			(err) => err.status === 403,
		);
		const ok = await getWorkspaceBillingHistory(createReq({ workspaceRole: 'owner' }), {}, withDeps(async () => ({ items: [] })));
		assert.equal(ok.totalItems, 0);
	});

	it('requires a resolved workspace key', async () => {
		await assert.rejects(
			() => getWorkspaceBillingHistory(createReq({ workspaceKey: '' }), {}, withDeps(async () => ({ items: [] }))),
			(err) => err.status === 422 && err.errorCode === 'VALIDATION_ERROR',
		);
	});
});

describe('PR-19 route guards', () => {
	it('registers GET /billing/history behind pocketbaseAuth and resolveWorkspace', () => {
		const routes = readSrc('routes/workspace/index.js');
		assert.match(routes, /router\.get\('\s*\/billing\/history'/);
		assert.match(routes, /getWorkspaceBillingHistory/);
		const historyIdx = routes.indexOf("router.get('/billing/history'");
		const middlewareIdx = routes.indexOf('router.use(pocketbaseAuth, resolveWorkspace)');
		assert.ok(historyIdx > middlewareIdx);
	});

	it('does not trust client workspaceKey in the history service', () => {
		const source = readSrc('services/workspace-billing-history.js');
		assert.match(source, /const workspaceKey = String\(req\.workspaceKey/);
		assert.equal(/listEvents\(query/.test(source), false);
		assert.equal(/query\.workspaceKey\s*\|\|/.test(source), false);
		assert.match(source, /workspace\.billing\.manage/);
	});
});
