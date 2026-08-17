/**
 * AI-CROSS-02 Phase 1 — studio channel for ai_pins.
 * Allowlist is pinterest | facebook. Empty/null stored channel is legacy and stays visible
 * in both libraries. Never use normalizeStudioPromptChannel for persistence (it maps unknown → pinterest).
 */
import { parseGenerationHistoryChannel } from './ai-pin-generation-history-query.js';

export const AI_PIN_CHANNELS = Object.freeze(['pinterest', 'facebook']);

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	if (errorCode) error.errorCode = errorCode;
	return error;
}

export function recordChannel(record) {
	if (record == null) return '';
	const raw = record.channel;
	if (raw == null) return '';
	return String(raw).trim().toLowerCase();
}

export function parseOptionalStudioChannel(value) {
	return parseGenerationHistoryChannel(value);
}

export function parseRequiredStudioChannel(value) {
	const parsed = parseGenerationHistoryChannel(value);
	if (!parsed) {
		throw httpError(422, 'channel must be facebook or pinterest', 'VALIDATION_ERROR');
	}
	return parsed;
}

export function requestStudioChannel(req) {
	return parseOptionalStudioChannel(req?.query?.channel ?? req?.body?.channel);
}

export function pinVisibleInLibrary(record, channel) {
	const requested = parseRequiredStudioChannel(channel);
	const stored = recordChannel(record);
	return !stored || stored === requested;
}

export function buildAiPinsLibraryChannelClause(channel) {
	const requested = parseRequiredStudioChannel(channel);
	return `(channel = "${requested}" || channel = "" || channel = null)`;
}

export function pinMatchesStudioChannel(record, requested) {
	if (!requested) return true;
	const stored = recordChannel(record);
	if (!stored) return true;
	return stored === requested;
}

export function assertPinStudioChannel(record, requested, { notFoundMessage = 'Pin not found' } = {}) {
	if (!pinMatchesStudioChannel(record, requested)) {
		throw httpError(404, notFoundMessage, 'NOT_FOUND');
	}
	return record;
}

export function isPinPublishableOnChannel(record, publishChannel) {
	const stored = recordChannel(record);
	return !stored || stored === publishChannel;
}

export function stampDraftChannel({ requestChannel, sourceRecord = null } = {}) {
	if (sourceRecord) {
		return recordChannel(sourceRecord) || '';
	}
	return requestChannel;
}

export function assertImageJobPinChannel(pin, requestedChannel) {
	if (!pin) return pin;
	const stored = recordChannel(pin);
	if (!stored) return pin;
	if (!requestedChannel || stored !== requestedChannel) {
		throw httpError(404, 'Pin not found', 'NOT_FOUND');
	}
	return pin;
}
