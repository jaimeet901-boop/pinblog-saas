import {
	buildSubscriptionReconcileIdempotencyKey,
	RECONCILIATION_IDEMPOTENCY_STALE_MS,
} from './reconciliation-idempotency-keys.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
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

export {
	buildSubscriptionReconcileIdempotencyKey,
	RECONCILIATION_IDEMPOTENCY_STALE_MS,
};

/**
 * Phase 4.4-E — Claim-before-mutate idempotency for Paddle subscription reconciliation.
 */
export async function acquireReconciliationClaim({
	subscriptionId = '',
	eventId = '',
	workspaceKey = '',
	provider = 'paddle',
	actor = 'webhook:paddle',
	deps = {},
	staleMs = RECONCILIATION_IDEMPOTENCY_STALE_MS,
} = {}) {
	const idempotencyKey = buildSubscriptionReconcileIdempotencyKey(subscriptionId, eventId, provider);
	if (!idempotencyKey) {
		return { ok: false, error: 'reconciliation_idempotency_key_missing' };
	}

	const idempotency = await resolveIdempotency(deps);
	const claim = await idempotency.claim({
		idempotencyKey,
		scope: 'subscription_reconcile',
		workspaceKey,
		provider,
		eventType: 'subscription_reconciled',
		payload: { subscriptionId, eventId, actor },
	});

	if (claim.claimed) {
		return { ok: true, idempotencyKey, record: claim.record, claimed: true };
	}

	const record = claim.record || {};
	const status = String(record.status || '').trim();

	if (status === 'completed' && record.result && typeof record.result === 'object') {
		return {
			ok: true,
			idempotencyKey,
			record,
			shortCircuit: { ...record.result, idempotent: true, duplicate: true },
		};
	}

	if (status === 'failed') {
		const reclaimed = await idempotency.reset(record.id, {
			payload: { subscriptionId, eventId, actor, retry: true },
		});
		if (!reclaimed) {
			return { ok: false, error: 'reconciliation_idempotency_reclaim_failed' };
		}
		return { ok: true, idempotencyKey, record: reclaimed, reclaimed: true, claimed: true };
	}

	if (status === 'processing') {
		if (idempotencyRecordAgeMs(record) > staleMs) {
			const recovered = await idempotency.reset(record.id, {
				payload: { subscriptionId, eventId, actor, recovered: true },
			});
			if (!recovered) {
				return { ok: false, error: 'reconciliation_idempotency_recovery_failed' };
			}
			return { ok: true, idempotencyKey, record: recovered, recovered: true, claimed: true };
		}
		return {
			ok: false,
			error: 'reconciliation_in_progress',
			inProgress: true,
			idempotencyKey,
		};
	}

	return { ok: false, error: 'reconciliation_idempotency_conflict', idempotencyKey };
}

export async function completeReconciliationIdempotency(recordId, result, deps = {}) {
	const idempotency = await resolveIdempotency(deps);
	return idempotency.complete(recordId, result);
}

export async function failReconciliationIdempotency(recordId, message, deps = {}) {
	const idempotency = await resolveIdempotency(deps);
	return idempotency.fail(recordId, message);
}
