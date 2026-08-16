/**
 * CR-P0-3 — fail-closed credit gate for POST /integrated-ai/stream.
 *
 * Every billable Gemini/OpenAI stream must resolve to a registered stream
 * credit feature (ai_writer | ai_pin_copy) and hold a workspace reservation
 * before provider work. Unknown/missing features never call beginFeatureReservation
 * (credits-engine resolveFeatureCost would otherwise default unknown keys to 1).
 *
 * Wallet identity is an explicit workspace key only. Never fall back to owner/user id.
 *
 * Free mode (documented): Writer length continuation — singleShot + writerContinuation.
 * That request reuses the first-shot ai_writer reservation and does not charge again.
 */

export const WRITER_CREDIT_FEATURE = 'ai_writer';
export const PIN_COPY_CREDIT_FEATURE = 'ai_pin_copy';
export const STREAM_CREDIT_FEATURES = Object.freeze([
	WRITER_CREDIT_FEATURE,
	PIN_COPY_CREDIT_FEATURE,
]);

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function trimStr(value) {
	return String(value || '').trim();
}

function isTruthyFlag(value) {
	const raw = String(value ?? '').trim().toLowerCase();
	return raw === '1' || raw === 'true' || raw === 'yes';
}

export function isRegisteredStreamCreditFeature(feature) {
	return STREAM_CREDIT_FEATURES.includes(trimStr(feature).toLowerCase());
}

export function requireStreamWorkspaceKey(workspaceKey) {
	const key = trimStr(workspaceKey);
	if (!key) {
		throw httpError(422, 'workspaceKey is required', 'WORKSPACE_KEY_REQUIRED');
	}
	return key;
}

export function streamCreditIdempotencyKey({
	creditFeature,
	idempotencyKey = '',
	workspaceKey = '',
} = {}) {
	const provided = trimStr(idempotencyKey).slice(0, 120);
	if (provided) return provided;
	const feature = isRegisteredStreamCreditFeature(creditFeature)
		? trimStr(creditFeature).toLowerCase()
		: 'stream';
	const prefix = feature === PIN_COPY_CREDIT_FEATURE ? 'ai-pin-copy' : 'ai-writer';
	const ws = trimStr(workspaceKey) || 'unknown-workspace';
	return `${prefix}:${ws}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`.slice(0, 120);
}

/**
 * Resolve whether this stream is billable, a Writer continuation (free),
 * or invalid. Does not infer a feature from owner/user id.
 *
 * @returns {{ mode: 'billable'|'writer_continuation', creditFeature: string }}
 */
export function resolveIntegratedAiStreamCreditIntent({
	singleShot = false,
	writerContinuation = false,
	creditFeature = '',
} = {}) {
	const shot = typeof singleShot === 'boolean' ? singleShot : isTruthyFlag(singleShot);
	const continuation = typeof writerContinuation === 'boolean'
		? writerContinuation
		: isTruthyFlag(writerContinuation);
	const raw = trimStr(creditFeature).toLowerCase();

	if (raw && !isRegisteredStreamCreditFeature(raw)) {
		throw httpError(
			422,
			'creditFeature is not a registered stream credit feature',
			'CREDIT_FEATURE_UNKNOWN',
		);
	}

	if (continuation && shot && (!raw || raw === WRITER_CREDIT_FEATURE)) {
		return {
			mode: 'writer_continuation',
			creditFeature: WRITER_CREDIT_FEATURE,
		};
	}

	if (raw) {
		return { mode: 'billable', creditFeature: raw };
	}

	if (shot && !continuation) {
		return { mode: 'billable', creditFeature: WRITER_CREDIT_FEATURE };
	}

	throw httpError(422, 'creditFeature is required', 'CREDIT_FEATURE_REQUIRED');
}

/**
 * Reserve 1 unit of the resolved stream feature immediately before provider work.
 * Continuation mode returns a no-op reservation (no begin, no provider skip).
 */
export async function reserveIntegratedAiStreamCredits(input = {}, deps = {}) {
	const intent = input.intent || resolveIntegratedAiStreamCreditIntent(input);
	if (intent.mode === 'writer_continuation') {
		return {
			intent,
			reservation: null,
			settle: async () => ({ settled: 'noop', reservation: null }),
		};
	}

	const workspaceKey = requireStreamWorkspaceKey(input.workspaceKey);
	const begin = deps.beginFeatureReservation
		|| (await import('./credits-engine.js')).beginFeatureReservation;
	const settleFn = deps.settleFeatureReservation
		|| (await import('./credits-engine.js')).settleFeatureReservation;
	const actor = trimStr(input.actorUserId) || 'system';
	const idempotencyKey = streamCreditIdempotencyKey({
		creditFeature: intent.creditFeature,
		idempotencyKey: input.idempotencyKey,
		workspaceKey,
	});

	const reservation = await begin({
		workspaceKey,
		feature: intent.creditFeature,
		units: 1,
		reason: intent.creditFeature === PIN_COPY_CREDIT_FEATURE
			? 'AI Pin copy generation'
			: 'AI Writer article generation',
		actorUserId: actor,
		referenceId: trimStr(input.referenceId).slice(0, 120),
		idempotencyKey,
		ttlMs: input.ttlMs || 20 * 60 * 1000,
		metadata: {
			source: 'integrated-ai/stream',
			singleShot: Boolean(input.singleShot),
			writerContinuation: Boolean(input.writerContinuation),
			creditFeature: intent.creditFeature,
			...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
		},
		wallet: input.wallet || null,
	});

	if (reservation?.noop) {
		return {
			intent,
			reservation,
			settle: async () => ({ settled: 'noop', reservation }),
		};
	}

	const status = trimStr(reservation?.status).toLowerCase();
	if (status === 'committed') {
		throw httpError(
			409,
			'Reservation already committed for this stream attempt',
			'CREDIT_RESERVATION_COMMITTED',
		);
	}
	if (status !== 'reserved') {
		throw httpError(
			409,
			'Reservation is not active for this stream attempt',
			'CREDIT_RESERVATION_INACTIVE',
		);
	}

	const reservationId = trimStr(reservation?.id);
	if (!reservationId) {
		throw httpError(500, 'Stream credit reservation is missing an id', 'CREDIT_RESERVATION_INVALID');
	}

	return {
		intent,
		reservation,
		settle: async ({ success } = {}) => settleFn(reservationId, {
			success: Boolean(success),
			actor,
			metadata: {
				source: 'integrated-ai/stream',
				feature: intent.creditFeature,
			},
		}),
	};
}

/**
 * Test/sync helper: reserve → execute provider → commit | release.
 * The HTTP route settles asynchronously via onGenerationSettled because
 * stream() returns a PassThrough before tokens arrive.
 */
export async function withIntegratedAiStreamCredits(input, execute, deps = {}) {
	if (typeof execute !== 'function') {
		throw httpError(422, 'execute callback is required', 'VALIDATION_ERROR');
	}
	const gate = await reserveIntegratedAiStreamCredits(input, deps);
	if (gate.intent.mode === 'writer_continuation' || gate.reservation?.noop) {
		return execute(gate);
	}
	try {
		const result = await execute(gate);
		await gate.settle({ success: true });
		return result;
	} catch (error) {
		await gate.settle({ success: false }).catch(() => null);
		throw error;
	}
}
