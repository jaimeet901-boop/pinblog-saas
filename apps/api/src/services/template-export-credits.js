/**
 * CR-P1-4 — reserve workspace credits before actual template export work.
 *
 * Lives in the claimed native worker, not at enqueue. Queued export /
 * template_rendering jobs hold no credits until a worker is about to encode.
 * Retries use a new idempotency key so they cannot reuse a prior reservation.
 *
 * Wallet identity is an explicit workspace key only. Never fall back to owner/user id.
 * Cost comes from beginFeatureReservation → resolveFeatureCost('template_export').
 * Credits-engine is loaded lazily so tests can inject begin/settle without PocketBase.
 */

export const TEMPLATE_EXPORT_CREDIT_FEATURE = 'template_export';
export const TEMPLATE_EXPORT_CREDIT_UNITS = 1;

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function trimStr(value) {
	return String(value || '').trim();
}

export function exportJobFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

/**
 * Read a stored workspace key from the job. Does not use owner / user id.
 */
export function readTemplateExportWorkspaceKey(job) {
	const direct = trimStr(job?.workspace_key || job?.workspaceKey);
	if (direct) return direct;
	const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
	const fromPayload = trimStr(payload.creditWorkspaceKey || payload.workspaceKey);
	if (fromPayload) return fromPayload;
	const expanded = job?.workspace;
	if (expanded && typeof expanded === 'object' && !Array.isArray(expanded)) {
		return trimStr(expanded.workspace_key);
	}
	return '';
}

export function templateExportCreditIdempotencyKey(job) {
	const jobId = trimStr(job?.id);
	const attempt = Number(job?.attempt_count) || 0;
	return `template-export:${jobId}:attempt:${attempt}`;
}

/**
 * Fail closed when the job has no explicit workspace key.
 * Optional getWorkspace(id) may resolve workspaces.workspace_key from job.workspace.
 * Never uses owner / user id as the wallet key.
 */
export async function requireTemplateExportWorkspaceKey(job, deps = {}) {
	const stored = readTemplateExportWorkspaceKey(job);
	if (stored) return stored;

	const workspaceId = exportJobFieldId(job?.workspace || job?.workspace_id);
	if (workspaceId && typeof deps.getWorkspace === 'function') {
		const workspace = await deps.getWorkspace(workspaceId);
		const key = trimStr(workspace?.workspace_key);
		if (key) return key;
	}

	throw httpError(422, 'workspaceKey is required', 'WORKSPACE_KEY_REQUIRED');
}

/**
 * Reserve 1 template_export credit, run export work, then commit or release.
 * Inactive/committed reservations for this attempt do not execute export.
 */
export async function withTemplateExportCredits(job, execute, deps = {}) {
	if (typeof execute !== 'function') {
		throw httpError(422, 'execute callback is required', 'VALIDATION_ERROR');
	}

	const jobId = trimStr(job?.id);
	if (!jobId) {
		throw httpError(422, 'Template export job id is required', 'VALIDATION_ERROR');
	}

	const workspaceKey = await requireTemplateExportWorkspaceKey(job, deps);
	const begin = deps.beginFeatureReservation
		|| (await import('./credits-engine.js')).beginFeatureReservation;
	const settle = deps.settleFeatureReservation
		|| (await import('./credits-engine.js')).settleFeatureReservation;
	const actor = exportJobFieldId(job?.owner) || 'system';
	const idempotencyKey = templateExportCreditIdempotencyKey(job);

	const reservation = await begin({
		workspaceKey,
		feature: TEMPLATE_EXPORT_CREDIT_FEATURE,
		units: TEMPLATE_EXPORT_CREDIT_UNITS,
		reason: 'Template export',
		actorUserId: actor,
		referenceId: jobId,
		idempotencyKey,
		ttlMs: deps.ttlMs || 15 * 60 * 1000,
		metadata: {
			source: 'template-export',
			jobId,
			attempt: Number(job?.attempt_count) || 0,
			jobType: trimStr(job?.type) || 'export',
		},
	});

	if (reservation?.noop) {
		return execute(reservation);
	}

	const status = trimStr(reservation?.status).toLowerCase();
	if (status === 'committed') {
		throw httpError(
			409,
			'Reservation already committed for this template export attempt',
			'CREDIT_RESERVATION_COMMITTED',
		);
	}
	if (status !== 'reserved') {
		throw httpError(
			409,
			'Reservation is not active for this template export attempt',
			'CREDIT_RESERVATION_INACTIVE',
		);
	}

	const reservationId = trimStr(reservation?.id);
	if (!reservationId) {
		throw httpError(500, 'Template export credit reservation is missing an id', 'CREDIT_RESERVATION_INVALID');
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

/**
 * Native worker cannot encode pixels (RenderTarget is client/worker-side).
 * When this is false, claimed jobs fail NOT_IMPLEMENTED without charging.
 */
export const NATIVE_TEMPLATE_PIXEL_EXPORT_IMPLEMENTED = false;

export function isNativeTemplatePixelExportImplemented() {
	return NATIVE_TEMPLATE_PIXEL_EXPORT_IMPLEMENTED === true;
}

export function createTemplateExportNotImplementedError(jobType = 'export') {
	const error = new Error(`NOT_IMPLEMENTED: ${jobType} worker is not configured`);
	error.errorCode = 'NOT_IMPLEMENTED';
	error.retryable = false;
	return error;
}

/**
 * Actual encode hook. Native API has no RenderTarget; tests inject encodeTemplateExport.
 */
export async function executeTemplatePixelExport(job, deps = {}) {
	if (typeof deps.encodeTemplateExport === 'function') {
		return deps.encodeTemplateExport(job);
	}
	if (!isNativeTemplatePixelExportImplemented()) {
		throw createTemplateExportNotImplementedError(job?.type || 'export');
	}
	throw createTemplateExportNotImplementedError(job?.type || 'export');
}

/**
 * Claimed native worker entry: fail closed without charging when encode is
 * NOT_IMPLEMENTED. Otherwise reserve immediately before encode, then commit/release.
 */
export async function processClaimedTemplateExportJob(job, deps = {}) {
	// Native RenderTarget encode is not implemented. Do not reserve/charge
	// unless a real encoder is wired (tests inject encodeTemplateExport).
	if (typeof deps.encodeTemplateExport !== 'function') {
		throw createTemplateExportNotImplementedError(job?.type || 'export');
	}

	return withTemplateExportCredits(job, async () => (
		executeTemplatePixelExport(job, deps)
	), deps);
}
