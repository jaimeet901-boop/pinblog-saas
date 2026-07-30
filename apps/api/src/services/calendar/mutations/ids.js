/**
 * Calendar mutation id helpers (channel-agnostic).
 * Event ids are `${channel}:${refId}` — same as Scheduled Item ids.
 */

function freezeError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export const CALENDAR_MUTATION_ACTIONS = Object.freeze(['reschedule', 'cancel', 'retry']);

/**
 * @param {string} eventId
 * @returns {{ channel: string, refId: string, eventId: string }}
 */
export function parseCalendarEventId(eventId) {
	const value = String(eventId || '').trim();
	const idx = value.indexOf(':');
	if (idx <= 0 || idx === value.length - 1) {
		throw freezeError(
			422,
			'Calendar event id must be channel:refId (e.g. pinterest:abc123)',
			'VALIDATION_ERROR',
		);
	}
	const channel = value.slice(0, idx).trim().toLowerCase();
	const refId = value.slice(idx + 1).trim();
	if (!channel || !refId) {
		throw freezeError(422, 'Calendar event id must be channel:refId', 'VALIDATION_ERROR');
	}
	return { channel, refId, eventId: `${channel}:${refId}` };
}

export function buildCalendarEventId(channel, refId) {
	const ch = String(channel || '').trim().toLowerCase();
	const id = String(refId || '').trim();
	if (!ch || !id) {
		throw freezeError(422, 'channel and refId are required', 'VALIDATION_ERROR');
	}
	return `${ch}:${id}`;
}

export function assertCalendarMutationAction(action) {
	const normalized = String(action || '').trim().toLowerCase();
	if (!CALENDAR_MUTATION_ACTIONS.includes(normalized)) {
		throw freezeError(
			422,
			`Unsupported calendar mutation "${action}". Allowed: ${CALENDAR_MUTATION_ACTIONS.join(', ')}`,
			'VALIDATION_ERROR',
		);
	}
	return normalized;
}
