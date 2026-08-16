/**
 * CR-P0-2 — reserve workspace credits before any AI image provider call.
 *
 * Lives in the claimed worker (processJob), not at enqueue. Queued / bulk jobs
 * hold no credits until a worker is about to call OpenAI, Fal/Flux, or Gemini.
 * Retries use a new idempotency key so they cannot reuse a prior reservation.
 *
 * Wallet identity is an explicit workspace key only. Never fall back to owner/user id.
 * Credits-engine is loaded lazily so tests can inject begin/settle without PocketBase.
 */

export const AI_IMAGE_CREDIT_FEATURE = 'ai_image';
export const AI_IMAGE_CREDIT_UNITS = 1;

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function trimStr(value) {
	return String(value || '').trim();
}

export function imageJobFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

export function parseJobPromptPayload(raw) {
	let value = raw;
	if (Buffer.isBuffer(value)) {
		value = value.toString('utf8');
	}
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			value = {};
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	return value;
}

/**
 * Read a stored workspace key from the job. Does not use owner / user id.
 */
export function readImageJobWorkspaceKey(job) {
	const direct = trimStr(job?.workspace_key || job?.workspaceKey);
	if (direct) return direct;
	const payload = parseJobPromptPayload(job?.prompt_payload);
	return trimStr(payload.creditWorkspaceKey || payload.workspaceKey);
}

export function imageCreditIdempotencyKey(job) {
	const jobId = trimStr(job?.id);
	const attempt = Number(job?.attempt_count) || 0;
	return `ai-image:${jobId}:attempt:${attempt}`;
}

/**
 * Fail closed when the job has no explicit workspace key.
 * Optional getWorkspace(id) may resolve workspaces.workspace_key from job.workspace.
 * Never uses owner / user id as the wallet key.
 */
export async function requireImageJobWorkspaceKey(job, deps = {}) {
	const stored = readImageJobWorkspaceKey(job);
	if (stored) return stored;

	const workspaceId = imageJobFieldId(job?.workspace);
	if (workspaceId && typeof deps.getWorkspace === 'function') {
		const workspace = await deps.getWorkspace(workspaceId);
		const key = trimStr(workspace?.workspace_key);
		if (key) return key;
	}

	throw httpError(422, 'workspaceKey is required', 'WORKSPACE_KEY_REQUIRED');
}

/**
 * Reserve 1 ai_image credit, run provider work, then commit or release.
 * Inactive/committed reservations for this attempt do not call the provider.
 */
export async function withAiImageCredits(job, execute, deps = {}) {
	if (typeof execute !== 'function') {
		throw httpError(422, 'execute callback is required', 'VALIDATION_ERROR');
	}

	const jobId = trimStr(job?.id);
	if (!jobId) {
		throw httpError(422, 'Image job id is required', 'VALIDATION_ERROR');
	}

	const workspaceKey = await requireImageJobWorkspaceKey(job, deps);
	const begin = deps.beginFeatureReservation
		|| (await import('./credits-engine.js')).beginFeatureReservation;
	const settle = deps.settleFeatureReservation
		|| (await import('./credits-engine.js')).settleFeatureReservation;
	const actor = imageJobFieldId(job?.owner) || 'system';
	const idempotencyKey = imageCreditIdempotencyKey(job);

	const reservation = await begin({
		workspaceKey,
		feature: AI_IMAGE_CREDIT_FEATURE,
		units: AI_IMAGE_CREDIT_UNITS,
		reason: 'AI image generation',
		actorUserId: actor,
		referenceId: jobId,
		idempotencyKey,
		ttlMs: deps.ttlMs || 15 * 60 * 1000,
		metadata: {
			source: 'ai-pin-image-queue',
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
			'Reservation already committed for this image attempt',
			'CREDIT_RESERVATION_COMMITTED',
		);
	}
	if (status !== 'reserved') {
		throw httpError(
			409,
			'Reservation is not active for this image attempt',
			'CREDIT_RESERVATION_INACTIVE',
		);
	}

	const reservationId = trimStr(reservation?.id);
	if (!reservationId) {
		throw httpError(500, 'Image credit reservation is missing an id', 'CREDIT_RESERVATION_INVALID');
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
