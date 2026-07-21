/**
 * Convert a wall-clock datetime in a named IANA timezone to a UTC ISO string.
 * Accepts:
 * - Absolute timestamps with Z/offset (returned as normalized ISO)
 * - Wall times like "2026-07-21T15:30" or "2026-07-21T15:30:00" + timezone
 */
export function resolveScheduledAtUtc({ scheduledAt, timezone = 'UTC' }) {
	const raw = String(scheduledAt || '').trim();
	if (!raw) {
		const error = new Error('scheduledAt is required');
		error.status = 422;
		throw error;
	}

	if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
		const absolute = new Date(raw);
		if (Number.isNaN(absolute.getTime())) {
			const error = new Error('scheduledAt must be a valid date/time');
			error.status = 422;
			throw error;
		}
		return absolute.toISOString();
	}

	const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
	if (!match) {
		const error = new Error('scheduledAt must be YYYY-MM-DDTHH:mm[:ss] or an absolute ISO timestamp');
		error.status = 422;
		throw error;
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6] || 0);
	const tz = String(timezone || 'UTC').trim() || 'UTC';

	try {
		Intl.DateTimeFormat('en-US', { timeZone: tz });
	} catch {
		const error = new Error(`Invalid timezone: ${tz}`);
		error.status = 422;
		throw error;
	}

	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	});

	const readParts = (ms) => {
		const parts = formatter.formatToParts(new Date(ms));
		const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
		return {
			year: get('year'),
			month: get('month'),
			day: get('day'),
			hour: get('hour'),
			minute: get('minute'),
			second: get('second'),
		};
	};

	let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
	for (let i = 0; i < 4; i += 1) {
		const shown = readParts(utcMs);
		const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
		const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
		const delta = targetAsUtc - shownAsUtc;
		if (delta === 0) {
			break;
		}
		utcMs += delta;
	}

	const verified = readParts(utcMs);
	if (
		verified.year !== year
		|| verified.month !== month
		|| verified.day !== day
		|| verified.hour !== hour
		|| verified.minute !== minute
	) {
		const error = new Error(`Unable to resolve ${raw} in timezone ${tz}`);
		error.status = 422;
		throw error;
	}

	return new Date(utcMs).toISOString();
}
