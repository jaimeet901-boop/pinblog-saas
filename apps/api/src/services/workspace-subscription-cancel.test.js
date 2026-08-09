/**
 * Phase 4.3-F — Workspace HTTP subscription cancellation route tests.
 * Run: node --test src/services/workspace-subscription-cancel.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancelWorkspaceSubscription } from './workspace-subscription-cancel.js';

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

/** Test-local capability assert — avoids loading workspace-rbac → pocketbase in unit tests. */
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

function withTestDeps(overrides = {}) {
	return {
		assertCapability: testAssertCapability,
		...overrides,
	};
}

function createReq(overrides = {}) {
	return {
		workspaceKey: overrides.workspaceKey ?? 'ws-kitchen',
		workspace: { id: 'ws1', name: 'Kitchen', owner: 'user_owner' },
		workspaceUser: { id: 'user_owner', email: 'owner@example.com', name: 'Owner' },
		pocketbaseUserId: 'user_owner',
		workspaceRole: overrides.workspaceRole ?? 'owner',
		workspaceMembership: overrides.workspaceMembership ?? {
			role: overrides.workspaceRole ?? 'owner',
			status: overrides.membershipStatus ?? 'active',
			permissions: overrides.permissions,
		},
		workspaceSubscription: overrides.workspaceSubscription !== undefined
			? overrides.workspaceSubscription
			: {
				id: 'sub1',
				workspace_key: overrides.workspaceKey ?? 'ws-kitchen',
				provider: overrides.provider ?? 'paddle',
				provider_subscription_id: overrides.provider_subscription_id ?? 'sub_paddle_1',
				paddle_subscription_id: overrides.paddle_subscription_id ?? 'sub_paddle_1',
				status: 'active',
				billing_status: 'active',
			},
	};
}

function createMockCancelFn(state) {
	return async (workspaceKey, { actor, atPeriodEnd, deps } = {}) => {
		state.cancelCalls.push({ workspaceKey, actor, atPeriodEnd, deps });
		if (state.cancelThrows) throw state.cancelThrows;
		return state.cancelResult ?? { cancelled: true, atPeriodEnd, remoteConfirmed: true };
	};
}

describe('Phase 4.3-F authorization', () => {
	it('owner is allowed', async () => {
		const state = { cancelCalls: [] };
		const req = createReq({ workspaceRole: 'owner' });
		const result = await cancelWorkspaceSubscription(req, {}, withTestDeps({
			cancelSubscription: createMockCancelFn(state),
		}));
		assert.equal(result.success, true);
		assert.equal(state.cancelCalls.length, 1);
	});

	it('administrator is allowed', async () => {
		const state = { cancelCalls: [] };
		const req = createReq({ workspaceRole: 'administrator' });
		await cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: createMockCancelFn(state) }));
		assert.equal(state.cancelCalls.length, 1);
	});

	it('viewer is denied', async () => {
		const req = createReq({ workspaceRole: 'viewer' });
		await assert.rejects(
			() => cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: async () => ({ cancelled: true }) })),
			(err) => err.status === 403 && err.errorCode === 'FORBIDDEN',
		);
	});

	it('author is denied', async () => {
		const req = createReq({ workspaceRole: 'author' });
		await assert.rejects(
			() => cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: async () => ({ cancelled: true }) })),
			(err) => err.status === 403,
		);
	});

	it('editor is denied', async () => {
		const req = createReq({ workspaceRole: 'editor' });
		await assert.rejects(
			() => cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: async () => ({ cancelled: true }) })),
			(err) => err.status === 403,
		);
	});

	it('custom role with workspace.billing.manage is allowed', async () => {
		const state = { cancelCalls: [] };
		const req = createReq({
			workspaceRole: 'custom',
			workspaceMembership: {
				role: 'custom',
				status: 'active',
				permissions: ['workspace.billing.manage'],
			},
		});
		await cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: createMockCancelFn(state) }));
		assert.equal(state.cancelCalls.length, 1);
	});

	it('suspended membership is denied', async () => {
		const req = createReq({
			workspaceRole: 'owner',
			membershipStatus: 'suspended',
		});
		await assert.rejects(
			() => cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: async () => ({ cancelled: true }) })),
			(err) => err.errorCode === 'MEMBER_SUSPENDED',
		);
	});
});

describe('Phase 4.3-F input validation', () => {
	it('{} defaults to atPeriodEnd=true', async () => {
		const state = { cancelCalls: [] };
		const req = createReq();
		await cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: createMockCancelFn(state) }));
		assert.equal(state.cancelCalls[0].atPeriodEnd, true);
	});

	it('accepts atPeriodEnd:true', async () => {
		const state = { cancelCalls: [] };
		await cancelWorkspaceSubscription(createReq(), { atPeriodEnd: true }, withTestDeps({
			cancelSubscription: createMockCancelFn(state),
		}));
		assert.equal(state.cancelCalls[0].atPeriodEnd, true);
	});

	it('accepts atPeriodEnd:false', async () => {
		const state = { cancelCalls: [] };
		await cancelWorkspaceSubscription(createReq(), { atPeriodEnd: false }, withTestDeps({
			cancelSubscription: createMockCancelFn(state),
		}));
		assert.equal(state.cancelCalls[0].atPeriodEnd, false);
	});

	for (const bad of ['true', 'false', 1, 0, null, [], {}]) {
		it(`rejects atPeriodEnd=${JSON.stringify(bad)}`, async () => {
			await assert.rejects(
				() => cancelWorkspaceSubscription(createReq(), { atPeriodEnd: bad }, withTestDeps({
					cancelSubscription: async () => ({ cancelled: true }),
				})),
				(err) => err.status === 422 && err.errorCode === 'VALIDATION_ERROR',
			);
		});
	}
});

describe('Phase 4.3-F service integration', () => {
	it('calls cancellation service with trusted workspaceKey', async () => {
		const state = { cancelCalls: [] };
		const req = createReq({ workspaceKey: 'ws-trusted' });
		await cancelWorkspaceSubscription(req, { workspaceKey: 'ws-attacker' }, withTestDeps({
			cancelSubscription: createMockCancelFn(state),
		}));
		assert.equal(state.cancelCalls[0].workspaceKey, 'ws-trusted');
	});

	it('does not pass provider from body to cancel service', async () => {
		const state = { cancelCalls: [] };
		await cancelWorkspaceSubscription(createReq(), {
			provider: 'paypal',
			providerSubscriptionId: 'evil',
			subscriptionId: 'evil',
			actor: 'admin',
		}, withTestDeps({ cancelSubscription: createMockCancelFn(state) }));
		assert.equal(Object.keys(state.cancelCalls[0]).join(','), 'workspaceKey,actor,atPeriodEnd,deps');
	});

	it('actor comes from authenticated user context', async () => {
		const state = { cancelCalls: [] };
		const req = createReq();
		await cancelWorkspaceSubscription(req, { actor: 'admin' }, withTestDeps({
			cancelSubscription: createMockCancelFn(state),
		}));
		assert.equal(state.cancelCalls[0].actor, 'owner@example.com');
	});

	it('missing subscription returns 404', async () => {
		const req = createReq({ workspaceSubscription: null });
		await assert.rejects(
			() => cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: async () => ({ cancelled: true }) })),
			(err) => err.status === 404 && err.errorCode === 'NOT_FOUND',
		);
	});

	it('cross-workspace subscription mismatch is forbidden', async () => {
		const req = createReq({
			workspaceKey: 'ws-a',
			workspaceSubscription: {
				id: 'sub1',
				workspace_key: 'ws-b',
				provider: 'paddle',
			},
		});
		await assert.rejects(
			() => cancelWorkspaceSubscription(req, {}, withTestDeps({ cancelSubscription: async () => ({ cancelled: true }) })),
			(err) => err.status === 403 && err.errorCode === 'FORBIDDEN',
		);
	});

	it('provider failure propagates fail-closed', async () => {
		const error = new Error('Provider cancellation failed');
		error.status = 502;
		error.errorCode = 'PROVIDER_CANCEL_FAILED';
		const req = createReq();
		await assert.rejects(
			() => cancelWorkspaceSubscription(req, {}, withTestDeps({
				cancelSubscription: async () => { throw error; },
			})),
			(err) => err.errorCode === 'PROVIDER_CANCEL_FAILED',
		);
	});

	it('idempotency conflict propagates 409', async () => {
		const error = new Error('Cancellation already in progress');
		error.status = 409;
		error.errorCode = 'CANCELLATION_IN_PROGRESS';
		await assert.rejects(
			() => cancelWorkspaceSubscription(createReq(), {}, withTestDeps({
				cancelSubscription: async () => { throw error; },
			})),
			(err) => err.status === 409 && err.errorCode === 'CANCELLATION_IN_PROGRESS',
		);
	});

	it('refund_pending result is preserved', async () => {
		const result = await cancelWorkspaceSubscription(createReq(), {}, withTestDeps({
			cancelSubscription: async () => ({
				cancelled: true,
				refundPending: true,
				preserved: true,
			}),
		}));
		assert.equal(result.refundPending, true);
		assert.equal(result.preserved, true);
	});

	it('alreadyScheduled result is preserved', async () => {
		const result = await cancelWorkspaceSubscription(createReq(), {}, withTestDeps({
			cancelSubscription: async () => ({
				cancelled: true,
				alreadyScheduled: true,
				atPeriodEnd: true,
			}),
		}));
		assert.equal(result.alreadyScheduled, true);
	});

	it('successful response exposes safe fields only', async () => {
		const result = await cancelWorkspaceSubscription(createReq(), {}, withTestDeps({
			cancelSubscription: async () => ({
				cancelled: true,
				atPeriodEnd: true,
				remoteConfirmed: true,
				provider: 'paddle',
				raw: { secret: 'must-not-leak' },
			}),
		}));
		assert.equal(result.success, true);
		assert.equal(result.cancelled, true);
		assert.equal(result.remoteConfirmed, true);
		assert.equal(result.raw, undefined);
		assert.equal(result.provider, undefined);
	});
});

describe('Phase 4.3-F static route guards', () => {
	it('POST /subscription/cancel exists exactly once in workspace router', () => {
		const routes = readSrc('routes/workspace/index.js');
		const matches = routes.match(/subscription\/cancel/g) || [];
		assert.equal(matches.length, 1);
		assert.match(routes, /router\.post\('\s*\/subscription\/cancel'/);
	});

	it('route is behind pocketbaseAuth and resolveWorkspace', () => {
		const routes = readSrc('routes/workspace/index.js');
		assert.match(routes, /router\.use\(pocketbaseAuth,\s*resolveWorkspace\)/);
		const cancelIdx = routes.indexOf("router.post('/subscription/cancel'");
		const middlewareIdx = routes.indexOf('router.use(pocketbaseAuth, resolveWorkspace)');
		assert.ok(cancelIdx > middlewareIdx);
	});

	it('handler uses workspace.billing.manage', () => {
		const source = readSrc('services/workspace-subscription-cancel.js');
		assert.match(source, /cancelWorkspaceSubscription/);
		assert.match(source, /workspace\.billing\.manage/);
	});

	it('handler delegates to cancelSubscription service', () => {
		const source = readSrc('services/workspace-subscription-cancel.js');
		assert.match(source, /billing\/subscription-cancel\.js/);
		assert.doesNotMatch(source, /provider\.cancelSubscription/);
		assert.doesNotMatch(source, /claimIdempotencyKey/);
	});

	it('handler does not trust client workspaceKey in payload', () => {
		const source = readSrc('services/workspace-subscription-cancel.js');
		assert.match(source, /req\.workspaceKey/);
		assert.doesNotMatch(source, /payload\.workspaceKey/);
	});

	it('Stripe and Lemon Squeezy providers untouched', () => {
		assert.doesNotMatch(readSrc('services/billing/providers/stripe.js'), /cancelWorkspaceSubscription/);
		assert.doesNotMatch(readSrc('services/billing/providers/lemonsqueezy.js'), /cancelWorkspaceSubscription/);
	});

	it('subscription-cancel.js unchanged for HTTP idempotency', () => {
		const source = readSrc('services/billing/subscription-cancel.js');
		assert.match(source, /buildSubscriptionCancelIdempotencyKey/);
		assert.doesNotMatch(readSrc('routes/workspace/index.js'), /claimIdempotencyKey/);
	});
});

describe('Phase 4.3-F middleware reference', () => {
	it('unauthenticated pattern matches middleware (401 UNAUTHENTICATED)', () => {
		const source = readSrc('middleware/resolve-workspace.js');
		assert.match(source, /UNAUTHENTICATED/);
		assert.match(source, /401/);
	});
});
