/**
 * Calendar mutation URL helpers (C5).
 * Visual Calendar UI unchanged — only the write endpoint path moves to the facade router.
 */

/**
 * @param {object} job  CalendarPage event row (has facadeId / channel / id)
 */
export function resolveCalendarEventId(job = {}) {
	if (job.facadeId) return String(job.facadeId).trim();
	const channel = String(job.channel || '').trim();
	const refId = String(job.refId || job.id || '').trim();
	if (channel && refId) return `${channel}:${refId}`;
	throw new Error('Calendar event is missing facadeId/channel for mutation routing');
}

/**
 * @param {object} job
 * @param {'reschedule'|'cancel'|'retry'} action
 */
export function buildCalendarMutationUrl(job, action) {
	const eventId = encodeURIComponent(resolveCalendarEventId(job));
	const normalized = String(action || '').trim().toLowerCase();
	return `/workspace/v1/calendar/events/${eventId}/${normalized}`;
}
