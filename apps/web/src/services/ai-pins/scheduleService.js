/**
 * ScheduleService — recurrence expansion + schedule API calls.
 * No React. Calendar visualization consumes resulting pinterest_publish_jobs.
 */

import apiServerClient from '@/lib/apiServerClient';

export const RECURRENCE_MODES = [
	{ id: 'once', label: 'Publish Once' },
	{ id: 'daily', label: 'Daily' },
	{ id: 'weekly', label: 'Weekly' },
	{ id: 'monthly', label: 'Monthly' },
	{ id: 'yearly', label: 'Yearly' },
	{ id: 'custom', label: 'Custom Recurrence' },
];

function addDays(date, days) {
	const next = new Date(date.getTime());
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function addMonths(date, months) {
	const next = new Date(date.getTime());
	next.setUTCMonth(next.getUTCMonth() + months);
	return next;
}

function addYears(date, years) {
	const next = new Date(date.getTime());
	next.setUTCFullYear(next.getUTCFullYear() + years);
	return next;
}

/**
 * Expand recurrence into concrete UTC ISO timestamps.
 */
export function expandRecurrence({
	mode = 'once',
	startAt,
	endAt = '',
	customIntervalDays = 1,
	maxOccurrences = 52,
}) {
	const start = new Date(startAt);
	if (Number.isNaN(start.getTime())) {
		throw new Error('Invalid start date/time');
	}
	if (mode === 'once') {
		return [start.toISOString()];
	}

	const end = endAt ? new Date(endAt) : null;
	const hardCap = Math.min(Math.max(1, maxOccurrences), 52);
	const dates = [start.toISOString()];
	let cursor = start;

	const step = () => {
		switch (mode) {
			case 'daily':
				return addDays(cursor, 1);
			case 'weekly':
				return addDays(cursor, 7);
			case 'monthly':
				return addMonths(cursor, 1);
			case 'yearly':
				return addYears(cursor, 1);
			case 'custom':
				return addDays(cursor, Math.max(1, Number(customIntervalDays) || 1));
			default:
				return null;
		}
	};

	while (dates.length < hardCap) {
		const next = step();
		if (!next) break;
		if (end && next.getTime() > end.getTime()) break;
		dates.push(next.toISOString());
		cursor = next;
	}

	return dates;
}

/**
 * datetime-local value + timezone → ISO string for API.
 * Browser local interpretation of the datetime-local string is acceptable;
 * server re-resolves with timezone when needed.
 */
export function datetimeLocalToIso(datetimeLocal) {
	if (!datetimeLocal) return '';
	const date = new Date(datetimeLocal);
	if (Number.isNaN(date.getTime())) {
		throw new Error('Invalid date/time');
	}
	return date.toISOString();
}

export function isoToDatetimeLocal(iso) {
	if (!iso) return '';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function postSchedule({ pinIds, accountId, boardId, timezone, scheduledAt, perPinTargets }) {
	const response = await apiServerClient.fetch('/pinterest/schedule', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			pinIds,
			accountId,
			boardId,
			timezone,
			scheduledAt,
			...(perPinTargets && Object.keys(perPinTargets).length ? { perPinTargets } : {}),
		}),
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(body?.message || `Schedule failed (${response.status})`);
	}
	return body;
}

/**
 * Schedule pins once (or first slot). Recurring series handled by caller
 * via duplicate + multi schedule when needed.
 */
export async function schedulePins({
	pinIds,
	accountId,
	boardId,
	timezone,
	scheduledAt,
	perPinTargets,
}) {
	if (!Array.isArray(pinIds) || pinIds.length === 0) {
		throw new Error('Select at least one pin to schedule');
	}
	if (!accountId) throw new Error('Select a Pinterest account');
	if (!boardId) throw new Error('Select a Pinterest board');
	if (!timezone) throw new Error('Timezone is required');
	if (!scheduledAt) throw new Error('Schedule date/time is required');

	return postSchedule({
		pinIds,
		accountId,
		boardId,
		timezone,
		scheduledAt,
		perPinTargets,
	});
}

/**
 * Schedule a recurrence series: first pin at first occurrence;
 * remaining occurrences use provided pinIds (already duplicated).
 * pinIdsByOccurrence: string[][] parallel to occurrence dates.
 */
export async function scheduleRecurrenceSeries({
	occurrenceDates,
	pinIdsByOccurrence,
	accountId,
	boardId,
	timezone,
	perPinTargets,
}) {
	const jobs = [];
	for (let i = 0; i < occurrenceDates.length; i += 1) {
		const pinIds = pinIdsByOccurrence[i] || pinIdsByOccurrence[0];
		const result = await postSchedule({
			pinIds,
			accountId,
			boardId,
			timezone,
			scheduledAt: occurrenceDates[i],
			perPinTargets,
		});
		jobs.push(...(result.jobs || []));
	}
	return { jobs, occurrenceCount: occurrenceDates.length };
}
