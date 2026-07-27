import logger from '../../utils/logger.js';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { resetMonthlyCredits } from '../credits-engine.js';
import { resolveBillingConfig } from './providers/index.js';
import { processSubscriptionLifecycleBatch } from './subscriptions.js';
import { logBillingAction } from './audit.js';
import { clearCreditThresholdFlags, notifyCreditsReset } from './notifications.js';
import { maybeNotifyCreditThresholds } from './notifications.js';

let billingTimer = null;

/**
 * Optional credit expiration for non-purchased bonus/monthly leftovers flagged expire_at.
 * Safe no-op when field absent.
 */
async function expireStaleCredits({ limit = 100 } = {}) {
	const nowIso = new Date().toISOString();
	const rows = await pocketbaseClient.collection('credit_transactions').getList(1, limit, {
		filter: pocketbaseClient.filter('type = "grant" && feature = "expirable"'),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	let expired = 0;
	for (const row of rows.items || []) {
		const expiresAt = row.metadata?.expiresAt || row.metadata?.expire_at;
		if (!expiresAt || new Date(expiresAt).getTime() > Date.now()) continue;
		const workspaceKey = row.workspace_key;
		const amount = Math.abs(Number(row.amount) || 0);
		if (!workspaceKey || !amount) continue;

		const sub = await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
			{ requestKey: null },
		).catch(() => null);
		if (!sub) continue;

		const nextBalance = Math.max(0, (Number(sub.credits_balance) || 0) - amount);
		await pocketbaseClient.collection('workspace_subscriptions').update(sub.id, {
			credits_balance: nextBalance,
		}).catch(() => null);
		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: sub.workspace_name || workspaceKey,
			amount: -amount,
			type: 'expire',
			feature: 'credit_expiration',
			reason: `Expired grant ${row.id}`,
			balance: nextBalance,
			created_by: 'scheduler',
			reference_id: row.id,
			metadata: { sourceTransactionId: row.id, checkedAt: nowIso },
		}).catch(() => null);
		await logBillingAction({
			action: 'Credits expired',
			eventType: 'credits_expired',
			workspaceKey,
			workspaceName: sub.workspace_name,
			actor: 'scheduler',
			credits: amount,
		});
		expired += 1;
	}
	return { expired };
}

/**
 * Monthly credit reset across all active subscriptions (respects reset day unless force).
 */
export async function runMonthlyCreditResetJob({ force = false } = {}) {
	const config = await resolveBillingConfig();
	if (!config.autoResetCredits && !force) {
		return { skipped: true, reason: 'auto_reset_disabled' };
	}

	const settings = (await import('../platform-settings.js')).getPlatformSettings;
	const platform = await settings().catch(() => null);
	const resetDay = Number(platform?.settings?.credits?.resetDayOfMonth) || 1;
	const today = new Date().getUTCDate();
	if (!force && today !== resetDay) {
		return { skipped: true, reason: `reset_day_${resetDay}` };
	}

	const subscriptions = await pocketbaseClient.collection('workspace_subscriptions').getFullList({
		filter: pocketbaseClient.filter('status = "active" || status = "trialing"'),
		requestKey: null,
	}).catch(() => []);

	const summary = { reset: 0, skipped: 0, errors: 0 };
	for (const sub of subscriptions) {
		try {
			const last = sub.last_credit_reset_at ? new Date(sub.last_credit_reset_at) : null;
			const now = new Date();
			if (!force && last && last.getUTCFullYear() === now.getUTCFullYear() && last.getUTCMonth() === now.getUTCMonth()) {
				summary.skipped += 1;
				continue;
			}
			const result = await resetMonthlyCredits({
				workspaceKey: sub.workspace_key,
				actor: 'scheduler',
				force: true,
			});
			await clearCreditThresholdFlags(sub.id);
			await notifyCreditsReset(sub, result.balance);
			await logBillingAction({
				action: 'Credits reset',
				eventType: 'reset',
				workspaceKey: sub.workspace_key,
				workspaceName: sub.workspace_name,
				actor: 'scheduler',
				credits: result.balance,
				metadata: result,
			});
			summary.reset += 1;
		} catch {
			summary.errors += 1;
		}
	}
	return summary;
}

export async function runBillingAutomationTick() {
	const started = Date.now();
	const results = {
		lifecycle: null,
		monthlyReset: null,
		creditExpiration: null,
		thresholdSweep: null,
	};

	results.lifecycle = await processSubscriptionLifecycleBatch().catch((error) => ({
		error: error?.message || String(error),
	}));
	results.monthlyReset = await runMonthlyCreditResetJob().catch((error) => ({
		error: error?.message || String(error),
	}));
	results.creditExpiration = await expireStaleCredits().catch((error) => ({
		error: error?.message || String(error),
	}));

	// Light threshold sweep for active wallets
	const subs = await pocketbaseClient.collection('workspace_subscriptions').getList(1, 50, {
		filter: pocketbaseClient.filter('status = "active" || status = "trialing"'),
		sort: 'credits_balance',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	let notified = 0;
	for (const sub of subs.items || []) {
		const out = await maybeNotifyCreditThresholds(sub.workspace_key).catch(() => null);
		notified += out?.notified?.length || 0;
	}
	results.thresholdSweep = { checked: (subs.items || []).length, notified };
	results.durationMs = Date.now() - started;
	logger.info('[billing] automation tick complete', results);
	return results;
}

export function startBillingAutomationWorker() {
	if (billingTimer) return;
	const interval = Number.parseInt(process.env.BILLING_AUTOMATION_MS || String(15 * 60 * 1000), 10);
	logger.info(`[billing] automation worker every ${interval}ms`);
	const tick = () => {
		runBillingAutomationTick().catch((error) => {
			logger.warn(`[billing] automation tick failed: ${error.message}`);
		});
	};
	// Delay first tick slightly to let schema ensure finish.
	setTimeout(tick, 8_000);
	billingTimer = setInterval(tick, interval);
}

export function stopBillingAutomationWorker() {
	if (billingTimer) {
		clearInterval(billingTimer);
		billingTimer = null;
	}
}
