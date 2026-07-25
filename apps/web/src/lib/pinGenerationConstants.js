/**
 * Pin Generation — shared stage / status constants.
 * Mirrored in apps/api/src/constants/pin-generation.js
 */

export const PIN_GENERATION_STAGES = Object.freeze([
	'queued',
	'preparing',
	'generating_image',
	'resolving_variables',
	'rendering',
	'exporting',
	'completed',
	'failed',
	'cancelled',
]);

export const PIN_GENERATION_ACTIVE_STAGES = Object.freeze([
	'queued',
	'preparing',
	'generating_image',
	'resolving_variables',
	'rendering',
	'exporting',
]);

export const PIN_GENERATION_TERMINAL_STAGES = Object.freeze([
	'completed',
	'failed',
	'cancelled',
]);

/** Progress hints per stage (UI / mirrors). */
export const PIN_GENERATION_STAGE_PROGRESS = Object.freeze({
	queued: 0,
	preparing: 8,
	generating_image: 35,
	resolving_variables: 55,
	rendering: 75,
	exporting: 90,
	completed: 100,
	failed: 100,
	cancelled: 100,
});

export const PIN_GENERATION_IMAGE_MODES = Object.freeze([
	'generate_ai',
	'use_featured',
	'provided_url',
]);

/** Errors that may be retried by the orchestrator. */
export const PIN_GENERATION_RECOVERABLE_CODES = Object.freeze([
	'PROVIDER_TIMEOUT',
	'PROVIDER_RATE_LIMIT',
	'PROVIDER_TRANSIENT',
	'NETWORK_ERROR',
	'EXPORT_TRANSIENT',
	'UPLOAD_TRANSIENT',
	'QUEUE_BUSY',
]);

export function isPinGenerationStage(value) {
	return PIN_GENERATION_STAGES.includes(String(value || ''));
}

export function isTerminalGenerationStage(value) {
	return PIN_GENERATION_TERMINAL_STAGES.includes(String(value || ''));
}

export function stageProgress(stage) {
	return PIN_GENERATION_STAGE_PROGRESS[stage] ?? 0;
}
