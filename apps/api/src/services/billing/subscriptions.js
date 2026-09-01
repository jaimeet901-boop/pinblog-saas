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
import { syncEntitlementMirrors } from './entitlement-sync.js';
import { validateBillingSource } from './billing-model.js';
import { resolveLocalRenewalSkipReason } from './provider-managed-subscription.js';
import { cancelPreviousPaddleSubscriptionAfterRotation } from './paddle-previous-subscription-cleanup.js';
import { maybeSendSubscriptionWelcomeEmail } from '../email/subscription-welcome-mail.js';
import { seatsForPlanAssignment } from './plan-seats.js';

export { cancelPreviousPaddleSubscriptionAfterRotation } from './paddle-previous-subscription-cleanup.js';

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
	const now = new Date();
	const skipReason = resolveLocalRenewalSkipReason(subscription, { force, now });
	if (skipReason) {
		const skipped = { skipped: true, reason: skipReason };
		if (skipReason === 'period_not_ended') {
			skipped.periodEnd = subscription.current_period_end;
		}
		return skipped;
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
		let pendingPlanRecord = null;
		if (subscription.pending_plan) {
			const pending = await loadPlan(subscription.pending_plan);
			if (pending) {
				pendingPlanRecord = pending;
				planId = pending.id;
				toPlan = pending.slug;
			}
		}

		const renewalPatch = {
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
		};
		if (pendingPlanRecord) {
			renewalPatch.seats = seatsForPlanAssignment(pendingPlanRecord);
		}

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, renewalPatch);

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
 *
 * Phase 3.7 — INTERNAL ONLY. Not exposed over HTTP.
 * - Workspace paid upgrades: checkout + verified webhook fulfillment.
 * - Free plan changes: changeWorkspacePlan() via POST /subscription/change.
 * - Admin/support overrides: assignWorkspacePlan() via POST /admin/plans/assign.
 *
 * WARNING: Default `immediate=true` and provider stubs omit `localOnly:false`, so calling
 * this on a paid provider-managed workspace applies a local entitlement write without
 * remote payment confirmation. Do not wire to user-facing routes until provider adapters
 * return confirmed remote plan changes and this function fail-closes otherwise.
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
			seats: seatsForPlanAssignment(nextPlan),
			provider: provider.code,
		});

		await syncEntitlementMirrors({
			workspaceKey,
			plan: nextPlan,
			subscriptionId: subscription.id,
			actor,
			source: 'system',
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
		seats: seatsForPlanAssignment(nextPlan),
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
		...(free ? { seats: seatsForPlanAssignment(free) } : {}),
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
		billing_status: subscription.billing_status === 'refund_pending' ? 'refunded' : 'expired',
		plan: free?.id || subscription.plan,
		pending_plan: '',
		grace_period_ends_at: null,
		cancel_at_period_end: false,
		...(free ? { seats: seatsForPlanAssignment(free) } : {}),
	});
	if (free) {
		await syncEntitlementMirrors({
			workspaceKey,
			plan: free,
			subscriptionId: subscription.id,
			actor,
			source: 'scheduler',
		});
	}
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

export { cancelSubscription } from './subscription-cancel.js';

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
				const result = await renewSubscription(workspaceKey, { actor: 'scheduler' });
				if (result?.renewed) {
					summary.renewed += 1;
				} else {
					summary.skipped += 1;
				}
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

/**
 * Activate a paid plan only after a verified provider webhook confirms payment.
 * Idempotent — safe to retry on duplicate webhook delivery.
 */
export async function fulfillSubscriptionPurchase({
	workspaceKey,
	planSlug,
	planId = '',
	provider = '',
	idempotencyKey = '',
	paymentRef = '',
	actor = 'webhook',
} = {}) {
	if (!workspaceKey) throw httpError(422, 'workspaceKey is required', 'VALIDATION_ERROR');
	const plan = await loadPlan(planId || planSlug);
	if (!plan) throw httpError(404, 'Plan not found', 'PLAN_NOT_FOUND');

	const key = String(idempotencyKey || `sub-fulfill:${workspaceKey}:${plan.slug}:${paymentRef || 'none'}`).slice(0, 180);
	const idem = await claimIdempotencyKey({
		idempotencyKey: key,
		scope: 'subscription_fulfill',
		workspaceKey,
		provider,
		eventType: 'subscription_activated',
		payload: { planSlug: plan.slug, paymentRef },
	});
	if (idem.duplicate) {
		return { duplicate: true, fulfilled: true, result: idem.result };
	}

	try {
		const subscription = await ensureWorkspaceWallet(workspaceKey);
		const fromPlan = subscription.expand?.plan?.slug
			|| (await loadPlan(subscription.plan))?.slug
			|| '';

		const now = new Date();
		const end = new Date(now);
		end.setMonth(end.getMonth() + 1);

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			plan: plan.id,
			status: 'active',
			billing_status: 'active',
			pending_plan: '',
			credits_balance: Number(plan.credits) || 0,
			seats: seatsForPlanAssignment(plan),
			current_period_start: now.toISOString(),
			current_period_end: end.toISOString(),
			provider: provider || subscription.provider || 'none',
			provider_subscription_id: paymentRef ? String(paymentRef).slice(0, 180) : (subscription.provider_subscription_id || ''),
			grace_period_ends_at: null,
		});

		await syncEntitlementMirrors({
			workspaceKey,
			plan,
			subscriptionId: subscription.id,
			actor,
			source: validateBillingSource(provider).ok && provider ? provider : 'system',
		});

		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceKey,
			amount: Number(plan.credits) || 0,
			type: 'grant',
			reason: `Paid subscription activated (${plan.name})`,
			balance: Number(plan.credits) || 0,
			created_by: actor,
			idempotency_key: key,
			reference_id: paymentRef || '',
			metadata: { provider, planSlug: plan.slug },
		}).catch(() => null);

		await logBillingAction({
			action: 'Subscription activated after payment',
			eventType: 'upgrade',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			fromPlan,
			toPlan: plan.slug,
			credits: Number(plan.credits) || 0,
			provider,
			idempotencyKey: key,
			metadata: { paymentRef },
		});

		await notifyPlanUpgraded(
			{ ...subscription, credits_balance: Number(plan.credits) || 0, plan: plan.id },
			fromPlan,
			plan.slug,
		).catch(() => null);

		const result = {
			fulfilled: true,
			workspaceKey,
			fromPlan,
			toPlan: plan.slug,
			provider,
			paymentRef: paymentRef || '',
		};
		await completeIdempotency(idem.record.id, result);
		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}

function computeInitialActivationCredits(subscription, plan) {
	const purchased = Number(subscription?.purchased_credits) || 0;
	const monthly = Number(plan?.credits) || 0;
	return monthly + purchased;
}

function buildPaddleSubscriptionPatch(verified, eventId) {
	const nowIso = new Date().toISOString();
	return {
		paddle_customer_id: verified.customerId || '',
		paddle_subscription_id: verified.subscriptionId || '',
		paddle_transaction_id: verified.transactionId || '',
		paddle_price_id: verified.priceId || '',
		billing_interval: verified.interval || '',
		billing_environment: verified.environment || '',
		activation_source: 'paddle_webhook',
		billing_source: 'paddle',
		last_webhook_event_id: String(eventId || '').slice(0, 180),
		last_verified_at: nowIso,
		provider: 'paddle',
		provider_subscription_id: verified.subscriptionId
			? String(verified.subscriptionId).slice(0, 180)
			: '',
	};
}

export async function activatePaddleSubscription({
	workspaceKey,
	verified = {},
	eventId = '',
	idempotencyKey = '',
	actor = 'webhook:paddle',
	previousSubscriptionId = '',
	cancelPreviousSubscription = null,
} = {}) {
	const plan = await loadPlan(verified.planId || verified.planSlug);
	if (!plan) throw httpError(404, 'Plan not found', 'PLAN_NOT_FOUND');

	const key = String(
		idempotencyKey || `sub-fulfill:paddle-txn:${verified.transactionId || 'unknown'}`,
	).slice(0, 180);

	const idem = await claimIdempotencyKey({
		idempotencyKey: key,
		scope: 'paddle_activation',
		workspaceKey,
		provider: 'paddle',
		eventType: 'paddle_subscription_activated',
		payload: { transactionId: verified.transactionId, subscriptionId: verified.subscriptionId },
	});
	if (idem.duplicate) {
		return { duplicate: true, fulfilled: true, activated: false, result: idem.result };
	}

	try {
		const subscription = await ensureWorkspaceWallet(workspaceKey);
		const fromPlan = subscription.expand?.plan?.slug
			|| (await loadPlan(subscription.plan))?.slug
			|| '';

		const capturedPreviousSubscriptionId = String(
			previousSubscriptionId
			|| verified.previousSubscriptionId
			|| '',
		).trim();

		const now = new Date();
		const end = new Date(now);
		if (verified.interval === 'yearly') {
			end.setFullYear(end.getFullYear() + 1);
		} else {
			end.setMonth(end.getMonth() + 1);
		}

		const creditsBalance = computeInitialActivationCredits(subscription, plan);

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			plan: plan.id,
			status: 'active',
			billing_status: 'active',
			pending_plan: '',
			credits_balance: creditsBalance,
			seats: seatsForPlanAssignment(plan),
			current_period_start: now.toISOString(),
			current_period_end: end.toISOString(),
			grace_period_ends_at: null,
			cancel_at_period_end: false,
			last_payment_status: 'succeeded',
			last_payment_at: now.toISOString(),
			...buildPaddleSubscriptionPatch(verified, eventId),
		});

		await syncEntitlementMirrors({
			workspaceKey,
			plan,
			subscriptionId: subscription.id,
			actor,
			source: 'paddle_webhook',
		});

		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceKey,
			amount: Number(plan.credits) || 0,
			type: 'grant',
			reason: `Paddle subscription activated (${plan.name})`,
			balance: creditsBalance,
			created_by: actor,
			idempotency_key: key,
			reference_id: verified.transactionId || '',
			metadata: {
				provider: 'paddle',
				planSlug: plan.slug,
				subscriptionId: verified.subscriptionId || '',
				priceId: verified.priceId || '',
				environment: verified.environment || '',
			},
		}).catch(() => null);

		const previousSubscriptionCleanup = await cancelPreviousPaddleSubscriptionAfterRotation({
			previousSubscriptionId: capturedPreviousSubscriptionId,
			newSubscriptionId: verified.subscriptionId || '',
			workspaceKey,
			actor,
			cancelPreviousSubscription,
		});

		const result = {
			fulfilled: true,
			activated: true,
			kind: verified.subscriptionIdRotated ? 'plan_change' : 'activation',
			workspaceKey,
			fromPlan,
			toPlan: plan.slug,
			provider: 'paddle',
			transactionId: verified.transactionId || '',
			subscriptionId: verified.subscriptionId || '',
			creditsBalance,
			subscriptionIdRotated: Boolean(verified.subscriptionIdRotated),
			previousSubscriptionCleanup,
		};

		await logBillingAction({
			action: 'Paddle subscription activated after API verification',
			eventType: 'upgrade',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			fromPlan,
			toPlan: plan.slug,
			credits: Number(plan.credits) || 0,
			provider: 'paddle',
			idempotencyKey: key,
			metadata: result,
		});

		await notifyPlanUpgraded(
			{ ...subscription, credits_balance: creditsBalance, plan: plan.id },
			fromPlan,
			plan.slug,
		).catch(() => null);

		await completeIdempotency(idem.record.id, result);

		// Best-effort transactional email — never blocks or rolls back activation.
		await maybeSendSubscriptionWelcomeEmail({
			kind: result.kind,
			activated: true,
			duplicate: false,
			subscription: {
				...subscription,
				owner_email: subscription.owner_email || '',
				workspace_key: workspaceKey,
				credits_balance: creditsBalance,
				plan: plan.id,
			},
			plan,
			verified,
			workspaceKey,
			transactionId: verified.transactionId || '',
			activationDate: now,
		}).catch(() => null);

		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}

export async function renewPaddleSubscription({
	workspaceKey,
	verified = {},
	eventId = '',
	idempotencyKey = '',
	actor = 'webhook:paddle',
} = {}) {
	const key = String(
		idempotencyKey || `paddle-renew:${verified.transactionId || workspaceKey}`,
	).slice(0, 180);

	const idem = await claimIdempotencyKey({
		idempotencyKey: key,
		scope: 'paddle_renewal',
		workspaceKey,
		provider: 'paddle',
		eventType: 'paddle_subscription_renewed',
		payload: { transactionId: verified.transactionId, subscriptionId: verified.subscriptionId },
	});
	if (idem.duplicate) {
		return { duplicate: true, renewed: true, result: idem.result };
	}

	try {
		const subscription = await loadSubscription(workspaceKey);
		if (!subscription) throw httpError(404, 'Subscription not found', 'NOT_FOUND');

		const now = new Date();
		const end = new Date(now);
		if (verified.interval === 'yearly') {
			end.setFullYear(end.getFullYear() + 1);
		} else {
			end.setMonth(end.getMonth() + 1);
		}

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			status: 'active',
			billing_status: 'active',
			current_period_start: now.toISOString(),
			current_period_end: end.toISOString(),
			grace_period_ends_at: null,
			last_payment_status: 'succeeded',
			last_payment_at: now.toISOString(),
			paddle_transaction_id: verified.transactionId || subscription.paddle_transaction_id || '',
			paddle_price_id: verified.priceId || subscription.paddle_price_id || '',
			billing_interval: verified.interval || subscription.billing_interval || '',
			billing_environment: verified.environment || subscription.billing_environment || '',
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
		});

		const config = await resolveBillingConfig();
		let resetResult = null;
		if (config.autoResetCredits) {
			resetResult = await resetMonthlyCredits({ workspaceKey, actor, force: true });
			await clearCreditThresholdFlags(subscription.id);
			await notifyCreditsReset(subscription, resetResult?.balance);
		}

		const result = {
			renewed: true,
			kind: 'renewal',
			workspaceKey,
			periodStart: now.toISOString(),
			periodEnd: end.toISOString(),
			transactionId: verified.transactionId || '',
			reset: resetResult,
		};

		await logBillingAction({
			action: 'Paddle subscription renewed after API verification',
			eventType: 'renewed',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			provider: 'paddle',
			idempotencyKey: key,
			metadata: result,
		});

		await completeIdempotency(idem.record.id, result);
		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}

export async function handlePaddleCancellation({
	workspaceKey = '',
	paddleSubscriptionId = '',
	cancelAtPeriodEnd = true,
	eventId = '',
	actor = 'webhook:paddle',
	reason = 'paddle_subscription_canceled',
} = {}) {
	let subscription = null;
	if (workspaceKey) {
		subscription = await loadSubscription(workspaceKey);
	} else if (paddleSubscriptionId) {
		subscription = await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('paddle_subscription_id = {:id}', { id: paddleSubscriptionId }),
			{ requestKey: null },
		).catch(() => null);
	}

	if (!subscription) {
		return { handled: false, activated: false, error: 'paddle_subscription_not_found' };
	}

	if (paddleSubscriptionId && subscription.paddle_subscription_id
		&& subscription.paddle_subscription_id !== paddleSubscriptionId) {
		return { handled: false, activated: false, error: 'paddle_subscription_identity_mismatch' };
	}

	const resolvedWorkspaceKey = subscription.workspace_key;

	if (cancelAtPeriodEnd) {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			cancel_at_period_end: true,
			billing_status: 'cancel_scheduled',
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
		});
	} else {
		const free = await loadPlan('free');
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			status: 'canceled',
			billing_status: 'canceled',
			cancel_at_period_end: false,
			plan: free?.id || subscription.plan,
			...(free ? { seats: seatsForPlanAssignment(free) } : {}),
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
		});
		if (free) {
			await syncEntitlementMirrors({
				workspaceKey: resolvedWorkspaceKey,
				plan: free,
				subscriptionId: subscription.id,
				actor,
				source: 'paddle_webhook',
			});
		}
	}

	await logBillingAction({
		action: cancelAtPeriodEnd ? 'Paddle cancellation scheduled' : 'Paddle subscription canceled',
		eventType: 'cancelled',
		workspaceKey: resolvedWorkspaceKey,
		workspaceName: subscription.workspace_name,
		actor,
		provider: 'paddle',
		message: reason,
		metadata: { paddleSubscriptionId, cancelAtPeriodEnd, eventId },
	});

	return {
		handled: true,
		activated: false,
		cancelled: true,
		atPeriodEnd: cancelAtPeriodEnd,
		workspaceKey: resolvedWorkspaceKey,
	};
}

export async function handlePaddlePaymentFailure({
	workspaceKey,
	eventId = '',
	transactionId = '',
	subscriptionId = '',
	reason = 'paddle_payment_failed',
	actor = 'webhook:paddle',
	idempotencyKey = '',
} = {}) {
	if (!workspaceKey) {
		return { handled: true, activated: false, ignored: true, reason: 'payment_failed_without_workspace' };
	}

	const key = idempotencyKey || `paddle-fail:${eventId || workspaceKey}`;
	const result = await handleFailedPayment(workspaceKey, {
		actor,
		reason,
		idempotencyKey: key,
	});

	const subscription = await loadSubscription(workspaceKey);
	if (subscription) {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
			paddle_transaction_id: transactionId || subscription.paddle_transaction_id || '',
			paddle_subscription_id: subscriptionId || subscription.paddle_subscription_id || '',
		}).catch(() => null);
	}

	return { ...result, handled: true, activated: false, kind: 'payment_failed' };
}

function buildPayPalSubscriptionPatch(verified, eventId) {
	const nowIso = new Date().toISOString();
	return {
		activation_source: 'system',
		billing_source: 'system',
		last_webhook_event_id: String(eventId || '').slice(0, 180),
		last_verified_at: nowIso,
		provider: 'paypal',
		provider_subscription_id: verified.subscriptionId
			? String(verified.subscriptionId).slice(0, 180)
			: '',
		last_payment_status: 'succeeded',
		last_payment_at: nowIso,
	};
}

export async function activatePayPalSubscription({
	workspaceKey,
	verified = {},
	eventId = '',
	idempotencyKey = '',
	actor = 'webhook:paypal',
} = {}) {
	const plan = await loadPlan(verified.planIdRecord || verified.planSlug);
	if (!plan) throw httpError(404, 'Plan not found', 'PLAN_NOT_FOUND');

	const key = String(
		idempotencyKey || `sub-fulfill:paypal-sub:${verified.subscriptionId || 'unknown'}`,
	).slice(0, 180);

	const idem = await claimIdempotencyKey({
		idempotencyKey: key,
		scope: 'paypal_activation',
		workspaceKey,
		provider: 'paypal',
		eventType: 'paypal_subscription_activated',
		payload: { subscriptionId: verified.subscriptionId },
	});
	if (idem.duplicate) {
		return { duplicate: true, fulfilled: true, activated: false, result: idem.result };
	}

	try {
		const subscription = await ensureWorkspaceWallet(workspaceKey);
		const fromPlan = subscription.expand?.plan?.slug
			|| (await loadPlan(subscription.plan))?.slug
			|| '';

		const now = new Date();
		const end = new Date(now);
		end.setMonth(end.getMonth() + 1);

		const creditsBalance = computeInitialActivationCredits(subscription, plan);

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			plan: plan.id,
			status: 'active',
			billing_status: 'active',
			pending_plan: '',
			credits_balance: creditsBalance,
			seats: seatsForPlanAssignment(plan),
			current_period_start: now.toISOString(),
			current_period_end: end.toISOString(),
			grace_period_ends_at: null,
			cancel_at_period_end: false,
			...buildPayPalSubscriptionPatch(verified, eventId),
		});

		await syncEntitlementMirrors({
			workspaceKey,
			plan,
			subscriptionId: subscription.id,
			actor,
			source: 'system',
		});

		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceKey,
			amount: Number(plan.credits) || 0,
			type: 'grant',
			reason: `PayPal subscription activated (${plan.name})`,
			balance: creditsBalance,
			created_by: actor,
			idempotency_key: key,
			reference_id: verified.subscriptionId || '',
			metadata: {
				provider: 'paypal',
				planSlug: plan.slug,
				subscriptionId: verified.subscriptionId || '',
			},
		}).catch(() => null);

		const result = {
			fulfilled: true,
			activated: true,
			kind: 'activation',
			workspaceKey,
			fromPlan,
			toPlan: plan.slug,
			provider: 'paypal',
			subscriptionId: verified.subscriptionId || '',
			creditsBalance,
		};

		await logBillingAction({
			action: 'PayPal subscription activated after API verification',
			eventType: 'upgrade',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			fromPlan,
			toPlan: plan.slug,
			credits: Number(plan.credits) || 0,
			provider: 'paypal',
			idempotencyKey: key,
			metadata: result,
		});

		await notifyPlanUpgraded(
			{ ...subscription, credits_balance: creditsBalance, plan: plan.id },
			fromPlan,
			plan.slug,
		).catch(() => null);

		await completeIdempotency(idem.record.id, result);
		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}

export async function renewPayPalSubscription({
	workspaceKey,
	verified = {},
	eventId = '',
	idempotencyKey = '',
	actor = 'webhook:paypal',
} = {}) {
	const key = String(
		idempotencyKey || `paypal-renew:sale:${verified.saleId || workspaceKey}`,
	).slice(0, 180);

	const idem = await claimIdempotencyKey({
		idempotencyKey: key,
		scope: 'paypal_renewal',
		workspaceKey,
		provider: 'paypal',
		eventType: 'paypal_subscription_renewed',
		payload: { saleId: verified.saleId, subscriptionId: verified.subscriptionId },
	});
	if (idem.duplicate) {
		return { duplicate: true, renewed: true, result: idem.result };
	}

	try {
		const subscription = await loadSubscription(workspaceKey);
		if (!subscription) throw httpError(404, 'Subscription not found', 'NOT_FOUND');

		const now = new Date();
		const end = new Date(now);
		end.setMonth(end.getMonth() + 1);

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			status: 'active',
			billing_status: 'active',
			current_period_start: now.toISOString(),
			current_period_end: end.toISOString(),
			grace_period_ends_at: null,
			last_payment_status: 'succeeded',
			last_payment_at: now.toISOString(),
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
			provider_subscription_id: verified.subscriptionId || subscription.provider_subscription_id || '',
		});

		const config = await resolveBillingConfig();
		let resetResult = null;
		if (config.autoResetCredits) {
			resetResult = await resetMonthlyCredits({ workspaceKey, actor, force: true });
			await clearCreditThresholdFlags(subscription.id);
			await notifyCreditsReset(subscription, resetResult?.balance);
		}

		const result = {
			renewed: true,
			kind: 'renewal',
			workspaceKey,
			periodStart: now.toISOString(),
			periodEnd: end.toISOString(),
			saleId: verified.saleId || '',
			subscriptionId: verified.subscriptionId || '',
			reset: resetResult,
		};

		await logBillingAction({
			action: 'PayPal subscription renewed after API verification',
			eventType: 'renewed',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			provider: 'paypal',
			idempotencyKey: key,
			metadata: result,
		});

		await completeIdempotency(idem.record.id, result);
		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}

export async function handlePayPalCancellation({
	workspaceKey = '',
	paypalSubscriptionId = '',
	cancelAtPeriodEnd = true,
	eventId = '',
	actor = 'webhook:paypal',
	reason = 'paypal_subscription_canceled',
} = {}) {
	let subscription = null;
	if (workspaceKey) {
		subscription = await loadSubscription(workspaceKey);
	} else if (paypalSubscriptionId) {
		subscription = await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('provider_subscription_id = {:id} && provider = {:provider}', {
				id: paypalSubscriptionId,
				provider: 'paypal',
			}),
			{ requestKey: null },
		).catch(() => null);
	}

	if (!subscription) {
		return { handled: false, activated: false, error: 'paypal_subscription_not_found' };
	}

	if (paypalSubscriptionId && subscription.provider_subscription_id
		&& subscription.provider_subscription_id !== paypalSubscriptionId) {
		return { handled: false, activated: false, error: 'paypal_subscription_identity_mismatch' };
	}

	const resolvedWorkspaceKey = subscription.workspace_key;

	if (cancelAtPeriodEnd) {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			cancel_at_period_end: true,
			billing_status: 'cancel_scheduled',
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
		});
	} else {
		const free = await loadPlan('free');
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			status: 'canceled',
			billing_status: 'canceled',
			cancel_at_period_end: false,
			plan: free?.id || subscription.plan,
			...(free ? { seats: seatsForPlanAssignment(free) } : {}),
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
		});
		if (free) {
			await syncEntitlementMirrors({
				workspaceKey: resolvedWorkspaceKey,
				plan: free,
				subscriptionId: subscription.id,
				actor,
				source: 'system',
			});
		}
	}

	await logBillingAction({
		action: cancelAtPeriodEnd ? 'PayPal cancellation scheduled' : 'PayPal subscription canceled',
		eventType: 'cancelled',
		workspaceKey: resolvedWorkspaceKey,
		workspaceName: subscription.workspace_name,
		actor,
		provider: 'paypal',
		message: reason,
		metadata: { paypalSubscriptionId, cancelAtPeriodEnd, eventId },
	});

	return {
		handled: true,
		activated: false,
		cancelled: true,
		atPeriodEnd: cancelAtPeriodEnd,
		workspaceKey: resolvedWorkspaceKey,
	};
}

export async function handlePayPalPaymentFailure({
	workspaceKey,
	eventId = '',
	subscriptionId = '',
	reason = 'paypal_payment_failed',
	actor = 'webhook:paypal',
	idempotencyKey = '',
} = {}) {
	if (!workspaceKey) {
		return { handled: true, activated: false, ignored: true, reason: 'payment_failed_without_workspace' };
	}

	const key = idempotencyKey || `paypal-fail:${eventId || workspaceKey}`;
	const result = await handleFailedPayment(workspaceKey, {
		actor,
		reason,
		idempotencyKey: key,
	});

	const subscription = await loadSubscription(workspaceKey);
	if (subscription) {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
			provider_subscription_id: subscriptionId || subscription.provider_subscription_id || '',
			last_payment_status: 'failed',
		}).catch(() => null);
	}

	return { ...result, handled: true, activated: false, kind: 'payment_failed' };
}
