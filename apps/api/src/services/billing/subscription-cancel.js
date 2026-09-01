import { BILLING_PROVIDERS } from './providers/base.js';
import { seatsForPlanAssignment } from './plan-seats.js';
import {
	buildSubscriptionCancelIdempotencyKey,
	CANCELLATION_IDEMPOTENCY_STALE_MS,
} from './cancellation-idempotency-keys.js';

const REMOTE_CANCEL_PROVIDERS = Object.freeze(['paddle', 'paypal', 'stripe', 'lemonsqueezy']);

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function resolveSubscriptionProviderCode(subscription = {}) {
	const raw = String(subscription.provider || '').trim().toLowerCase();
	if (!raw || raw === 'none') return { ok: true, code: 'none' };
	if (!BILLING_PROVIDERS.includes(raw)) {
		return { ok: false, raw };
	}
	return { ok: true, code: raw };
}

export function resolveProviderSubscriptionId(subscription = {}, providerCode = '') {
	const code = providerCode || resolveSubscriptionProviderCode(subscription).code || 'none';
	if (code === 'paddle') {
		return String(subscription.paddle_subscription_id || subscription.provider_subscription_id || '').trim();
	}
	return String(subscription.provider_subscription_id || '').trim();
}

export { buildSubscriptionCancelIdempotencyKey };

function isLocalOnlyCancellation(providerCode) {
	return providerCode === 'none';
}

function isRefundPendingCancellation(subscription = {}) {
	return String(subscription.billing_status || '').trim() === 'refund_pending';
}

function isAlreadyCancelScheduled(subscription = {}) {
	return subscription.cancel_at_period_end === true
		&& String(subscription.billing_status || '').trim() === 'cancel_scheduled';
}

function isAlreadyTerminatedSubscription(subscription = {}) {
	const status = String(subscription.status || '').trim().toLowerCase();
	const billingStatus = String(subscription.billing_status || '').trim().toLowerCase();
	if (status === 'canceled' && !subscription.cancel_at_period_end) return true;
	if (['expired', 'refunded', 'trial_expired'].includes(billingStatus)) return true;
	return false;
}

function idempotencyRecordAgeMs(record = {}) {
	const stamp = record.updated || record.processed_at || record.created || null;
	if (!stamp) return Number.POSITIVE_INFINITY;
	const ts = new Date(stamp).getTime();
	return Number.isFinite(ts) ? Math.max(0, Date.now() - ts) : Number.POSITIVE_INFINITY;
}

async function resolveIdempotency(deps = {}) {
	if (deps.claimIdempotencyKey && deps.completeIdempotency && deps.failIdempotency) {
		return {
			claim: deps.claimIdempotencyKey,
			complete: deps.completeIdempotency,
			fail: deps.failIdempotency,
			reset: deps.resetIdempotencyForRetry,
		};
	}
	const mod = await import('./idempotency.js');
	return {
		claim: deps.claimIdempotencyKey || mod.claimIdempotencyKey,
		complete: deps.completeIdempotency || mod.completeIdempotency,
		fail: deps.failIdempotency || mod.failIdempotency,
		reset: deps.resetIdempotencyForRetry || mod.resetIdempotencyForRetry,
	};
}

async function acquireCancellationClaim({
	workspaceKey,
	providerCode,
	idempotencyIdentity,
	atPeriodEnd,
	actor,
	auditFn,
	idempotency,
	staleMs = CANCELLATION_IDEMPOTENCY_STALE_MS,
}) {
	const idempotencyKey = buildSubscriptionCancelIdempotencyKey(
		workspaceKey,
		providerCode,
		idempotencyIdentity,
	);

	const claim = await idempotency.claim({
		idempotencyKey,
		scope: 'subscription_cancel',
		workspaceKey,
		provider: providerCode,
		eventType: 'cancelled',
		payload: { atPeriodEnd, actor },
	});

	if (claim.claimed) {
		await auditFn({
			action: 'Cancellation claim acquired',
			eventType: 'cancelled',
			workspaceKey,
			actor,
			provider: providerCode,
			idempotencyKey,
			metadata: { atPeriodEnd },
		}).catch(() => null);
		return { idempotencyKey, record: claim.record };
	}

	const record = claim.record || {};
	const status = String(record.status || '').trim();

	if (status === 'completed' && record.result && typeof record.result === 'object') {
		await auditFn({
			action: 'Cancellation duplicate — returning completed result',
			eventType: 'cancelled',
			workspaceKey,
			actor,
			provider: providerCode,
			idempotencyKey,
			severity: 'info',
			metadata: { duplicate: true },
		}).catch(() => null);
		return {
			idempotencyKey,
			record,
			shortCircuit: { ...record.result, idempotent: true, duplicate: true },
		};
	}

	if (status === 'failed') {
		const reclaimed = await idempotency.reset(record.id, {
			payload: { atPeriodEnd, actor, retry: true },
		});
		if (!reclaimed) {
			throw httpError(502, 'Idempotency reclaim failed', 'IDEMPOTENCY_RECLAIM_FAILED');
		}
		await auditFn({
			action: 'Cancellation claim reclaimed — retry after failure',
			eventType: 'cancelled',
			workspaceKey,
			actor,
			provider: providerCode,
			idempotencyKey,
			severity: 'info',
			metadata: { retry: true },
		}).catch(() => null);
		return { idempotencyKey, record: reclaimed, reclaimed: true };
	}

	if (status === 'processing') {
		if (idempotencyRecordAgeMs(record) > staleMs) {
			const recovered = await idempotency.reset(record.id, {
				payload: { atPeriodEnd, actor, recovered: true },
			});
			if (!recovered) {
				throw httpError(502, 'Idempotency recovery failed', 'IDEMPOTENCY_RECLAIM_FAILED');
			}
			await auditFn({
				action: 'Cancellation claim recovered — abandoned processing',
				eventType: 'cancelled',
				workspaceKey,
				actor,
				provider: providerCode,
				idempotencyKey,
				severity: 'warn',
				metadata: { recovered: true },
			}).catch(() => null);
			return { idempotencyKey, record: recovered, recovered: true };
		}
		await auditFn({
			action: 'Cancellation duplicate — operation in progress',
			eventType: 'cancelled',
			workspaceKey,
			actor,
			provider: providerCode,
			idempotencyKey,
			severity: 'info',
			metadata: { inProgress: true },
		}).catch(() => null);
		throw httpError(409, 'Cancellation already in progress', 'CANCELLATION_IN_PROGRESS');
	}

	throw httpError(409, 'Cancellation idempotency conflict', 'CANCELLATION_IDEMPOTENCY_CONFLICT');
}

async function applyScheduledCancellationUpdate(subscription, pb, fields = {}) {
	await pb.collection('workspace_subscriptions').update(subscription.id, {
		cancel_at_period_end: true,
		billing_status: 'cancel_scheduled',
		...fields,
	});
}

async function applyImmediateCancellationUpdate(subscription, pb, loadPlanFn, syncFn, workspaceKey, actor, source = 'system') {
	const free = await loadPlanFn('free');
	await pb.collection('workspace_subscriptions').update(subscription.id, {
		status: 'canceled',
		billing_status: 'canceled',
		cancel_at_period_end: false,
		plan: free?.id || subscription.plan,
		...(free ? { seats: seatsForPlanAssignment(free) } : {}),
	});
	if (free) {
		await syncFn({
			workspaceKey,
			plan: free,
			subscriptionId: subscription.id,
			actor,
			source,
		});
	}
}

async function defaultLoadSubscription(workspaceKey, pb) {
	return pb.collection('workspace_subscriptions').getFirstListItem(
		pb.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
}

async function defaultLoadPlan(planIdOrSlug, pb) {
	if (!planIdOrSlug) return null;
	const byId = await pb.collection('plans').getOne(planIdOrSlug).catch(() => null);
	if (byId) return byId;
	return pb.collection('plans').getFirstListItem(
		pb.filter('slug = {:slug}', { slug: String(planIdOrSlug) }),
		{ requestKey: null },
	).catch(() => null);
}

/**
 * Phase 4.3-A — Fail-closed, remote-first, provider-aware user cancellation.
 * Phase 4.3-D — Deterministic idempotency claim before provider/local mutation.
 * Uses subscription.provider (not global billing config) for provider selection.
 */
export async function cancelSubscription(workspaceKey, { actor = 'user', atPeriodEnd = true, deps = {} } = {}) {
	const pb = deps.client || (await import('../../utils/pocketbaseClient.js')).default;
	const loadSub = deps.loadSubscription || ((key) => defaultLoadSubscription(key, pb));
	const loadPlanFn = deps.loadPlan || ((slug) => defaultLoadPlan(slug, pb));
	const syncFn = deps.syncEntitlementMirrors
		|| (await import('./entitlement-sync.js')).syncEntitlementMirrors;
	const auditFn = deps.logBillingAction
		|| (await import('./audit.js')).logBillingAction;
	const resolveProvider = deps.getBillingProvider
		|| (await import('./providers/index.js')).getBillingProvider;
	const idempotency = await resolveIdempotency(deps);
	const staleMs = deps.cancellationProcessingStaleMs ?? CANCELLATION_IDEMPOTENCY_STALE_MS;

	const subscription = await loadSub(workspaceKey);
	if (!subscription) {
		throw httpError(404, 'Subscription not found', 'NOT_FOUND');
	}

	const providerResolution = resolveSubscriptionProviderCode(subscription);
	if (!providerResolution.ok) {
		await auditFn({
			action: 'Cancellation failed — unsupported provider',
			eventType: 'cancelled',
			workspaceKey,
			workspaceName: subscription.workspace_name || workspaceKey,
			actor,
			provider: providerResolution.raw,
			severity: 'warn',
			metadata: { reason: 'unsupported_provider' },
		}).catch(() => null);
		throw httpError(
			422,
			`Unsupported subscription provider: ${providerResolution.raw}`,
			'UNSUPPORTED_PROVIDER',
		);
	}

	const providerCode = providerResolution.code;
	const workspaceName = subscription.workspace_name || workspaceKey;

	if (isRefundPendingCancellation(subscription)) {
		await auditFn({
			action: 'Cancellation skipped — refund pending',
			eventType: 'cancelled',
			workspaceKey,
			workspaceName,
			actor,
			provider: providerCode,
			severity: 'info',
			metadata: { refundPending: true, preserved: true },
		}).catch(() => null);
		return {
			cancelled: true,
			refundPending: true,
			preserved: true,
			atPeriodEnd: Boolean(subscription.cancel_at_period_end),
		};
	}

	if (isAlreadyCancelScheduled(subscription)) {
		return { cancelled: true, alreadyScheduled: true, atPeriodEnd: true };
	}

	if (isAlreadyTerminatedSubscription(subscription)) {
		return { cancelled: true, alreadyCanceled: true };
	}

	const logRemoteFailure = async (reason, metadata = {}) => {
		await auditFn({
			action: 'Cancellation failed — remote provider',
			eventType: 'cancelled',
			workspaceKey,
			workspaceName,
			actor,
			provider: providerCode,
			severity: 'warn',
			metadata: { reason, atPeriodEnd, ...metadata },
		}).catch(() => null);
	};

	const providerSubscriptionId = resolveProviderSubscriptionId(subscription, providerCode);
	const idempotencyIdentity = providerSubscriptionId || subscription.id;

	if (!isLocalOnlyCancellation(providerCode)) {
		if (!REMOTE_CANCEL_PROVIDERS.includes(providerCode)) {
			await logRemoteFailure('unsupported_provider', { providerCode });
			throw httpError(422, `Unsupported subscription provider: ${providerCode}`, 'UNSUPPORTED_PROVIDER');
		}
		if (!providerSubscriptionId) {
			await logRemoteFailure('provider_subscription_id_missing');
			throw httpError(422, 'Provider subscription ID is required for cancellation', 'PROVIDER_SUBSCRIPTION_ID_MISSING');
		}
	}

	let provider;
	if (!isLocalOnlyCancellation(providerCode)) {
		try {
			provider = await resolveProvider(providerCode);
		} catch (error) {
			await logRemoteFailure('provider_resolution_failed', { error: error?.message || String(error) });
			throw httpError(502, 'Billing provider unavailable', 'PROVIDER_UNAVAILABLE');
		}

		if (!provider?.ready) {
			await logRemoteFailure('provider_not_ready');
			throw httpError(502, 'Billing provider is not ready', 'PROVIDER_NOT_READY');
		}
	}

	const claimResult = await acquireCancellationClaim({
		workspaceKey,
		providerCode,
		idempotencyIdentity,
		atPeriodEnd,
		actor,
		auditFn,
		idempotency,
		staleMs,
	});

	if (claimResult.shortCircuit) {
		return claimResult.shortCircuit;
	}

	const idemRecord = claimResult.record;
	const idempotencyKey = claimResult.idempotencyKey;
	let idemFinalized = false;

	const finalizeFailure = async (message) => {
		if (!idemFinalized && idemRecord?.id) {
			await idempotency.fail(idemRecord.id, message).catch(() => null);
			idemFinalized = true;
		}
	};

	try {
		if (isLocalOnlyCancellation(providerCode)) {
			if (atPeriodEnd) {
				await applyScheduledCancellationUpdate(subscription, pb);
			} else {
				await applyImmediateCancellationUpdate(
					subscription,
					pb,
					loadPlanFn,
					syncFn,
					workspaceKey,
					actor,
					'user_cancel',
				);
			}
			const result = { cancelled: true, atPeriodEnd, localOnly: true };
			await idempotency.complete(idemRecord.id, result);
			idemFinalized = true;
			await auditFn({
				action: atPeriodEnd ? 'Cancellation scheduled (local)' : 'Subscription cancelled (local)',
				eventType: 'cancelled',
				workspaceKey,
				workspaceName,
				actor,
				provider: providerCode || 'none',
				idempotencyKey,
				metadata: { localOnly: true, atPeriodEnd },
			}).catch(() => null);
			return result;
		}

		let remoteResult;
		try {
			remoteResult = await provider.cancelSubscription({
				workspaceKey,
				providerSubscriptionId,
				atPeriodEnd,
			});
		} catch (error) {
			await logRemoteFailure('provider_cancel_threw', {
				error: error?.message || String(error),
				code: error?.code || error?.errorCode || '',
				idempotencyKey,
			});
			await idempotency.fail(idemRecord.id, error?.message || String(error));
			idemFinalized = true;
			if (error?.status && error?.errorCode) throw error;
			throw httpError(
				error?.status || 502,
				error?.message || 'Provider cancellation failed',
				error?.errorCode || error?.code || 'PROVIDER_CANCEL_FAILED',
			);
		}

		if (!remoteResult?.cancelled) {
			await logRemoteFailure('provider_cancel_not_confirmed', {
				message: remoteResult?.message || 'Provider did not confirm cancellation',
				idempotencyKey,
			});
			await idempotency.fail(idemRecord.id, remoteResult?.message || 'Provider did not confirm cancellation');
			idemFinalized = true;
			throw httpError(
				502,
				remoteResult?.message || 'Provider cancellation was not confirmed',
				'PROVIDER_CANCEL_FAILED',
			);
		}

		if (atPeriodEnd) {
			await applyScheduledCancellationUpdate(subscription, pb);
		} else {
			await applyImmediateCancellationUpdate(
				subscription,
				pb,
				loadPlanFn,
				syncFn,
				workspaceKey,
				actor,
				providerCode === 'paddle' ? 'paddle_webhook' : 'system',
			);
		}

		const result = { cancelled: true, atPeriodEnd, remoteConfirmed: true };
		await idempotency.complete(idemRecord.id, result);
		idemFinalized = true;
		await auditFn({
			action: atPeriodEnd ? 'Cancellation scheduled' : 'Subscription cancelled',
			eventType: 'cancelled',
			workspaceKey,
			workspaceName,
			actor,
			provider: providerCode,
			idempotencyKey,
			metadata: { atPeriodEnd, providerSubscriptionId, remoteConfirmed: true },
		}).catch(() => null);
		return result;
	} catch (error) {
		await finalizeFailure(error?.message || String(error));
		throw error;
	}
}
