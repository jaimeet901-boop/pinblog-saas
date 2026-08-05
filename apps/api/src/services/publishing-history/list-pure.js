/**
 * Publishing History list — pure query/filter/sort/assembly helpers (no I/O).
 */

import {
	PUBLISHING_CHANNELS,
	PUBLISHING_CONTENT_TYPES,
	PUBLISHING_SOURCE_MODULES,
	PUBLISHING_STATUSES,
} from './constants.js';

export const PUBLISHING_HISTORY_API_VERSION = 1;
export const MIN_SOURCE_FETCH_CAP = 300;
export const MAX_SOURCE_FETCH_CAP = 1000;

const ALLOWED_SORTS = new Set([
	'updatedAt',
	'-updatedAt',
	'createdAt',
	'-createdAt',
	'publishedAt',
	'-publishedAt',
	'scheduledAt',
	'-scheduledAt',
	'title',
	'-title',
	'status',
	'-status',
	'channel',
	'-channel',
]);

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export function computeSourceFetchCap(page, perPage) {
	const p = Math.max(1, Number(page) || 1);
	const size = Math.max(1, Number(perPage) || 50);
	return Math.min(MAX_SOURCE_FETCH_CAP, Math.max(MIN_SOURCE_FETCH_CAP, p * size * 3));
}

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
	const n = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(max, n);
}

function parseOptionalEnum(value, allowed, fieldName) {
	const raw = String(value || '').trim().toLowerCase();
	if (!raw) return '';
	if (!allowed.includes(raw)) {
		throw httpError(400, `Invalid ${fieldName}: ${raw}`, 'VALIDATION_ERROR');
	}
	return raw;
}

function parseOptionalIso(value, fieldName) {
	const raw = String(value || '').trim();
	if (!raw) return null;
	const ms = Date.parse(raw);
	if (!Number.isFinite(ms)) {
		throw httpError(400, `Invalid ${fieldName}: must be an ISO date`, 'VALIDATION_ERROR');
	}
	return new Date(ms).toISOString();
}

/**
 * @param {Record<string, unknown>} query
 */
export function parsePublishingHistoryQuery(query = {}) {
	const page = parsePositiveInt(query.page, 1);
	const perPage = parsePositiveInt(query.perPage, 50, 100);
	const channel = parseOptionalEnum(query.channel, PUBLISHING_CHANNELS, 'channel');
	const status = parseOptionalEnum(query.status, PUBLISHING_STATUSES, 'status');
	const sourceModule = parseOptionalEnum(query.sourceModule, PUBLISHING_SOURCE_MODULES, 'sourceModule');
	const contentType = parseOptionalEnum(query.contentType, PUBLISHING_CONTENT_TYPES, 'contentType');
	const websiteId = String(query.websiteId || '').trim();
	const workflowId = String(query.workflowId || '').trim();
	const search = String(query.q || query.search || '').trim();
	const from = parseOptionalIso(query.from, 'from');
	const to = parseOptionalIso(query.to, 'to');

	let sort = String(query.sort || '-updatedAt').trim() || '-updatedAt';
	if (!ALLOWED_SORTS.has(sort)) {
		sort = '-updatedAt';
	}

	const channels = channel
		? [channel]
		: ['pinterest', 'wordpress'];

	return {
		page,
		perPage,
		channels,
		filters: {
			channel: channel || null,
			status: status || null,
			sourceModule: sourceModule || null,
			contentType: contentType || null,
			websiteId: websiteId || null,
			workflowId: workflowId || null,
			search: search || null,
			from,
			to,
		},
		sort,
	};
}

export function activityTimestamp(item) {
	return item?.publishedAt || item?.scheduledAt || item?.updatedAt || item?.createdAt || '';
}

function textHaystack(item) {
	const dest = item?.destination || {};
	return [
		item?.title,
		item?.subtitle,
		item?.description,
		dest.accountLabel,
		dest.targetLabel,
		dest.externalUrl,
		item?.destinationUrl,
		item?.lastError,
		item?.jobId,
		item?.id,
	].map((v) => String(v || '').toLowerCase()).join('\n');
}

export function matchesPublishingHistoryFilters(item, filters = {}) {
	if (filters.channel && item.channel !== filters.channel) return false;
	if (filters.status && item.status !== filters.status) return false;
	if (filters.sourceModule && item.sourceModule !== filters.sourceModule) return false;
	if (filters.contentType && item.contentType !== filters.contentType) return false;
	if (filters.websiteId && item.websiteId !== filters.websiteId) return false;
	if (filters.workflowId && String(item.workflowId || '') !== filters.workflowId) return false;

	if (filters.search) {
		const needle = String(filters.search).toLowerCase();
		if (!textHaystack(item).includes(needle)) return false;
	}

	if (filters.from || filters.to) {
		const stamp = activityTimestamp(item);
		const ms = stamp ? Date.parse(stamp) : NaN;
		if (!Number.isFinite(ms)) return false;
		if (filters.from && ms < Date.parse(filters.from)) return false;
		if (filters.to && ms > Date.parse(filters.to)) return false;
	}

	return true;
}

function compareNullableDate(a, b, desc) {
	const am = a ? Date.parse(a) : NaN;
	const bm = b ? Date.parse(b) : NaN;
	const aOk = Number.isFinite(am);
	const bOk = Number.isFinite(bm);
	if (!aOk && !bOk) return 0;
	if (!aOk) return 1; // nulls last
	if (!bOk) return -1;
	return desc ? bm - am : am - bm;
}

export function sortPublishingHistoryItems(items, sort = '-updatedAt') {
	const desc = String(sort).startsWith('-');
	const field = desc ? String(sort).slice(1) : String(sort);
	const list = [...items];

	list.sort((left, right) => {
		let cmp = 0;
		if (field === 'updatedAt' || field === 'createdAt' || field === 'publishedAt' || field === 'scheduledAt') {
			cmp = compareNullableDate(left[field], right[field], desc);
		} else if (field === 'title' || field === 'status' || field === 'channel') {
			const av = String(left[field] || '');
			const bv = String(right[field] || '');
			cmp = av.localeCompare(bv);
			if (desc) cmp = -cmp;
		} else {
			cmp = compareNullableDate(left.updatedAt, right.updatedAt, true);
		}
		if (cmp !== 0) return cmp;
		return String(left.id || '').localeCompare(String(right.id || ''));
	});

	return list;
}

export function buildPublishingHistoryCounts(items) {
	const byChannel = {};
	const byStatus = {};
	for (const status of PUBLISHING_STATUSES) byStatus[status] = 0;
	for (const item of items) {
		byChannel[item.channel] = (byChannel[item.channel] || 0) + 1;
		if (Object.prototype.hasOwnProperty.call(byStatus, item.status)) {
			byStatus[item.status] += 1;
		}
	}
	return { byChannel, byStatus };
}

export function paginatePublishingHistoryItems(items, page, perPage) {
	const totalItems = items.length;
	const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / perPage);
	const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages || 1));
	const start = (safePage - 1) * perPage;
	return {
		page: totalItems === 0 ? 1 : safePage,
		perPage,
		totalItems,
		totalPages,
		items: items.slice(start, start + perPage),
	};
}

export function assemblePublishingHistoryResponse({
	items,
	page,
	perPage,
	sort,
	filters,
	warnings = [],
	truncated = false,
}) {
	const filteredSorted = items;
	const counts = buildPublishingHistoryCounts(filteredSorted);
	const pageResult = paginatePublishingHistoryItems(filteredSorted, page, perPage);

	return {
		version: PUBLISHING_HISTORY_API_VERSION,
		items: pageResult.items,
		meta: {
			page: pageResult.page,
			perPage: pageResult.perPage,
			totalItems: pageResult.totalItems,
			totalPages: pageResult.totalPages,
			sort,
			filters: {
				channel: filters.channel,
				status: filters.status,
				sourceModule: filters.sourceModule,
				contentType: filters.contentType,
				websiteId: filters.websiteId,
				workflowId: filters.workflowId,
				search: filters.search,
				from: filters.from,
				to: filters.to,
			},
			counts,
			truncated: Boolean(truncated),
		},
		warnings: Array.isArray(warnings) ? warnings : [],
	};
}

/** Map normalized status → PocketBase filter fragment for a channel (or null = skip source). */
export function nativeStatusExtraFilter(channel, normalizedStatus) {
	if (!normalizedStatus) return '';
	if (channel === 'pinterest') {
		switch (normalizedStatus) {
			case 'queued':
				return null; // Pinterest has no queued — skip source
			case 'scheduled':
				return 'status = "scheduled"';
			case 'publishing':
				return '(status = "publishing" || status = "waiting_provider")';
			case 'retrying':
				return 'status = "retrying"';
			case 'published':
				return 'status = "published"';
			case 'failed':
				return 'status = "failed"';
			case 'cancelled':
				return 'status = "cancelled"';
			default:
				return '';
		}
	}
	if (channel === 'wordpress') {
		switch (normalizedStatus) {
			case 'retrying':
				return null;
			case 'queued':
			case 'scheduled':
			case 'publishing':
			case 'published':
			case 'failed':
			case 'cancelled':
				return `status = "${normalizedStatus}"`;
			default:
				return '';
		}
	}
	return '';
}
