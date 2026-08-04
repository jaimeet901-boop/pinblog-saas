/**
 * Centralized Credits Engine for Chef IA.
 * Single source of truth: workspace_subscriptions.credits_balance + credit_transactions.
 */
import { randomUUID } from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { getPlatformSettings } from './platform-settings.js';
import logger from '../utils/logger.js';
import { withWorkspaceCreditLock } from './credit-workspace-lock.js';

export const DEFAULT_CREDIT_COSTS = Object.freeze({
	ai_analyze: 1,
	ai_prompt: 1,
	ai_writer: 2,
	ai_pin_copy: 1,
	ai_image: 1,
	pin_publish: 1,
	wordpress_publish: 1,
	template_export: 1,
});

export const DEFAULT_TRIAL_CONFIG = Object.freeze({
	enabled: false,
	days: 14,
	credits: 100,
});

export const DEFAULT_UPGRADE_RULES = Object.freeze({
	prorate: true,
	keepUnusedCredits: true,
	immediate: true,
});

export const DEFAULT_DOWNGRADE_RULES = Object.freeze({
	atPeriodEnd: true,
	forfeitUnusedCredits: false,
	clampToNewQuota: true,
});

function periodKey(date = new Date()) {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getCreditCosts() {
	const settings = await getPlatformSettings().catch(() => null);
	const fromSettings = settings?.credits?.featureCosts;
	return {
		...DEFAULT_CREDIT_COSTS,
		...(fromSettings && typeof fromSettings === 'object' ? fromSettings : {}),
	};
}

export async function resolveFeatureCost(feature, planCreditCosts = null) {
	const costs = {
		...(await getCreditCosts()),
		...(planCreditCosts && typeof planCreditCosts === 'object' ? planCreditCosts : {}),
	};
	const key = String(feature || '').trim();
	if (!key) return 1;
	const value = Number(costs[key]);
	return Number.isFinite(value) && value >= 0 ? value : 1;
}

/**
 * Registered credit feature keys (platform cost catalog).
 * New AI features: add a key here (or platform settings credits.featureCosts) + call begin/settle.
 */
export function listCreditFeatureKeys() {
	return Object.keys(DEFAULT_CREDIT_COSTS);
}

/**
 * Begin a reservation for a registered feature.
 * Amount is ALWAYS derived from resolveFeatureCost(feature) × units — callers must not compute credits.
 *
 * @returns {Promise<object>} reservation DTO (+ unitCost, units). id may be null when cost is 0 (noop).
 */
export async function beginFeatureReservation({
	workspaceKey,
	feature,
	units = 1,
	planCreditCosts = null,
	reason = '',
	actorUserId = '',
	referenceId = '',
	idempotencyKey = '',
	ttlMs = 15 * 60 * 1000,
	metadata = {},
	wallet = null,
} = {}) {
	const featureKey = String(feature || '').trim();
	const key = String(workspaceKey || '').trim();
	if (!key || !featureKey) {
		throw httpError(422, 'workspaceKey and feature are required', 'VALIDATION_ERROR');
	}

	if (wallet && typeof wallet === 'object') {
		await ensureWorkspaceWallet(key, {
			workspaceName: wallet.workspaceName || key,
			ownerEmail: wallet.ownerEmail || '',
			planSlug: wallet.planSlug || 'free',
			planId: wallet.planId || '',
		}).catch(() => null);
	}

	const unitCount = Math.max(1, Number(units) || 1);
	const unitCost = await resolveFeatureCost(featureKey, planCreditCosts);
	const amount = unitCost * unitCount;

	if (!Number.isFinite(amount) || amount <= 0) {
		return {
			id: null,
			workspaceKey: key,
			amount: 0,
			feature: featureKey,
			status: 'noop',
			unitCost,
			units: unitCount,
			noop: true,
		};
	}

	const reservation = await reserveCredits({
		workspaceKey: key,
		amount,
		feature: featureKey,
		reason: reason || `Reserve ${featureKey}`,
		actorUserId,
		referenceId,
		idempotencyKey,
		ttlMs,
		metadata: {
			...(metadata && typeof metadata === 'object' ? metadata : {}),
			unitCost,
			units: unitCount,
			resolvedVia: 'resolveFeatureCost',
		},
	});

	return {
		...reservation,
		unitCost,
		units: unitCount,
		noop: false,
	};
}

/**
 * Commit on success or release on failure. Single settlement entry for all features.
 */
export async function settleFeatureReservation(reservationId, {
	success,
	actor = 'system',
	metadata = {},
	bumpLegacyAiCounterForUserId = '',
} = {}) {
	const id = String(reservationId || '').trim();
	if (!id) {
		return { settled: 'noop', reservation: null };
	}

	if (success) {
		const reservation = await commitReservation(id, { actor, metadata });
		const userId = String(bumpLegacyAiCounterForUserId || '').trim();
		if (userId) {
			const user = await pocketbaseClient.collection('users').getOne(userId).catch(() => null);
			if (user) {
				await pocketbaseClient.collection('users').update(userId, {
					ai_credits_used: Number(user.ai_credits_used || 0) + 1,
				}).catch(() => null);
			}
		}
		return { settled: 'committed', reservation };
	}

	const reservation = await releaseReservation(id, { actor });
	return { settled: 'released', reservation };
}

/**
 * Sync helper: reserve → execute → commit | release.
 * Prefer begin/settle separately for streaming / long-running jobs.
 */
export async function withFeatureCredits(options, execute) {
	if (typeof execute !== 'function') {
		throw httpError(422, 'execute callback is required', 'VALIDATION_ERROR');
	}
	const reservation = await beginFeatureReservation(options);
	const actor = options.actorUserId || 'system';
	try {
		const result = await execute(reservation);
		await settleFeatureReservation(reservation.id, {
			success: true,
			actor,
			metadata: options.commitMetadata || {},
			bumpLegacyAiCounterForUserId: options.bumpLegacyAiCounterForUserId || '',
		});
		return result;
	} catch (error) {
		await settleFeatureReservation(reservation.id, {
			success: false,
			actor,
		}).catch(() => null);
		throw error;
	}
}

async function getSubscription(workspaceKey) {
	if (!workspaceKey) return null;
	return pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
		pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
}

async function getSubscriptionById(subscriptionId) {
	if (!subscriptionId) return null;
	return pocketbaseClient.collection('workspace_subscriptions').getOne(subscriptionId, {
		expand: 'plan',
		requestKey: null,
	}).catch(() => null);
}

/**
 * Apply a signed balance delta under an already-held workspace lock.
 * Re-reads before write; rejects overdraft; never persists a negative balance unless allowNegative.
 * @returns {{ subscription: object, previousBalance: number, balance: number }}
 */
async function applyBalanceDeltaLocked(workspaceKey, delta, {
	allowNegative = false,
	usedTotalDelta = 0,
	requireNotSuspended = false,
} = {}) {
	const key = String(workspaceKey || '').trim();
	let subscription = await getSubscription(key);
	if (!subscription) {
		throw httpError(404, 'Workspace subscription not found', 'NOT_FOUND');
	}
	if (requireNotSuspended && subscription.credits_suspended) {
		throw httpError(403, 'Credits are suspended for this workspace', 'CREDITS_SUSPENDED');
	}

	const current = Number(subscription.credits_balance) || 0;
	const rawNext = current + Number(delta);
	if (!Number.isFinite(rawNext)) {
		throw httpError(422, 'Invalid credit balance delta', 'VALIDATION_ERROR');
	}
	if (!allowNegative && rawNext < 0) {
		const error = httpError(402, `Insufficient credits. Remaining: ${current}`, 'INSUFFICIENT_CREDITS');
		error.remaining = current;
		throw error;
	}
	const nextBalance = allowNegative ? rawNext : Math.max(0, rawNext);
	if (nextBalance < 0) {
		throw httpError(500, 'Credit balance would become negative', 'CREDITS_INTEGRITY');
	}

	const patch = { credits_balance: nextBalance };
	if (usedTotalDelta) {
		patch.credits_used_total = Math.max(0, (Number(subscription.credits_used_total) || 0) + Number(usedTotalDelta));
	}

	await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, patch);

	const verified = await getSubscriptionById(subscription.id);
	if (!verified) {
		throw httpError(500, 'Credit wallet missing after update', 'CREDITS_INTEGRITY');
	}
	const verifiedBalance = Number(verified.credits_balance) || 0;
	if (verifiedBalance < 0) {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			credits_balance: 0,
		}).catch(() => null);
		throw httpError(500, 'Credit balance integrity violation', 'CREDITS_INTEGRITY');
	}

	return {
		subscription: verified,
		previousBalance: current,
		balance: verifiedBalance,
	};
}

/**
 * Ensure a workspace credit wallet exists (creates free-plan subscription when missing).
 */
export async function ensureWorkspaceWallet(workspaceKey, {
	workspaceName = '',
	ownerEmail = '',
	planSlug = 'free',
	planId = '',
	initialBalance = null,
} = {}) {
	if (!workspaceKey) {
		throw httpError(422, 'workspaceKey is required', 'VALIDATION_ERROR');
	}
	const existing = await getSubscription(workspaceKey);
	if (existing) return existing;

	const { getPlatformSettings } = await import('./platform-settings.js');
	const settings = await getPlatformSettings().catch(() => null);
	const defaultFree = Number(settings?.credits?.defaultFreeCredits);
	let plan = null;
	if (planId) {
		plan = await pocketbaseClient.collection('plans').getOne(planId).catch(() => null);
	}
	if (!plan) {
		const slug = planSlug || settings?.general?.defaultWorkspacePlan || 'free';
		plan = await pocketbaseClient.collection('plans').getFirstListItem(
			pocketbaseClient.filter('slug = {:slug}', { slug }),
			{ requestKey: null },
		).catch(() => null);
	}
	if (!plan) {
		plan = await pocketbaseClient.collection('plans').getList(1, 1, { sort: 'display_order' })
			.then((r) => r.items?.[0] || null)
			.catch(() => null);
	}
	if (!plan) {
		throw httpError(400, 'No plans available to attach workspace wallet', 'NO_PLANS');
	}

	const now = new Date();
	const end = new Date(now);
	end.setMonth(end.getMonth() + 1);
	const balance = initialBalance != null
		? Math.max(0, Number(initialBalance) || 0)
		: (Number.isFinite(defaultFree) ? defaultFree : (Number(plan.credits) || 0));

	return pocketbaseClient.collection('workspace_subscriptions').create({
		workspace_key: workspaceKey,
		workspace_name: workspaceName || workspaceKey,
		owner_email: ownerEmail || '',
		plan: plan.id,
		status: 'active',
		billing_status: 'active',
		seats: 1,
		current_period_start: now.toISOString(),
		current_period_end: end.toISOString(),
		credits_balance: balance,
		purchased_credits: 0,
		bonus_credits_balance: Number(plan.bonus_credits) || 0,
		credits_used_total: 0,
		credits_suspended: false,
	});
}

async function getOrCreateUsage(workspaceKey, workspaceName = '', period = periodKey()) {
	try {
		return await pocketbaseClient.collection('workspace_usage').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key} && period = {:period}', {
				key: workspaceKey,
				period,
			}),
			{ requestKey: null },
		);
	} catch {
		return pocketbaseClient.collection('workspace_usage').create({
			workspace_key: workspaceKey,
			workspace_name: workspaceName || workspaceKey,
			period,
			articles: 0,
			images: 0,
			tokens: 0,
			queue_jobs: 0,
			publishing: 0,
			api_calls: 0,
			credits_burned: 0,
		});
	}
}

async function writeBillingEvent({
	workspaceKey,
	workspaceName = '',
	eventType,
	fromPlan = '',
	toPlan = '',
	actor = 'system',
	message = '',
	metadata = {},
}) {
	return pocketbaseClient.collection('billing_events').create({
		workspace_key: workspaceKey,
		workspace_name: workspaceName || workspaceKey,
		event_type: eventType,
		from_plan: fromPlan,
		to_plan: toPlan,
		actor,
		message: String(message || '').slice(0, 1000),
		metadata: metadata || {},
		occurred_at: new Date().toISOString(),
	}).catch((error) => {
		logger.warn('billing_events write skipped', { message: error?.message || String(error) });
		return null;
	});
}

export async function getWallet(workspaceKey) {
	const subscription = await getSubscription(workspaceKey);
	if (!subscription) {
		throw httpError(404, 'Workspace subscription not found', 'NOT_FOUND');
	}
	const plan = subscription.expand?.plan || null;
	const balance = Number(subscription.credits_balance) || 0;
	const purchased = Number(subscription.purchased_credits) || 0;
	const bonus = Number(subscription.bonus_credits_balance) || 0;
	const usedTotal = Number(subscription.credits_used_total) || 0;
	const monthlyQuota = Number(plan?.credits) || 0;
	return {
		workspaceKey: subscription.workspace_key,
		workspaceName: subscription.workspace_name || subscription.workspace_key,
		balance,
		purchasedCredits: purchased,
		bonusCredits: bonus,
		usedTotal,
		monthlyQuota,
		remaining: balance,
		suspended: Boolean(subscription.credits_suspended),
		billingStatus: subscription.billing_status || subscription.status || 'active',
		planSlug: plan?.slug || '',
		planName: plan?.name || '',
		lastResetAt: subscription.last_credit_reset_at || '',
		periodEnd: subscription.current_period_end || '',
	};
}

/**
 * Consume credits for a feature (serialized burn against workspace wallet).
 */
export async function consumeWorkspaceCredits({
	workspaceKey,
	amount,
	feature = '',
	reason = '',
	actor = 'system',
	metadata = {},
	idempotencyKey = '',
	referenceId = '',
	allowNegative = false,
} = {}) {
	if (!workspaceKey) {
		throw httpError(422, 'workspaceKey is required', 'VALIDATION_ERROR');
	}
	const burnAmount = Math.abs(Number(amount) || 0);
	if (!Number.isFinite(burnAmount) || burnAmount <= 0) {
		throw httpError(422, 'amount must be a positive number', 'VALIDATION_ERROR');
	}

	if (idempotencyKey) {
		const existing = await pocketbaseClient.collection('credit_transactions').getFirstListItem(
			pocketbaseClient.filter('idempotency_key = {:key}', { key: idempotencyKey }),
			{ requestKey: null },
		).catch(() => null);
		if (existing) {
			return {
				idempotent: true,
				transactionId: existing.id,
				balance: Number(existing.balance) || 0,
				amount: Number(existing.amount) || 0,
			};
		}
	}

	return withWorkspaceCreditLock(workspaceKey, async () => {
		if (idempotencyKey) {
			const existing = await pocketbaseClient.collection('credit_transactions').getFirstListItem(
				pocketbaseClient.filter('idempotency_key = {:key}', { key: idempotencyKey }),
				{ requestKey: null },
			).catch(() => null);
			if (existing) {
				return {
					idempotent: true,
					transactionId: existing.id,
					balance: Number(existing.balance) || 0,
					amount: Number(existing.amount) || 0,
				};
			}
		}

		let subscription = await getSubscription(workspaceKey);
		if (!subscription) {
			subscription = await ensureWorkspaceWallet(workspaceKey, {
				workspaceName: metadata?.workspaceName || workspaceKey,
				ownerEmail: metadata?.ownerEmail || '',
			});
		}

		const { subscription: updated, balance: nextBalance } = await applyBalanceDeltaLocked(
			workspaceKey,
			-burnAmount,
			{
				allowNegative,
				usedTotalDelta: burnAmount,
				requireNotSuspended: true,
			},
		);

		const resolvedIdempotencyKey = String(idempotencyKey || '').trim() || randomUUID();
		let tx;
		try {
			tx = await pocketbaseClient.collection('credit_transactions').create({
				workspace_key: workspaceKey,
				workspace_name: updated.workspace_name || workspaceKey,
				amount: -burnAmount,
				type: 'burn',
				reason: reason || `Consume ${feature || 'credits'}`,
				balance: nextBalance,
				created_by: actor,
				feature: String(feature || '').slice(0, 80),
				idempotency_key: resolvedIdempotencyKey,
				reference_id: referenceId || '',
				metadata: metadata || {},
			});
		} catch (error) {
			await applyBalanceDeltaLocked(workspaceKey, burnAmount, {
				allowNegative: true,
				usedTotalDelta: -burnAmount,
			}).catch(() => null);
			throw error;
		}

		const usage = await getOrCreateUsage(workspaceKey, updated.workspace_name);
		const usagePatch = {
			credits_burned: (Number(usage.credits_burned) || 0) + burnAmount,
		};
		if (feature === 'ai_image' || feature === 'image') {
			usagePatch.images = (Number(usage.images) || 0) + 1;
		} else if (
			feature === 'ai_analyze'
			|| feature === 'ai_prompt'
			|| feature === 'ai_writer'
			|| feature === 'ai_pin_copy'
		) {
			usagePatch.tokens = (Number(usage.tokens) || 0) + burnAmount;
		} else if (feature === 'pin_publish' || feature === 'wordpress_publish') {
			usagePatch.publishing = (Number(usage.publishing) || 0) + 1;
		} else {
			usagePatch.api_calls = (Number(usage.api_calls) || 0) + 1;
		}
		await pocketbaseClient.collection('workspace_usage').update(usage.id, usagePatch).catch(() => null);

		import('./billing/notifications.js')
			.then((mod) => mod.maybeNotifyCreditThresholds(workspaceKey))
			.catch(() => null);

		return {
			idempotent: false,
			transactionId: tx.id,
			balance: nextBalance,
			amount: -burnAmount,
			usedTotal: Number(updated.credits_used_total) || 0,
		};
	});
}

// Fire-and-forget low-balance notifications after successful burns.
export async function consumeWorkspaceCreditsAndNotify(args = {}) {
	return consumeWorkspaceCredits(args);
}

export async function reserveCredits({
	workspaceKey,
	amount,
	feature = '',
	reason = '',
	actorUserId = '',
	referenceId = '',
	idempotencyKey = '',
	ttlMs = 15 * 60 * 1000,
	metadata = {},
} = {}) {
	const reserveAmount = Math.abs(Number(amount) || 0);
	if (!workspaceKey || !reserveAmount) {
		throw httpError(422, 'workspaceKey and positive amount are required', 'VALIDATION_ERROR');
	}

	if (idempotencyKey) {
		const existing = await pocketbaseClient.collection('credit_reservations').getFirstListItem(
			pocketbaseClient.filter('idempotency_key = {:key}', { key: idempotencyKey }),
			{ requestKey: null },
		).catch(() => null);
		if (existing) return mapReservation(existing);
	}

	return withWorkspaceCreditLock(workspaceKey, async () => {
		if (idempotencyKey) {
			const existing = await pocketbaseClient.collection('credit_reservations').getFirstListItem(
				pocketbaseClient.filter('idempotency_key = {:key}', { key: idempotencyKey }),
				{ requestKey: null },
			).catch(() => null);
			if (existing) return mapReservation(existing);
		}

		const { subscription, balance: nextBalance } = await applyBalanceDeltaLocked(
			workspaceKey,
			-reserveAmount,
			{ requireNotSuspended: true },
		);

		let reservation;
		try {
			reservation = await pocketbaseClient.collection('credit_reservations').create({
				workspace_key: workspaceKey,
				workspace_name: subscription.workspace_name || workspaceKey,
				amount: reserveAmount,
				feature: String(feature || '').slice(0, 80),
				status: 'reserved',
				reason: reason || `Reserve ${feature || 'credits'}`,
				reference_id: referenceId || '',
				idempotency_key: idempotencyKey || undefined,
				expires_at: new Date(Date.now() + ttlMs).toISOString(),
				metadata: metadata || {},
				created_by_user: actorUserId || undefined,
			});
		} catch (error) {
			await applyBalanceDeltaLocked(workspaceKey, reserveAmount, { allowNegative: true }).catch(() => null);
			throw error;
		}

		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceKey,
			amount: -reserveAmount,
			type: 'adjust',
			reason: `Reservation ${reservation.id}`,
			balance: nextBalance,
			created_by: actorUserId || 'system',
			feature: String(feature || '').slice(0, 80),
			reservation_id: reservation.id,
			metadata: { reservation: true, ...(metadata || {}) },
		}).catch(() => null);

		return mapReservation(reservation);
	});
}

export async function commitReservation(reservationId, { actor = 'system', metadata = {} } = {}) {
	const reservation = await pocketbaseClient.collection('credit_reservations').getOne(reservationId).catch(() => null);
	if (!reservation) throw httpError(404, 'Reservation not found', 'NOT_FOUND');
	if (reservation.status !== 'reserved') {
		return mapReservation(reservation);
	}

	return withWorkspaceCreditLock(reservation.workspace_key, async () => {
		const fresh = await pocketbaseClient.collection('credit_reservations').getOne(reservationId).catch(() => null);
		if (!fresh) throw httpError(404, 'Reservation not found', 'NOT_FOUND');
		if (fresh.status !== 'reserved') {
			return mapReservation(fresh);
		}

		const subscription = await getSubscription(fresh.workspace_key);
		const usedTotal = (Number(subscription?.credits_used_total) || 0) + (Number(fresh.amount) || 0);
		if (subscription) {
			await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
				credits_used_total: usedTotal,
			}).catch(() => null);
		}

		const updated = await pocketbaseClient.collection('credit_reservations').update(reservationId, {
			status: 'committed',
			metadata: { ...(fresh.metadata || {}), ...(metadata || {}), committedBy: actor },
		});

		const balanceAfter = Number((await getSubscription(fresh.workspace_key))?.credits_balance) || 0;
		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: fresh.workspace_key,
			workspace_name: fresh.workspace_name,
			amount: -(Number(fresh.amount) || 0),
			type: 'burn',
			reason: `Commit reservation ${reservationId}`,
			balance: balanceAfter,
			created_by: actor,
			feature: fresh.feature || '',
			reservation_id: reservationId,
			metadata: metadata || {},
		}).catch(() => null);

		const usage = await getOrCreateUsage(fresh.workspace_key, fresh.workspace_name);
		await pocketbaseClient.collection('workspace_usage').update(usage.id, {
			credits_burned: (Number(usage.credits_burned) || 0) + (Number(fresh.amount) || 0),
		}).catch(() => null);

		return mapReservation(updated);
	});
}

export async function releaseReservation(reservationId, { actor = 'system' } = {}) {
	const reservation = await pocketbaseClient.collection('credit_reservations').getOne(reservationId).catch(() => null);
	if (!reservation) throw httpError(404, 'Reservation not found', 'NOT_FOUND');
	if (reservation.status !== 'reserved') {
		return mapReservation(reservation);
	}

	return withWorkspaceCreditLock(reservation.workspace_key, async () => {
		const fresh = await pocketbaseClient.collection('credit_reservations').getOne(reservationId).catch(() => null);
		if (!fresh) throw httpError(404, 'Reservation not found', 'NOT_FOUND');
		if (fresh.status !== 'reserved') {
			return mapReservation(fresh);
		}

		const refund = Number(fresh.amount) || 0;
		const { balance: nextBalance } = await applyBalanceDeltaLocked(fresh.workspace_key, refund, {
			allowNegative: true,
		});

		let updated;
		try {
			updated = await pocketbaseClient.collection('credit_reservations').update(reservationId, {
				status: 'released',
			});
		} catch (error) {
			await applyBalanceDeltaLocked(fresh.workspace_key, -refund, { allowNegative: true }).catch(() => null);
			throw error;
		}

		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: fresh.workspace_key,
			workspace_name: fresh.workspace_name,
			amount: refund,
			type: 'refund',
			reason: `Release reservation ${reservationId}`,
			balance: nextBalance,
			created_by: actor,
			feature: fresh.feature || '',
			reservation_id: reservationId,
		}).catch(() => null);

		return mapReservation(updated);
	});
}

export async function refundCredits({
	workspaceKey,
	amount,
	reason = 'Credit refund',
	actor = 'admin',
	feature = '',
	referenceId = '',
	metadata = {},
} = {}) {
	const refundAmount = Math.abs(Number(amount) || 0);
	if (!workspaceKey || !refundAmount) {
		throw httpError(422, 'workspaceKey and positive amount are required', 'VALIDATION_ERROR');
	}

	return withWorkspaceCreditLock(workspaceKey, async () => {
		const { subscription, balance: nextBalance } = await applyBalanceDeltaLocked(
			workspaceKey,
			refundAmount,
			{ allowNegative: true },
		);
		const tx = await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceKey,
			amount: refundAmount,
			type: 'refund',
			reason,
			balance: nextBalance,
			created_by: actor,
			feature: String(feature || '').slice(0, 80),
			reference_id: referenceId || '',
			metadata: metadata || {},
		});
		return {
			transactionId: tx.id,
			balance: nextBalance,
			amount: refundAmount,
		};
	});
}

export async function resetMonthlyCredits({
	workspaceKey,
	actor = 'system',
	force = false,
} = {}) {
	return withWorkspaceCreditLock(workspaceKey, async () => {
		const subscription = await getSubscription(workspaceKey);
		if (!subscription) throw httpError(404, 'Workspace subscription not found', 'NOT_FOUND');

		const settings = await getPlatformSettings().catch(() => null);
		const resetDay = Number(settings?.credits?.resetDayOfMonth) || 1;
		const now = new Date();
		if (!force && now.getUTCDate() !== resetDay) {
			return { skipped: true, reason: `Reset day is ${resetDay}` };
		}

		const plan = subscription.expand?.plan
			|| (subscription.plan
				? await pocketbaseClient.collection('plans').getOne(subscription.plan).catch(() => null)
				: null);
		const monthly = Number(plan?.credits) || 0;
		const bonus = Number(plan?.bonus_credits) || 0;
		const keepPurchased = settings?.credits?.keepPurchasedOnReset !== false;
		const purchased = keepPurchased ? (Number(subscription.purchased_credits) || 0) : 0;
		const nextBalance = Math.max(0, monthly + bonus + purchased);
		const previousBalance = Number(subscription.credits_balance) || 0;

		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			credits_balance: nextBalance,
			bonus_credits_balance: bonus,
			last_credit_reset_at: now.toISOString(),
		});

		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceKey,
			amount: nextBalance - previousBalance,
			type: 'grant',
			reason: 'Monthly credit reset',
			balance: nextBalance,
			created_by: actor,
			feature: 'monthly_reset',
			metadata: { monthly, bonus, purchased },
		}).catch(() => null);

		await writeBillingEvent({
			workspaceKey,
			workspaceName: subscription.workspace_name,
			eventType: 'reset',
			actor,
			message: `Monthly reset → ${nextBalance} credits`,
			metadata: { monthly, bonus, purchased },
		});

		return {
			skipped: false,
			balance: nextBalance,
			monthly,
			bonus,
			purchased,
		};
	});
}

export async function setCreditsSuspended(workspaceKey, suspended, actor = 'admin') {
	const subscription = await getSubscription(workspaceKey);
	if (!subscription) throw httpError(404, 'Workspace subscription not found', 'NOT_FOUND');
	const updated = await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
		credits_suspended: Boolean(suspended),
		billing_status: suspended ? 'credits_suspended' : (subscription.status || 'active'),
	});
	await writeBillingEvent({
		workspaceKey,
		workspaceName: subscription.workspace_name,
		eventType: suspended ? 'suspend' : 'unsuspend',
		actor,
		message: suspended ? 'Credits suspended' : 'Credits unsuspended',
	});
	return {
		workspaceKey,
		suspended: Boolean(updated.credits_suspended),
		billingStatus: updated.billing_status,
	};
}

export function mapReservation(row) {
	return {
		id: row.id,
		workspaceKey: row.workspace_key,
		workspaceName: row.workspace_name || row.workspace_key,
		amount: Number(row.amount) || 0,
		feature: row.feature || '',
		status: row.status,
		reason: row.reason || '',
		referenceId: row.reference_id || '',
		expiresAt: row.expires_at || '',
		createdAt: row.created,
		updatedAt: row.updated,
		metadata: row.metadata || {},
	};
}

export { writeBillingEvent, getSubscription as getWorkspaceSubscriptionRecord, periodKey };
