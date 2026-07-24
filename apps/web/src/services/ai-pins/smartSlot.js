/**
 * Pure smart-slot planner. Uses Workspace Config publishing windows,
 * daily limits, timezone, and interval — never hardcodes platform policy.
 */

function pad(n) {
	return String(n).padStart(2, '0');
}

function parseHm(value) {
	const [h, m] = String(value || '00:00').split(':').map((part) => Number(part) || 0);
	return { h, m };
}

/** Local wall-clock parts for a Date in a given IANA timezone. */
export function zonedParts(date, timeZone) {
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: timeZone || 'UTC',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	});
	const parts = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
	const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		weekday: weekdayMap[parts.weekday] ?? 0,
		hour: Number(parts.hour),
		minute: Number(parts.minute),
		dateKey: `${parts.year}-${parts.month}-${parts.day}`,
	};
}

/**
 * Build a Date that represents the given local wall time in `timeZone`.
 * Iterative approximation (good enough for slot planning).
 */
export function wallTimeToUtc({ year, month, day, hour, minute }, timeZone) {
	let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
	for (let i = 0; i < 4; i += 1) {
		const parts = zonedParts(guess, timeZone);
		const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
		const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
		guess = new Date(guess.getTime() + (desired - actual));
	}
	return guess;
}

function dayKeyCounts(scheduledAts, timeZone) {
	const counts = new Map();
	for (const iso of scheduledAts) {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) continue;
		const key = zonedParts(d, timeZone).dateKey;
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return counts;
}

function isInsideWindow(parts, windows) {
	const minutes = parts.hour * 60 + parts.minute;
	for (const window of windows) {
		if (!window.days.includes(parts.weekday)) continue;
		const start = parseHm(window.start);
		const end = parseHm(window.end);
		const startMin = start.h * 60 + start.m;
		const endMin = end.h * 60 + end.m;
		if (endMin <= startMin) {
			if (minutes >= startMin || minutes < endMin) return true;
		} else if (minutes >= startMin && minutes < endMin) {
			return true;
		}
	}
	return false;
}

function nextWindowStart(from, publishingConfig) {
	const { timezone, publishingWindows, intervalMinutes } = publishingConfig;
	const stepMs = Math.max(5, intervalMinutes) * 60 * 1000;
	let cursor = new Date(from.getTime());

	for (let i = 0; i < 14 * 24 * 12; i += 1) {
		const parts = zonedParts(cursor, timezone);
		if (isInsideWindow(parts, publishingWindows)) {
			return cursor;
		}
		// Jump to next window start on this or next day
		let advanced = false;
		for (const window of publishingWindows) {
			const start = parseHm(window.start);
			const candidate = wallTimeToUtc({
				year: parts.year,
				month: parts.month,
				day: parts.day,
				hour: start.h,
				minute: start.m,
			}, timezone);
			if (candidate.getTime() > cursor.getTime() && window.days.includes(parts.weekday)) {
				cursor = candidate;
				advanced = true;
				break;
			}
		}
		if (!advanced) {
			cursor = new Date(cursor.getTime() + stepMs);
		}
	}
	return new Date(from.getTime() + stepMs);
}

/**
 * Pick the next available publishing slot.
 * @param {object} publishingConfig - from resolvePublishingConfig
 * @param {string[]} occupiedScheduledAts - existing scheduled job ISO times
 * @param {Date} [from] - search start (default now + 1 min)
 */
export function findNextAvailableSlot(publishingConfig, occupiedScheduledAts = [], from = new Date()) {
	const timezone = publishingConfig.timezone || 'UTC';
	const intervalMs = Math.max(5, publishingConfig.intervalMinutes || 30) * 60 * 1000;
	const dailyLimit = Math.max(1, publishingConfig.dailyLimit || 50);
	const occupied = occupiedScheduledAts
		.map((iso) => new Date(iso).getTime())
		.filter((t) => Number.isFinite(t))
		.sort((a, b) => a - b);
	const dayCounts = dayKeyCounts(occupiedScheduledAts, timezone);

	let cursor = nextWindowStart(new Date(Math.max(from.getTime(), Date.now() + 60_000)), publishingConfig);

	for (let guard = 0; guard < 5000; guard += 1) {
		const parts = zonedParts(cursor, timezone);
		const dayCount = dayCounts.get(parts.dateKey) || 0;
		const conflicts = occupied.some((t) => Math.abs(t - cursor.getTime()) < intervalMs * 0.9);
		const inWindow = isInsideWindow(parts, publishingConfig.publishingWindows || []);

		if (inWindow && !conflicts && dayCount < dailyLimit) {
			return {
				scheduledAt: cursor.toISOString(),
				localLabel: `${parts.dateKey} ${pad(parts.hour)}:${pad(parts.minute)} (${timezone})`,
				timezone,
			};
		}

		cursor = new Date(cursor.getTime() + Math.max(5, publishingConfig.intervalMinutes || 30) * 60 * 1000);
		if (!isInsideWindow(zonedParts(cursor, timezone), publishingConfig.publishingWindows || [])) {
			cursor = nextWindowStart(cursor, publishingConfig);
		}
	}

	const fallback = new Date(Date.now() + intervalMs);
	return {
		scheduledAt: fallback.toISOString(),
		localLabel: `fallback ${fallback.toISOString()}`,
		timezone,
	};
}

/**
 * Allocate N sequential smart slots (for batch queue).
 */
export function allocateSmartSlots(publishingConfig, count, occupiedScheduledAts = []) {
	const slots = [];
	const occupied = [...occupiedScheduledAts];
	let from = new Date();
	for (let i = 0; i < count; i += 1) {
		const slot = findNextAvailableSlot(publishingConfig, occupied, from);
		slots.push(slot);
		occupied.push(slot.scheduledAt);
		from = new Date(new Date(slot.scheduledAt).getTime() + 1000);
	}
	return slots;
}
