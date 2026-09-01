/**
 * Workspace plan seat limits — focused unit tests.
 * Run: node --test src/services/billing/plan-seats.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
	resolvePlanSeatLimit,
	seatsForPlanAssignment,
	seatsForAdminPlanAssignment,
	seatsForReconciliation,
} from './plan-seats.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Mirror assertSeatAvailable seat check (logic unchanged in workspace-members.js). */
function wouldBlockNewInvite({ seats, used }) {
	const limit = Number(seats) || 1;
	return used >= limit;
}

/** Test helper — mirrors reconcileSubscriptionSeats without importing pocketbaseClient. */
async function reconcileSubscriptionSeatsTest(subscription, deps = {}) {
	const resolvePlan = deps.loadPlanFn || (async () => null);
	if (!subscription?.id) {
		return { skipped: true, reason: 'missing_subscription' };
	}
	const planRef = subscription.plan;
	const plan = typeof planRef === 'object' && planRef?.limits
		? planRef
		: await resolvePlan(planRef);
	if (!plan?.id && !plan?.limits) {
		return {
			skipped: true,
			reason: 'plan_not_resolved',
			workspaceKey: subscription.workspace_key,
		};
	}
	const nextSeats = seatsForReconciliation(plan, { currentSeats: subscription.seats });
	if (nextSeats == null) {
		return {
			skipped: true,
			reason: 'plan_unresolved',
			workspaceKey: subscription.workspace_key,
		};
	}
	const previous = Number(subscription.seats) || 1;
	if (previous === nextSeats) {
		return {
			skipped: true,
			reason: 'unchanged',
			workspaceKey: subscription.workspace_key,
			seats: previous,
		};
	}
	const client = deps.client;
	const updated = await client.collection('workspace_subscriptions').update(subscription.id, {
		seats: nextSeats,
	});
	return {
		updated: true,
		workspaceKey: subscription.workspace_key,
		previousSeats: previous,
		seats: Number(updated.seats) || nextSeats,
		planSlug: plan.slug || '',
	};
}

const PLANS = {
	free: { slug: 'free', limits: { teamMembers: 1 } },
	starter: { slug: 'starter', limits: { teamMembers: 2 } },
	pro: { slug: 'pro', limits: { teamMembers: 5 } },
	business: { slug: 'business', limits: { teamMembers: 20 } },
	enterprise: { slug: 'enterprise', limits: { teamMembers: 999999 } },
};

describe('resolvePlanSeatLimit / seatsForPlanAssignment', () => {
	it('Free = 1', () => {
		assert.equal(resolvePlanSeatLimit(PLANS.free), 1);
		assert.equal(seatsForPlanAssignment(PLANS.free), 1);
	});

	it('Starter = 2', () => {
		assert.equal(seatsForPlanAssignment(PLANS.starter), 2);
	});

	it('Pro = 5', () => {
		assert.equal(seatsForPlanAssignment(PLANS.pro), 5);
	});

	it('Business = 20', () => {
		assert.equal(seatsForPlanAssignment(PLANS.business), 20);
	});

	it('Enterprise = 999999', () => {
		assert.equal(seatsForPlanAssignment(PLANS.enterprise), 999999);
	});

	it('Pro activation assigns 5 seats', () => {
		const seats = seatsForPlanAssignment(PLANS.pro);
		assert.equal(seats, 5);
	});

	it('Free → Starter assigns 2 seats', () => {
		assert.equal(seatsForPlanAssignment(PLANS.starter), 2);
	});

	it('Starter → Pro assigns 5 seats', () => {
		assert.equal(seatsForPlanAssignment(PLANS.pro), 5);
	});

	it('Any → Free assigns 1 seat', () => {
		assert.equal(seatsForPlanAssignment(PLANS.free), 1);
	});

	it('missing limits defaults to 1', () => {
		assert.equal(seatsForPlanAssignment({ slug: 'unknown' }), 1);
	});
});

describe('downgrade with existing members (assignment only — no member removal)', () => {
	it('Pro → Starter with 4 members sets seats = 2 (used may exceed limit)', () => {
		const seats = seatsForPlanAssignment(PLANS.starter);
		const used = 4;
		assert.equal(seats, 2);
		assert.equal(used >= seats, true, 'new invites would be blocked');
	});

	it('Pro → Starter with 4 members blocks new invite (assertSeatAvailable logic)', () => {
		const seats = seatsForPlanAssignment(PLANS.starter);
		assert.equal(seats, 2);
		assert.equal(wouldBlockNewInvite({ seats, used: 4 }), true);
		assert.equal(wouldBlockNewInvite({ seats, used: 1 }), false);
	});
});

describe('seatsForAdminPlanAssignment', () => {
	it('uses plan limit when no override', () => {
		assert.equal(seatsForAdminPlanAssignment(PLANS.pro, { activeMemberCount: 1 }), 5);
	});

	it('honors explicit override above plan limit', () => {
		assert.equal(seatsForAdminPlanAssignment(PLANS.starter, {
			adminOverrideSeats: 10,
			activeMemberCount: 1,
		}), 10);
	});

	it('floors override below active member count (no destructive limit)', () => {
		assert.equal(seatsForAdminPlanAssignment(PLANS.starter, {
			adminOverrideSeats: 2,
			activeMemberCount: 4,
		}), 4);
	});
});

describe('seatsForReconciliation / reconcileSubscriptionSeats', () => {
	it('reconciles stale Pro subscription seats to 5', () => {
		assert.equal(seatsForReconciliation(PLANS.pro, { currentSeats: 1 }), 5);
	});

	it('does not preserve stale seats above plan limit by default', () => {
		assert.equal(seatsForReconciliation(PLANS.starter, { currentSeats: 10 }), 2);
	});

	it('missing plan returns null (no destructive change)', () => {
		assert.equal(seatsForReconciliation(null, { currentSeats: 5 }), null);
	});

	it('reconcileSubscriptionSeats skips when plan cannot be resolved', async () => {
		const result = await reconcileSubscriptionSeatsTest(
			{ id: 'sub1', workspace_key: 'ws-1', seats: 5, plan: 'missing' },
			{
				client: {},
				loadPlanFn: async () => null,
			},
		);
		assert.equal(result.skipped, true);
		assert.equal(result.reason, 'plan_not_resolved');
	});

	it('reconcileSubscriptionSeats updates stale seats without touching members', async () => {
		const updates = [];
		const result = await reconcileSubscriptionSeatsTest(
			{ id: 'sub1', workspace_key: 'ws-pro', seats: 1, plan: 'pro-id' },
			{
				client: {
					collection: () => ({
						update: async (id, patch) => {
							updates.push({ id, patch });
							return { id, ...patch };
						},
					}),
				},
				loadPlanFn: async () => PLANS.pro,
			},
		);
		assert.equal(result.updated, true);
		assert.equal(result.seats, 5);
		assert.equal(updates[0].patch.seats, 5);
		assert.equal(updates[0].patch.members, undefined);
	});
});

describe('assertSeatAvailable remains unchanged', () => {
	it('workspace-members.js does not import plan-seats', () => {
		const membersPath = path.join(here, '../workspace-members.js');
		const src = readFileSync(membersPath, 'utf8');
		assert.doesNotMatch(src, /plan-seats/);
		assert.match(src, /async function assertSeatAvailable/);
		assert.match(src, /async function countActiveSeats/);
	});
});

describe('subscriptions.js activation paths set seats from plan', () => {
	it('activatePaddleSubscription patch includes seatsForPlanAssignment', () => {
		const src = readFileSync(path.join(here, 'subscriptions.js'), 'utf8');
		assert.match(src, /seats: seatsForPlanAssignment\(plan\)/);
		assert.match(src, /activatePaddleSubscription/);
	});
});

describe('immediate cancellation → Free sets seats = 1', () => {
	it('PayPal immediate cancellation patch includes seatsForPlanAssignment(free)', () => {
		const src = readFileSync(path.join(here, 'subscriptions.js'), 'utf8');
		const paypalBlock = src.slice(
			src.indexOf('export async function handlePayPalCancellation'),
			src.indexOf('export async function', src.indexOf('export async function handlePayPalCancellation') + 1),
		);
		assert.match(paypalBlock, /handlePayPalCancellation/);
		assert.match(paypalBlock, /\.\.\.\(free \? \{ seats: seatsForPlanAssignment\(free\) \} : \{\}\)/);
		assert.equal(seatsForPlanAssignment(PLANS.free), 1);
	});

	it('generic immediate cancellation patch includes seatsForPlanAssignment(free)', () => {
		const src = readFileSync(path.join(here, 'subscription-cancel.js'), 'utf8');
		const fnBlock = src.slice(
			src.indexOf('async function applyImmediateCancellationUpdate'),
			src.indexOf('async function defaultLoadSubscription'),
		);
		assert.match(fnBlock, /applyImmediateCancellationUpdate/);
		assert.match(fnBlock, /\.\.\.\(free \? \{ seats: seatsForPlanAssignment\(free\) \} : \{\}\)/);
		assert.equal(seatsForPlanAssignment(PLANS.free), 1);
	});
});
