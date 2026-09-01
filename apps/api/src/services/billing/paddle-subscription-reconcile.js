import { resolveRegistryEntryByPriceId } from './price-registry-resolver.js';
import { seatsForPlanAssignment } from './plan-seats.js';

const LOCAL_PADDLE_STATUSES = Object.freeze([
	'active',
	'trialing',
	'past_due',
	'canceled',
]);

function fail(error, extra = {}) {
	return { ok: false, error, ...extra };
}

export function isRefundPendingSubscription(subscription = {}) {
	return String(subscription.billing_status || '').trim() === 'refund_pending';
}

/**
 * Map authoritative Paddle subscription status to local workspace_subscriptions.status.
 */
export function mapPaddleSubscriptionStatusToLocal(paddleStatus = '') {
	const normalized = String(paddleStatus || '').trim().toLowerCase();
	if (normalized === 'cancelled') return 'canceled';
	if (LOCAL_PADDLE_STATUSES.includes(normalized)) return normalized;
	return null;
}

/**
 * Resolve paid plan slug from verified Paddle price via price registry (fail-closed).
 */
export function resolveReconciliationPlanFromPrice({
	verified = {},
	registryEntries = [],
	environment = '',
} = {}) {
	const priceId = String(verified.priceId || '').trim();
	const interval = String(verified.interval || '').trim().toLowerCase();
	if (!priceId || !interval) {
		return fail('paddle_reconciliation_verified_snapshot_missing');
	}

	const registryEntry = resolveRegistryEntryByPriceId(registryEntries, {
		provider: 'paddle',
		environment,
		priceId,
	});
	if (!registryEntry) {
		return fail('paddle_reconciliation_price_not_in_registry', { priceId, environment });
	}
	if (registryEntry.interval === 'one_time' || registryEntry.packId) {
		return fail('paddle_reconciliation_price_not_subscription', { priceId });
	}
	if (registryEntry.interval !== interval) {
		return fail('paddle_reconciliation_interval_mismatch', {
			expectedInterval: registryEntry.interval,
			receivedInterval: interval,
		});
	}
	if (!registryEntry.planSlug) {
		return fail('paddle_reconciliation_missing_plan_slug', { priceId });
	}

	return {
		ok: true,
		registryEntry,
		planSlug: registryEntry.planSlug,
	};
}

/**
 * Build subscription patch from verified Paddle snapshot (pure — no DB I/O).
 */
export function buildPaddleSubscriptionReconciliationPatch({
	subscription = {},
	verified = {},
	environment = '',
	planRecord = null,
	eventId = '',
	now = new Date(),
} = {}) {
	const nowIso = now.toISOString();
	const refundPending = isRefundPendingSubscription(subscription);
	const localStatus = mapPaddleSubscriptionStatusToLocal(verified.status);
	if (!localStatus) {
		return fail('paddle_reconciliation_status_unsupported', { status: verified.status });
	}

	const patch = {
		paddle_subscription_id: verified.subscriptionId,
		provider_subscription_id: verified.subscriptionId,
		provider: 'paddle',
		billing_source: 'paddle',
		paddle_customer_id: verified.customerId || subscription.paddle_customer_id || '',
		paddle_price_id: verified.priceId,
		billing_interval: verified.interval,
		billing_environment: environment,
		current_period_start: verified.currentBillingPeriod.startsAt,
		current_period_end: verified.currentBillingPeriod.endsAt,
		last_verified_at: nowIso,
		last_webhook_event_id: String(eventId || '').slice(0, 180),
	};

	if (!refundPending) {
		patch.status = localStatus;

		if (verified.cancelScheduledAtPeriodEnd) {
			patch.cancel_at_period_end = true;
			patch.billing_status = 'cancel_scheduled';
		} else if (localStatus === 'canceled') {
			patch.cancel_at_period_end = false;
			patch.billing_status = 'canceled';
		} else if (localStatus === 'past_due') {
			patch.cancel_at_period_end = false;
			patch.billing_status = 'past_due';
		} else {
			patch.cancel_at_period_end = false;
			patch.billing_status = 'active';
		}

		if (planRecord?.id) {
			patch.plan = planRecord.id;
			patch.seats = seatsForPlanAssignment(planRecord);
		}
	}

	return {
		ok: true,
		patch,
		refundPending,
		planSlug: planRecord?.slug || null,
		planChanged: Boolean(
			!refundPending
			&& planRecord?.id
			&& planRecord.id !== subscription.plan,
		),
	};
}

/**
 * Phase 4.4-D — Apply verified Paddle subscription metadata to local subscription record.
 * Does not activate, renew, cancel remotely, refund, or mutate credits.
 */
export async function reconcilePaddleSubscription({
	subscriptionRecord = null,
	verified = {},
	environment = '',
	registryEntries = [],
	eventId = '',
	actor = 'webhook:paddle',
	deps = {},
} = {}) {
	if (!subscriptionRecord?.id) {
		return fail('paddle_reconciliation_subscription_not_found');
	}
	if (!verified?.ok) {
		return fail('paddle_reconciliation_verified_snapshot_missing');
	}
	if (!environment) {
		return fail('paddle_reconciliation_environment_missing');
	}

	const workspaceKey = String(subscriptionRecord.workspace_key || '').trim();
	if (!workspaceKey) {
		return fail('paddle_reconciliation_workspace_missing');
	}

	const planResolution = resolveReconciliationPlanFromPrice({
		verified,
		registryEntries,
		environment,
	});
	if (!planResolution.ok) return planResolution;

	const loadPlan = deps.loadPlan;
	if (typeof loadPlan !== 'function') {
		return fail('paddle_reconciliation_load_plan_unavailable');
	}

	const planRecord = await loadPlan(planResolution.planSlug);
	if (!planRecord?.id) {
		return fail('paddle_reconciliation_plan_not_found', { planSlug: planResolution.planSlug });
	}

	const patchResult = buildPaddleSubscriptionReconciliationPatch({
		subscription: subscriptionRecord,
		verified,
		environment,
		planRecord,
		eventId,
	});
	if (!patchResult.ok) return patchResult;

	const updateSubscription = deps.updateSubscription;
	if (typeof updateSubscription !== 'function') {
		return fail('paddle_reconciliation_update_unavailable');
	}

	await updateSubscription(subscriptionRecord.id, patchResult.patch);

	let mirrorSynced = false;
	if (patchResult.planChanged && typeof deps.syncEntitlementMirrors === 'function') {
		await deps.syncEntitlementMirrors({
			workspaceKey,
			plan: planRecord,
			subscriptionId: subscriptionRecord.id,
			actor,
			source: 'paddle_webhook',
		});
		mirrorSynced = true;
	}

	const auditFn = deps.logBillingAction;
	if (typeof auditFn === 'function') {
		await auditFn({
			action: 'Paddle subscription metadata reconciled',
			eventType: 'subscription_reconciled',
			workspaceKey,
			workspaceName: subscriptionRecord.workspace_name || workspaceKey,
			actor,
			provider: 'paddle',
			severity: 'info',
			metadata: {
				subscriptionId: verified.subscriptionId,
				priceId: verified.priceId,
				interval: verified.interval,
				planSlug: planRecord.slug,
				refundPending: patchResult.refundPending,
				planChanged: patchResult.planChanged,
				mirrorSynced,
				eventId,
			},
		}).catch(() => null);
	}

	return {
		ok: true,
		reconciled: true,
		workspaceKey,
		subscriptionId: verified.subscriptionId,
		refundPending: patchResult.refundPending,
		planChanged: patchResult.planChanged,
		mirrorSynced,
		patch: patchResult.patch,
		reconciliation: {
			status: verified.status,
			scheduledChange: verified.scheduledChange,
			cancelScheduledAtPeriodEnd: verified.cancelScheduledAtPeriodEnd,
			priceId: verified.priceId,
			interval: verified.interval,
			currentBillingPeriod: verified.currentBillingPeriod,
			customerId: verified.customerId,
		},
	};
}
