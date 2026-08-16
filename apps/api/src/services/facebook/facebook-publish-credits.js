/**
 * CR-P1-2 — reserve workspace credits before any Facebook Graph publish call.
 *
 * Lives in the claimed worker (processJob), not at enqueue. Queued / scheduled
 * jobs hold no credits until a worker is about to POST to Graph. Retries use a
 * new idempotency key so they cannot reuse a prior reservation.
 *
 * Wallet identity is an explicit workspace key only. Never fall back to owner/user id.
 * Cost comes from beginFeatureReservation → resolveFeatureCost('facebook_publish').
 * Credits-engine is loaded lazily so tests can inject begin/settle without PocketBase.
 */

export const FACEBOOK_PUBLISH_CREDIT_FEATURE = 'facebook_publish';
export const FACEBOOK_PUBLISH_CREDIT_UNITS = 1;

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function trimStr(value) {
	return String(value || '').trim();
}

export function publishJobFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

/**
 * Read a stored workspace key from the job. Does not use owner / user id.
 */
export function readFacebookPublishWorkspaceKey(job) {
	const direct = trimStr(job?.workspace_key || job?.workspaceKey);
	if (direct) return direct;
	const expanded = job?.workspace;
	if (expanded && typeof expanded === 'object' && !Array.isArray(expanded)) {
		return trimStr(expanded.workspace_key);
	}
	return '';
}

export function facebookPublishCreditIdempotencyKey(job) {
	const jobId = trimStr(job?.id);
	const attempt = Number(job?.attempt_count) || 0;
	return `facebook-publish:${jobId}:attempt:${attempt}`;
}

/** @deprecated Use facebookPublishCreditIdempotencyKey(job) — attempt-scoped. */
export function buildFacebookPublishCreditIdempotencyKey(jobOrId, attemptCount = 0) {
	if (jobOrId && typeof jobOrId === 'object') {
		return facebookPublishCreditIdempotencyKey(jobOrId);
	}
	return facebookPublishCreditIdempotencyKey({
		id: jobOrId,
		attempt_count: attemptCount,
	});
}

/**
 * Fail closed when the job has no explicit workspace key.
 * Optional getWorkspace(id) may resolve workspaces.workspace_key from job.workspace.
 * Never uses owner / user id as the wallet key.
 */
export async function requireFacebookPublishWorkspaceKey(job, deps = {}) {
	const stored = readFacebookPublishWorkspaceKey(job);
	if (stored) return stored;

	const workspaceId = publishJobFieldId(job?.workspace || job?.workspace_id);
	if (workspaceId && typeof deps.getWorkspace === 'function') {
		const workspace = await deps.getWorkspace(workspaceId);
		const key = trimStr(workspace?.workspace_key);
		if (key) return key;
	}

	throw httpError(422, 'workspaceKey is required', 'WORKSPACE_KEY_REQUIRED');
}

/**
 * Reserve 1 facebook_publish credit, run Graph provider work, then commit or release.
 * Inactive/committed reservations for this attempt do not call Graph.
 */
export async function withFacebookPublishCredits(job, execute, deps = {}) {
	if (typeof execute !== 'function') {
		throw httpError(422, 'execute callback is required', 'VALIDATION_ERROR');
	}

	const jobId = trimStr(job?.id);
	if (!jobId) {
		throw httpError(422, 'Facebook publish job id is required', 'VALIDATION_ERROR');
	}

	const workspaceKey = await requireFacebookPublishWorkspaceKey(job, deps);
	const begin = deps.beginFeatureReservation
		|| (await import('../credits-engine.js')).beginFeatureReservation;
	const settle = deps.settleFeatureReservation
		|| (await import('../credits-engine.js')).settleFeatureReservation;
	const actor = publishJobFieldId(job?.owner) || 'system';
	const idempotencyKey = facebookPublishCreditIdempotencyKey(job);

	const reservation = await begin({
		workspaceKey,
		feature: FACEBOOK_PUBLISH_CREDIT_FEATURE,
		units: FACEBOOK_PUBLISH_CREDIT_UNITS,
		reason: 'Facebook post published',
		actorUserId: actor,
		referenceId: jobId,
		idempotencyKey,
		ttlMs: deps.ttlMs || 15 * 60 * 1000,
		metadata: {
			source: 'facebook-publish-queue',
			jobId,
			attempt: Number(job?.attempt_count) || 0,
		},
	});

	if (reservation?.noop) {
		return execute(reservation);
	}

	const status = trimStr(reservation?.status).toLowerCase();
	if (status === 'committed') {
		throw httpError(
			409,
			'Reservation already committed for this Facebook publish attempt',
			'CREDIT_RESERVATION_COMMITTED',
		);
	}
	if (status !== 'reserved') {
		throw httpError(
			409,
			'Reservation is not active for this Facebook publish attempt',
			'CREDIT_RESERVATION_INACTIVE',
		);
	}

	const reservationId = trimStr(reservation?.id);
	if (!reservationId) {
		throw httpError(500, 'Facebook credit reservation is missing an id', 'CREDIT_RESERVATION_INVALID');
	}

	try {
		const result = await execute(reservation);
		await settle(reservationId, {
			success: true,
			actor,
			metadata: { jobId },
		});
		return result;
	} catch (error) {
		await settle(reservationId, {
			success: false,
			actor,
		}).catch(() => null);
		throw error;
	}
}
