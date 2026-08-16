/**
 * CR-P1-1 — reserve workspace credits before any Pinterest publish API call.
 *
 * Lives in the claimed worker (processJob), not at enqueue. Queued / scheduled
 * jobs hold no credits until a worker is about to call Pinterest (token refresh
 * or createPin). Retries use a new idempotency key so they cannot reuse a prior
 * reservation.
 *
 * Wallet identity is an explicit workspace key only. Never fall back to owner/user id.
 * Cost comes from beginFeatureReservation → resolveFeatureCost('pin_publish').
 * Credits-engine is loaded lazily so tests can inject begin/settle without PocketBase.
 */

export const PIN_PUBLISH_CREDIT_FEATURE = 'pin_publish';
export const PIN_PUBLISH_CREDIT_UNITS = 1;

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
export function readPinterestPublishWorkspaceKey(job) {
	const direct = trimStr(job?.workspace_key || job?.workspaceKey);
	if (direct) return direct;
	const expanded = job?.workspace;
	if (expanded && typeof expanded === 'object' && !Array.isArray(expanded)) {
		return trimStr(expanded.workspace_key);
	}
	return '';
}

export function pinterestPublishCreditIdempotencyKey(job) {
	const jobId = trimStr(job?.id);
	const attempt = Number(job?.attempt_count) || 0;
	return `pin-publish:${jobId}:attempt:${attempt}`;
}

/**
 * Fail closed when the job has no explicit workspace key.
 * Optional getWorkspace(id) may resolve workspaces.workspace_key from job.workspace.
 * Never uses owner / user id as the wallet key.
 */
export async function requirePinterestPublishWorkspaceKey(job, deps = {}) {
	const stored = readPinterestPublishWorkspaceKey(job);
	if (stored) return stored;

	const workspaceId = publishJobFieldId(job?.workspace);
	if (workspaceId && typeof deps.getWorkspace === 'function') {
		const workspace = await deps.getWorkspace(workspaceId);
		const key = trimStr(workspace?.workspace_key);
		if (key) return key;
	}

	throw httpError(422, 'workspaceKey is required', 'WORKSPACE_KEY_REQUIRED');
}

/**
 * Reserve 1 pin_publish credit, run Pinterest provider work, then commit or release.
 * Inactive/committed reservations for this attempt do not call the provider.
 */
export async function withPinterestPublishCredits(job, execute, deps = {}) {
	if (typeof execute !== 'function') {
		throw httpError(422, 'execute callback is required', 'VALIDATION_ERROR');
	}

	const jobId = trimStr(job?.id);
	if (!jobId) {
		throw httpError(422, 'Pinterest publish job id is required', 'VALIDATION_ERROR');
	}

	const workspaceKey = await requirePinterestPublishWorkspaceKey(job, deps);
	const begin = deps.beginFeatureReservation
		|| (await import('./credits-engine.js')).beginFeatureReservation;
	const settle = deps.settleFeatureReservation
		|| (await import('./credits-engine.js')).settleFeatureReservation;
	const actor = publishJobFieldId(job?.owner) || 'system';
	const idempotencyKey = pinterestPublishCreditIdempotencyKey(job);

	const reservation = await begin({
		workspaceKey,
		feature: PIN_PUBLISH_CREDIT_FEATURE,
		units: PIN_PUBLISH_CREDIT_UNITS,
		reason: 'Pinterest pin published',
		actorUserId: actor,
		referenceId: jobId,
		idempotencyKey,
		ttlMs: deps.ttlMs || 15 * 60 * 1000,
		metadata: {
			source: 'pinterest-publish-queue',
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
			'Reservation already committed for this Pinterest publish attempt',
			'CREDIT_RESERVATION_COMMITTED',
		);
	}
	if (status !== 'reserved') {
		throw httpError(
			409,
			'Reservation is not active for this Pinterest publish attempt',
			'CREDIT_RESERVATION_INACTIVE',
		);
	}

	const reservationId = trimStr(reservation?.id);
	if (!reservationId) {
		throw httpError(500, 'Pinterest credit reservation is missing an id', 'CREDIT_RESERVATION_INVALID');
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
