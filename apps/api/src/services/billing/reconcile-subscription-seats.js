/**
 * One-time / batch reconciliation of workspace_subscriptions.seats from plans.limits.teamMembers.
 * Never deletes or suspends workspace members.
 */
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { seatsForReconciliation } from './plan-seats.js';

async function loadPlan(planIdOrSlug, pb = pocketbaseClient) {
	if (!planIdOrSlug) return null;
	const byId = await pb.collection('plans').getOne(planIdOrSlug).catch(() => null);
	if (byId) return byId;
	return pb.collection('plans').getFirstListItem(
		pb.filter('slug = {:slug}', { slug: String(planIdOrSlug) }),
		{ requestKey: null },
	).catch(() => null);
}

/**
 * Reconcile seats for a single subscription record.
 * @param {object} subscription
 * @param {{ client?: object, loadPlanFn?: Function }} [deps]
 */
export async function reconcileSubscriptionSeats(subscription, deps = {}) {
	const pb = deps.client || pocketbaseClient;
	const resolvePlan = deps.loadPlanFn || loadPlan;
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

	const nextSeats = seatsForReconciliation(plan, {
		currentSeats: subscription.seats,
	});
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

	const updated = await pb.collection('workspace_subscriptions').update(subscription.id, {
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

/**
 * Batch reconcile all workspace subscriptions (idempotent).
 * @param {{ dryRun?: boolean, client?: object, loadPlanFn?: Function }} [options]
 */
export async function reconcileAllSubscriptionSeats(options = {}) {
	const pb = options.client || pocketbaseClient;
	const dryRun = Boolean(options.dryRun);
	const subscriptions = await pb.collection('workspace_subscriptions').getFullList({
		requestKey: null,
	}).catch(() => []);

	const summary = {
		total: subscriptions.length,
		updated: 0,
		skipped: 0,
		errors: 0,
		dryRun,
		items: [],
	};

	for (const subscription of subscriptions) {
		try {
			if (dryRun) {
				const resolvePlan = options.loadPlanFn || loadPlan;
				const plan = await resolvePlan(subscription.plan);
				if (!plan) {
					summary.skipped += 1;
					summary.items.push({
						workspaceKey: subscription.workspace_key,
						skipped: true,
						reason: 'plan_not_resolved',
					});
					continue;
				}
				const nextSeats = seatsForReconciliation(plan, { currentSeats: subscription.seats });
				const previous = Number(subscription.seats) || 1;
				if (previous === nextSeats) {
					summary.skipped += 1;
				} else {
					summary.updated += 1;
					summary.items.push({
						workspaceKey: subscription.workspace_key,
						wouldUpdate: true,
						previousSeats: previous,
						seats: nextSeats,
					});
				}
				continue;
			}

			const result = await reconcileSubscriptionSeats(subscription, {
				client: pb,
				loadPlanFn: options.loadPlanFn,
			});
			if (result.updated) {
				summary.updated += 1;
				summary.items.push(result);
			} else {
				summary.skipped += 1;
			}
		} catch (error) {
			summary.errors += 1;
			summary.items.push({
				workspaceKey: subscription.workspace_key,
				error: error?.message || String(error),
			});
		}
	}

	return summary;
}
