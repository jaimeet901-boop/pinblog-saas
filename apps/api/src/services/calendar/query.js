/**
 * Query parsing / range helpers for the Unified Calendar Facade (channel-agnostic).
 */

import {
	normalizeScheduledItemStatus,
	PRODUCT_CALENDAR_STATUSES,
	SCHEDULED_ITEM_STATUSES,
} from './scheduled-item.js';

function freezeError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function parseList(value) {
	if (Array.isArray(value)) {
		return value.map((item) => String(item || '').trim()).filter(Boolean);
	}
	const raw = String(value || '').trim();
	if (!raw) return [];
	return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Parse month=YYYY-MM into UTC [from, to) bounds.
 */
export function monthToUtcRange(month) {
	const key = String(month || '').trim();
	if (!/^\d{4}-\d{2}$/.test(key)) {
		throw freezeError(422, 'month must be in YYYY-MM format', 'VALIDATION_ERROR');
	}
	const reference = new Date(`${key}-01T00:00:00.000Z`);
	if (Number.isNaN(reference.getTime())) {
		throw freezeError(422, 'month must be in YYYY-MM format', 'VALIDATION_ERROR');
	}
	const from = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
	const to = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
	return {
		month: key,
		from: from.toISOString(),
		to: to.toISOString(),
	};
}

/**
 * Normalize requested status filters into canonical statuses.
 * Empty → product default set (C4). Explicit list is alias-normalized.
 */
export function resolveStatusFilters(rawStatuses, { defaultStatuses = PRODUCT_CALENDAR_STATUSES } = {}) {
	const requested = parseList(rawStatuses).map((item) => normalizeScheduledItemStatus(item));
	const unique = [...new Set(requested)];
	if (!unique.length) {
		return [...defaultStatuses];
	}
	return unique.filter((status) => SCHEDULED_ITEM_STATUSES.includes(status));
}

/**
 * Normalize facade query into a filter object.
 *
 * Supports: month | from+to, websiteId, channels, statuses, includeManual, includeDrafts.
 * Default statuses (C4): full PRODUCT_CALENDAR_STATUSES. Pass statuses=scheduled for legacy narrow feeds.
 * Drafts (C7): off by default; includeDrafts=true or channels=draft enables the draft overlay.
 */
export function parseCalendarFacadeQuery(query = {}) {
	const month = String(query.month || '').trim();
	let from = String(query.from || '').trim();
	let to = String(query.to || '').trim();
	let resolvedMonth = null;

	if (from || to) {
		if (!from || !to) {
			throw freezeError(422, 'from and to are both required when either is provided', 'VALIDATION_ERROR');
		}
		const fromDate = new Date(from);
		const toDate = new Date(to);
		if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
			throw freezeError(422, 'from and to must be valid ISO timestamps', 'VALIDATION_ERROR');
		}
		if (fromDate >= toDate) {
			throw freezeError(422, 'from must be before to', 'VALIDATION_ERROR');
		}
		from = fromDate.toISOString();
		to = toDate.toISOString();
	} else if (month) {
		const range = monthToUtcRange(month);
		resolvedMonth = range.month;
		from = range.from;
		to = range.to;
	} else {
		const now = new Date();
		const range = monthToUtcRange(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`);
		resolvedMonth = range.month;
		from = range.from;
		to = range.to;
	}

	const channels = parseList(query.channels).map((item) => item.toLowerCase());
	const statuses = resolveStatusFilters(query.statuses ?? query.status);
	const websiteId = String(query.websiteId || query.website_id || '').trim();
	const includeManualRaw = query.includeManual ?? query.include_manual;
	const includeManual = includeManualRaw == null
		? true
		: !['0', 'false', 'no', 'off'].includes(String(includeManualRaw).trim().toLowerCase());
	const includeDraftsRaw = query.includeDrafts ?? query.include_drafts;
	const includeDrafts = includeDraftsRaw == null
		? false
		: !['0', 'false', 'no', 'off'].includes(String(includeDraftsRaw).trim().toLowerCase());

	// When drafts are requested, ensure status filter admits the draft status.
	if ((includeDrafts || channels.includes('draft')) && !statuses.includes('draft')) {
		statuses.push('draft');
	}

	return {
		month: resolvedMonth,
		from,
		to,
		websiteId,
		channels,
		statuses,
		includeManual,
		includeDrafts,
	};
}

export function scheduledAtInRange(scheduledAt, from, to) {
	const at = new Date(scheduledAt);
	if (Number.isNaN(at.getTime())) return false;
	const start = new Date(from);
	const end = new Date(to);
	return at >= start && at < end;
}

export function matchesFacadeFilters(item, filters) {
	if (!item?.scheduledAt) return false;
	if (!scheduledAtInRange(item.scheduledAt, filters.from, filters.to)) return false;
	if (filters.websiteId && String(item.websiteId || '') !== filters.websiteId) return false;
	if (filters.channels.length && !filters.channels.includes(String(item.channel || '').toLowerCase())) {
		return false;
	}
	const itemStatus = normalizeScheduledItemStatus(item.status);
	if (filters.statuses.length && !filters.statuses.includes(itemStatus)) {
		return false;
	}
	return true;
}
