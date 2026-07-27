import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { notifyWorkspaceUser } from '../workspace-notify.js';
import { getWallet } from '../credits-engine.js';
import { logBillingAction } from './audit.js';

function parseThresholds(flags = '') {
	return String(flags || '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

async function markThreshold(subscription, thresholdKey) {
	const current = parseThresholds(subscription.notified_credit_thresholds);
	if (current.includes(thresholdKey)) return false;
	const next = [...current, thresholdKey].join(',');
	await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
		notified_credit_thresholds: next,
	}).catch(() => null);
	return true;
}

async function resolveOwnerUserId(subscription) {
	if (subscription?.owner_user) return subscription.owner_user;
	const email = subscription?.owner_email;
	if (email) {
		const user = await pocketbaseClient.collection('users').getFirstListItem(
			pocketbaseClient.filter('email = {:email}', { email }),
			{ requestKey: null },
		).catch(() => null);
		if (user?.id) return user.id;
	}
	// Personal tenant pattern: workspace_key === user.id
	if (subscription?.workspace_key) {
		const user = await pocketbaseClient.collection('users').getOne(subscription.workspace_key).catch(() => null);
		if (user?.id) return user.id;
	}
	return '';
}

export async function notifyBillingEvent({
	subscription,
	title,
	body,
	priority = 'normal',
	type = 'billing',
	metadata = {},
} = {}) {
	const ownerId = await resolveOwnerUserId(subscription);
	if (!ownerId) return null;
	return notifyWorkspaceUser({
		ownerId,
		title,
		body,
		priority,
		meta: { type, ...metadata },
	});
}

/**
 * Emit low-balance / exhausted alerts based on wallet remaining vs monthly quota.
 */
export async function maybeNotifyCreditThresholds(workspaceKey) {
	const subscription = await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
		pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
	if (!subscription || subscription.credits_suspended) return { notified: [] };

	let wallet;
	try {
		wallet = await getWallet(workspaceKey);
	} catch {
		return { notified: [] };
	}

	const quota = Math.max(1, Number(wallet.monthlyQuota) || Number(subscription.expand?.plan?.credits) || 1);
	const remaining = Number(wallet.remaining) || 0;
	const ratio = remaining / quota;
	const notified = [];

	const checks = [
		{ key: 'exhausted', match: remaining <= 0, title: 'Credits exhausted', priority: 'high', body: 'Your workspace has 0 credits remaining. Purchase a top-up or upgrade your plan.' },
		{ key: 'below_10', match: remaining > 0 && ratio <= 0.1, title: 'Credits below 10%', priority: 'high', body: `Only ${remaining} credits remain (${Math.round(ratio * 100)}% of monthly quota).` },
		{ key: 'below_20', match: remaining > 0 && ratio <= 0.2 && ratio > 0.1, title: 'Credits below 20%', priority: 'normal', body: `${remaining} credits remaining (${Math.round(ratio * 100)}% of monthly quota).` },
	];

	for (const check of checks) {
		if (!check.match) continue;
		const first = await markThreshold(subscription, check.key);
		if (!first) continue;
		await notifyBillingEvent({
			subscription,
			title: check.title,
			body: check.body,
			priority: check.priority,
			type: check.key === 'exhausted' ? 'credits_low' : 'credits_low',
			metadata: { remaining, quota, ratio, threshold: check.key },
		});
		notified.push(check.key);
	}

	return { notified, remaining, quota };
}

export async function clearCreditThresholdFlags(subscriptionId) {
	if (!subscriptionId) return;
	await pocketbaseClient.collection('workspace_subscriptions').update(subscriptionId, {
		notified_credit_thresholds: '',
	}).catch(() => null);
}

export async function notifyTrialEnding(subscription, daysLeft) {
	await notifyBillingEvent({
		subscription,
		title: 'Trial ending soon',
		body: `Your trial ends in ${daysLeft} day(s). Upgrade to keep premium features.`,
		priority: daysLeft <= 1 ? 'high' : 'normal',
		type: 'trial_ending',
		metadata: { daysLeft },
	});
	await logBillingAction({
		action: 'Trial ending notification',
		eventType: 'trial_end',
		workspaceKey: subscription.workspace_key,
		workspaceName: subscription.workspace_name,
		message: `Trial ending in ${daysLeft}d`,
		metadata: { daysLeft },
	});
}

export async function notifySubscriptionEnding(subscription, daysLeft) {
	await notifyBillingEvent({
		subscription,
		title: 'Subscription ending soon',
		body: `Your subscription period ends in ${daysLeft} day(s).`,
		priority: daysLeft <= 1 ? 'high' : 'normal',
		type: 'subscription_ending',
		metadata: { daysLeft },
	});
}

export async function notifyPaymentFailed(subscription, reason = '') {
	await notifyBillingEvent({
		subscription,
		title: 'Payment failed',
		body: reason || 'We could not process your latest payment. Update your payment method to avoid interruption.',
		priority: 'high',
		type: 'payment_failed',
	});
	await logBillingAction({
		action: 'Payment failed',
		eventType: 'payment_failed',
		workspaceKey: subscription.workspace_key,
		workspaceName: subscription.workspace_name,
		severity: 'warn',
		result: 'error',
		message: reason || 'Payment failed',
	});
}

export async function notifyCreditsReset(subscription, balance) {
	await notifyBillingEvent({
		subscription,
		title: 'Credits reset completed',
		body: `Your monthly credits were refreshed. New balance: ${balance}.`,
		priority: 'normal',
		type: 'credits_reset',
		metadata: { balance },
	});
}

export async function notifyPlanUpgraded(subscription, fromPlan, toPlan) {
	await notifyBillingEvent({
		subscription,
		title: 'Plan upgraded',
		body: `Your workspace plan moved from ${fromPlan || 'previous'} to ${toPlan}.`,
		priority: 'normal',
		type: 'plan_upgraded',
		metadata: { fromPlan, toPlan },
	});
}

export async function notifyPlanDowngraded(subscription, fromPlan, toPlan) {
	await notifyBillingEvent({
		subscription,
		title: 'Plan downgraded',
		body: `Your workspace plan moved from ${fromPlan || 'previous'} to ${toPlan}.`,
		priority: 'normal',
		type: 'plan_downgraded',
		metadata: { fromPlan, toPlan },
	});
}
