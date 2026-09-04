/**
 * Writer Image Resolver — ai_image credit reservation for Fal only (M2-A).
 *
 * Reuses credits-engine begin/settle via import (no engine edits).
 * Idempotency: writer-image:{requestId}:slot:{slotId}
 * Exactly one reservation attempt per slot call (no retry loop here).
 */

import {
	CREDIT_FEATURE_AI_IMAGE,
	CREDIT_UNITS_AI_IMAGE,
} from './types.js';

function trimStr(value) {
	return String(value || '').trim();
}

function creditError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/**
 * @param {{ requestId: string, slotId: string }} params
 */
export function writerImageCreditIdempotencyKey({ requestId, slotId }) {
	const req = trimStr(requestId) || 'unknown-request';
	const slot = trimStr(slotId) || 'unknown-slot';
	return `writer-image:${req}:slot:${slot}`;
}

/**
 * Reserve 1 ai_image credit, run Fal work, commit or release.
 *
 * @param {{
 *   workspaceKey: string,
 *   requestId: string,
 *   slotId: string,
 *   actorUserId?: string,
 * }} params
 * @param {(reservation: object) => Promise<any>} execute
 * @param {{
 *   beginFeatureReservation?: Function,
 *   settleFeatureReservation?: Function,
 *   ttlMs?: number,
 * }} [deps]
 */
export async function withWriterFalCredits(params, execute, deps = {}) {
	if (typeof execute !== 'function') {
		throw creditError(422, 'execute callback is required', 'VALIDATION_ERROR');
	}

	const workspaceKey = trimStr(params?.workspaceKey);
	if (!workspaceKey) {
		throw creditError(422, 'workspaceKey is required', 'WORKSPACE_KEY_REQUIRED');
	}

	const requestId = trimStr(params?.requestId);
	const slotId = trimStr(params?.slotId);
	if (!requestId || !slotId) {
		throw creditError(422, 'requestId and slotId are required', 'VALIDATION_ERROR');
	}

	const begin = deps.beginFeatureReservation
		|| (await import('../credits-engine.js')).beginFeatureReservation;
	const settle = deps.settleFeatureReservation
		|| (await import('../credits-engine.js')).settleFeatureReservation;

	const actor = trimStr(params?.actorUserId) || 'system';
	const idempotencyKey = writerImageCreditIdempotencyKey({ requestId, slotId });

	const reservation = await begin({
		workspaceKey,
		feature: CREDIT_FEATURE_AI_IMAGE,
		units: CREDIT_UNITS_AI_IMAGE,
		reason: 'Writer image Fal generation',
		actorUserId: actor,
		referenceId: `${requestId}:${slotId}`,
		idempotencyKey,
		ttlMs: deps.ttlMs || 15 * 60 * 1000,
		metadata: {
			source: 'writer-image-resolver',
			requestId,
			slotId,
		},
	});

	if (reservation?.noop) {
		return execute(reservation);
	}

	const status = trimStr(reservation?.status).toLowerCase();
	if (status === 'committed') {
		throw creditError(
			409,
			'Reservation already committed for this writer image slot',
			'CREDIT_RESERVATION_COMMITTED',
		);
	}
	if (status !== 'reserved') {
		throw creditError(
			409,
			'Reservation is not active for this writer image slot',
			'CREDIT_RESERVATION_INACTIVE',
		);
	}

	const reservationId = trimStr(reservation?.id);
	if (!reservationId) {
		throw creditError(500, 'Credit reservation is missing an id', 'CREDIT_RESERVATION_INVALID');
	}

	try {
		const result = await execute(reservation);
		await settle(reservationId, {
			success: true,
			actor,
			metadata: { requestId, slotId },
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
