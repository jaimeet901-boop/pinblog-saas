import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import {
	resetMonthlyCredits,
	ensureWorkspaceWallet,
	getWallet,
} from '../credits-engine.js';
import { resolveBillingConfig, getBillingProvider } from './providers/index.js';
import { logBillingAction } from './audit.js';
import { claimIdempotencyKey, completeIdempotency, failIdempotency } from './idempotency.js';
import {
	clearCreditThresholdFlags,
	notifyCreditsReset,
	notifyPaymentFailed,
	notifyPlanDowngraded,
	notifyPlanUpgraded,
	notifySubscriptionEnding,
	notifyTrialEnding,
} from './notifications.js';

function daysBetween(from, to = new Date()) {
	const a = new Date(from).getTime();
	const b = new Date(to).getTime();
	if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
	return Math.ceil((a - b) / 86400000);
}

async function loadSubscription(workspaceKey) {
	return pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
		pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
}

async function loadPlan(planIdOrSlug) {
	if (!planIdOrSlug) return null;
	const byId = await pocketbaseClient.collection('plans').getOne(planIdOrSlug).catch(() => null);
	if (byId) return byId;
	return pocketbaseClient.collection('plans').getFirstListItem(
		pocketbaseClient.filter('slug = {:slug}', { slug: String(planIdOrSlug) }),
		{ requestKey: null },
	).catch(() => null);
}

/**
 * Automatic renewal: advance period and optionally reset monthly credits.
 */
export async function renewSubscription(workspaceKey, { actor = 'scheduler', force = false } = {}) {
	const subscription = await loadSubscription(workspaceKey);
	if (!subscription) throw httpError(404, 'Subscription not found', 'NOT_FOUND');

	const config = await resolveBillingConfig();
	const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
	const now = new Date();
	if (!force && periodEnd && periodEnd.getTime() > now.getTime()) {
		return { skipped: true, reason: 'period_not_ended', periodEnd: subscription.current_period_end };
	}
	if (subscription.status === 'canceled' && !subscription.cancel_at_period_end) {
		return { skipped: true, reason: 'canceled' };
	}

	const idem = await claimIdempotencyKey({
		idempotencyKey: `renew:${workspaceKey}:${subscription.current_period_end || 'none'}`,
		scope: 'renewal',
		workspaceKey,
		eventType: 'renewed',
	});
	if (idem.duplicate) {
		return { skipped: true, reason: 'duplicate', result: idem.result };
	}

	try {
		const start = now;
		const end = new Date(now);
		end.setMonth(end.getMonth() + 1);

		// Apply pending plan change on renewal (upgrade/downgrade).
		let planId = subscription.plan;
		let fromPlan = subscription.expand?.plan?.slug || '';
		let toPlan = fromPlan;
		if (subscription.pending_plan) {
			const pending = await loadPlan(subscription.pending_plan);
			if (pending) {
				planId = pending.id;
				toPlan = pending.slug;
			}
		}

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			status: 'active',
			billing_status: 'active',
			plan: planId,
			pending_plan: '',
			cancel_at_period_end: false,
			current_period_start: start.toISOString(),
			current_period_end: end.toISOString(),
			grace_period_ends_at: null,
			last_payment_status: 'succeeded',
			last_payment_at: now.toISOString(),
		});

		let resetResult = null;
		if (config.autoResetCredits) {
			resetResult = await resetMonthlyCredits({ workspaceKey, actor, force: true });
			await clearCreditThresholdFlags(subscription.id);
			await notifyCreditsReset(subscription, resetResult?.balance);
		}

		const result = {
			renewed: true,
			workspaceKey,
			periodStart: start.toISOString(),
			periodEnd: end.toISOString(),
			fromPlan,
			toPlan,
			reset: resetResult,
		};

		await logBillingAction({
			action: 'Subscription renewed',
			eventType: 'renewed',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			fromPlan,
			toPlan,
			message: `Renewed through ${end.toISOString().slice(0, 10)}`,
			metadata: result,
		});

		await completeIdempotency(idem.record.id, result);
		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}

/**
 * Schedule or apply plan upgrade (immediate when rules allow / provider none).
 */
export async function upgradeSubscription(workspaceKey, planSlugOrId, { actor = 'system', immediate = true } = {}) {
	const subscription = await ensureWorkspaceWallet(workspaceKey);
	const nextPlan = await loadPlan(planSlugOrId);
	if (!nextPlan) throw httpError(404, 'Target plan not found', 'PLAN_NOT_FOUND');

	const fromPlan = subscription.expand?.plan?.slug
		|| (await loadPlan(subscription.plan))?.slug
		|| '';
	const provider = await getBillingProvider();
	const remote = await provider.changeSubscriptionPlan({
		workspaceKey,
		fromPlan,
		toPlan: nextPlan.slug,
		providerSubscriptionId: subscription.provider_subscription_id,
	}).catch((error) => ({ ready: false, error: error?.message || String(error), localOnly: true }));

	if (immediate || remote.localOnly !== false) {
		const now = new Date();
		const end = new Date(subscription.current_period_end || now);
		const keepCredits = nextPlan.upgrade_rules?.keepUnusedCredits !== false;
		const currentBalance = Number(subscription.credits_balance) || 0;
		const nextCredits = keepCredits
			? Math.max(currentBalance, Number(nextPlan.credits) || 0)
			: Number(nextPlan.credits) || 0;

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			plan: nextPlan.id,
			pending_plan: '',
			status: subscription.status === 'trialing' ? 'active' : (subscription.status || 'active'),
			billing_status: 'active',
			credits_balance: nextCredits,
			provider: provider.code,
		});

		await logBillingAction({
			action: 'Subscription upgraded',
			eventType: 'upgrade',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			fromPlan,
			toPlan: nextPlan.slug,
			credits: nextCredits,
			provider: provider.code,
			metadata: { remote, immediate: true },
		});
		await notifyPlanUpgraded(
			{ ...subscription, credits_balance: nextCredits, plan: nextPlan.id },
			fromPlan,
			nextPlan.slug,
		).catch(() => null);
		return { upgraded: true, immediate: true, fromPlan, toPlan: nextPlan.slug, remote };
	}

	await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
		pending_plan: nextPlan.id,
	});
	await logBillingAction({
		action: 'Upgrade scheduled',
		eventType: 'upgrade',
		workspaceKey,
		workspaceName: subscription.workspace_name,
		actor,
		fromPlan,
		toPlan: nextPlan.slug,
		message: 'Upgrade scheduled for period end',
		metadata: { scheduled: true },
	});
	return { upgraded: false, scheduled: true, fromPlan, toPlan: nextPlan.slug };
}

/**
 * Schedule downgrade for period end (default) or apply immediately.
 */
export async function downgradeSubscription(workspaceKey, planSlugOrId, { actor = 'system', atPeriodEnd = true } = {}) {
	const subscription = await loadSubscription(workspaceKey);
	if (!subscription) throw httpError(404, 'Subscription not found', 'NOT_FOUND');
	const nextPlan = await loadPlan(planSlugOrId);
	if (!nextPlan) throw httpError(404, 'Target plan not found', 'PLAN_NOT_FOUND');
	const fromPlan = subscription.expand?.plan?.slug || '';

	if (atPeriodEnd || nextPlan.downgrade_rules?.atPeriodEnd !== false) {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			pending_plan: nextPlan.id,
			cancel_at_period_end: false,
		});
		await logBillingAction({
			action: 'Downgrade scheduled',
			eventType: 'downgrade',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			fromPlan,
			toPlan: nextPlan.slug,
			message: 'Downgrade scheduled for period end',
		});
		return { downgraded: false, scheduled: true, fromPlan, toPlan: nextPlan.slug };
	}

	const clamp = nextPlan.downgrade_rules?.clampToNewQuota !== false;
	const nextQuota = Number(nextPlan.credits) || 0;
	const purchased = Number(subscription.purchased_credits) || 0;
	const balance = clamp
		? Math.min(Number(subscription.credits_balance) || 0, nextQuota + purchased)
		: Number(subscription.credits_balance) || 0;

	await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
		plan: nextPlan.id,
		pending_plan: '',
		credits_balance: balance,
	});
	await logBillingAction({
		action: 'Subscription downgraded',
		eventType: 'downgrade',
		workspaceKey,
		workspaceName: subscription.workspace_name,
		actor,
		fromPlan,
		toPlan: nextPlan.slug,
		credits: balance,
	});
	await notifyPlanDowngraded(
		{ ...subscription, credits_balance: balance, plan: nextPlan.id },
		fromPlan,
		nextPlan.slug,
	).catch(() => null);
	return { downgraded: true, immediate: true, fromPlan, toPlan: nextPlan.slug, balance };
}

export async function expireTrial(workspaceKey, { actor = 'scheduler' } = {}) {
	const subscription = await loadSubscription(workspaceKey);
	if (!subscription || subscription.status !== 'trialing') {
		return { skipped: true, reason: 'not_trialing' };
	}
	const trialEnd = subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
	if (trialEnd && trialEnd.getTime() > Date.now()) {
		return { skipped: true, reason: 'trial_active', trialEndsAt: subscription.trial_ends_at };
	}

	const free = await loadPlan('free');
	await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
		status: 'canceled',
		billing_status: 'trial_expired',
		plan: free?.id || subscription.plan,
		pending_plan: '',
	});
	await logBillingAction({
		action: 'Trial expired',
		eventType: 'trial_end',
		workspaceKey,
		workspaceName: subscription.workspace_name,
		actor,
		toPlan: free?.slug || 'free',
		severity: 'warn',
	});
	return { expired: true, workspaceKey };
}

export async function startGracePeriod(workspaceKey, { actor = 'scheduler', reason = 'payment_failed' } = {}) {
	const subscription = await loadSubscription(workspaceKey);
	if (!subscription) return { skipped: true };
	const config = await resolveBillingConfig();
	const ends = new Date();
	ends.setDate(ends.getDate() + config.gracePeriodDays);

	await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
		status: 'past_due',
		billing_status: 'grace',
		grace_period_ends_at: ends.toISOString(),
		last_payment_status: 'failed',
	});
	await notifyPaymentFailed(subscription, reason);
	await logBillingAction({
		action: 'Grace period started',
		eventType: 'grace_start',
		workspaceKey,
		workspaceName: subscription.workspace_name,
		actor,
		severity: 'warn',
		message: reason,
		metadata: { gracePeriodEndsAt: ends.toISOString() },
	});
	return { grace: true, endsAt: ends.toISOString() };
}

export async function expireSubscription(workspaceKey, { actor = 'scheduler' } = {}) {
	const subscription = await loadSubscription(workspaceKey);
	if (!subscription) return { skipped: true };

	const graceEnd = subscription.grace_period_ends_at ? new Date(subscription.grace_period_ends_at).getTime() : 0;
	const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end).getTime() : 0;
	const now = Date.now();
	const pastGrace = graceEnd && graceEnd <= now;
	const pastPeriod = periodEnd && periodEnd <= now && (subscription.cancel_at_period_end || subscription.status === 'past_due');

	if (!pastGrace && !pastPeriod && subscription.status !== 'past_due') {
		return { skipped: true, reason: 'still_valid' };
	}

	const free = await loadPlan('free');
	await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
		status: 'canceled',
		billing_status: 'expired',
		plan: free?.id || subscription.plan,
		pending_plan: '',
		grace_period_ends_at: null,
		cancel_at_period_end: false,
	});
	await logBillingAction({
		action: 'Subscription expired',
		eventType: 'cancelled',
		workspaceKey,
		workspaceName: subscription.workspace_name,
		actor,
		severity: 'warn',
		toPlan: free?.slug || 'free',
	});
	return { expired: true, workspaceKey };
}

export async function handleFailedPayment(workspaceKey, { actor = 'webhook', reason = 'Payment failed', idempotencyKey = '' } = {}) {
	const key = idempotencyKey || `payment_failed:${workspaceKey}:${new Date().toISOString().slice(0, 13)}`;
	const idem = await claimIdempotencyKey({
		idempotencyKey: key,
		scope: 'payment_failed',
		workspaceKey,
		eventType: 'payment_failed',
	});
	if (idem.duplicate) return { duplicate: true, result: idem.result };

	try {
		const result = await startGracePeriod(workspaceKey, { actor, reason });
		await completeIdempotency(idem.record.id, result);
		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}

export async function cancelSubscription(workspaceKey, { actor = 'user', atPeriodEnd = true } = {}) {
	const subscription = await loadSubscription(workspaceKey);
	if (!subscription) throw httpError(404, 'Subscription not found', 'NOT_FOUND');
	const provider = await getBillingProvider();
	await provider.cancelSubscription({
		workspaceKey,
		providerSubscriptionId: subscription.provider_subscription_id,
		atPeriodEnd,
	}).catch(() => null);

	if (atPeriodEnd) {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			cancel_at_period_end: true,
			billing_status: 'cancel_scheduled',
		});
	} else {
		const free = await loadPlan('free');
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			status: 'canceled',
			billing_status: 'canceled',
			cancel_at_period_end: false,
			plan: free?.id || subscription.plan,
		});
	}

	await logBillingAction({
		action: atPeriodEnd ? 'Cancellation scheduled' : 'Subscription cancelled',
		eventType: 'cancelled',
		workspaceKey,
		workspaceName: subscription.workspace_name,
		actor,
		provider: provider.code,
	});
	return { cancelled: true, atPeriodEnd };
}

/**
 * Scan all subscriptions for trial/period ending notifications and lifecycle actions.
 */
export async function processSubscriptionLifecycleBatch({ limit = 200 } = {}) {
	const config = await resolveBillingConfig();
	const subscriptions = await pocketbaseClient.collection('workspace_subscriptions').getList(1, limit, {
		expand: 'plan',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	const summary = {
		renewed: 0,
		trialsExpired: 0,
		subscriptionsExpired: 0,
		notified: 0,
		skipped: 0,
		errors: 0,
	};

	for (const sub of subscriptions.items || []) {
		try {
			const workspaceKey = sub.workspace_key;
			if (sub.status === 'trialing') {
				const daysLeft = daysBetween(sub.trial_ends_at);
				if (daysLeft != null && daysLeft <= 3 && daysLeft >= 0) {
					await notifyTrialEnding(sub, daysLeft);
					summary.notified += 1;
				}
				if (daysLeft != null && daysLeft < 0) {
					await expireTrial(workspaceKey);
					summary.trialsExpired += 1;
					continue;
				}
			}

			const periodDaysLeft = daysBetween(sub.current_period_end);
			if (periodDaysLeft != null && periodDaysLeft <= 3 && periodDaysLeft >= 0 && sub.status === 'active') {
				await notifySubscriptionEnding(sub, periodDaysLeft);
				summary.notified += 1;
			}

			if (config.autoRenew && periodDaysLeft != null && periodDaysLeft < 0 && ['active', 'trialing'].includes(sub.status) && !sub.cancel_at_period_end) {
				await renewSubscription(workspaceKey, { actor: 'scheduler' });
				summary.renewed += 1;
				continue;
			}

			if (sub.status === 'past_due' || sub.cancel_at_period_end) {
				const result = await expireSubscription(workspaceKey, { actor: 'scheduler' });
				if (result.expired) summary.subscriptionsExpired += 1;
				else summary.skipped += 1;
				continue;
			}

			summary.skipped += 1;
		} catch {
			summary.errors += 1;
		}
	}

	return summary;
}

export async function getSubscriptionSnapshot(workspaceKey) {
	const subscription = await loadSubscription(workspaceKey);
	if (!subscription) return null;
	const wallet = await getWallet(workspaceKey).catch(() => null);
	return {
		workspaceKey,
		status: subscription.status,
		billingStatus: subscription.billing_status || subscription.status,
		planSlug: subscription.expand?.plan?.slug || '',
		periodEnd: subscription.current_period_end,
		trialEndsAt: subscription.trial_ends_at,
		gracePeriodEndsAt: subscription.grace_period_ends_at,
		cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
		pendingPlan: subscription.pending_plan || '',
		provider: subscription.provider || 'none',
		wallet,
	};
}
