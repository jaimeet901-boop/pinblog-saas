/**
 * Shared helpers for Publishing History normalizers (pure, no I/O).
 */

import {
	PUBLISHING_STATUSES,
	buildPublishingHistoryId,
	emptyPublishingHistoryItem,
} from './constants.js';

export function asText(value, max = 2000) {
	const text = String(value ?? '').trim();
	if (!text) return '';
	return text.length > max ? text.slice(0, max) : text;
}

export function asIsoOrNull(value) {
	const text = String(value ?? '').trim();
	return text || null;
}

export function asNumber(value, fallback = 0) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * Map native job status → normalized PublishingStatus.
 * @param {string} nativeStatus
 * @param {Record<string, string>} aliasMap
 */
export function normalizePublishingStatus(nativeStatus, aliasMap = {}) {
	const raw = String(nativeStatus || '').trim().toLowerCase();
	if (!raw) return 'queued';
	const aliased = aliasMap[raw] || raw;
	if (PUBLISHING_STATUSES.includes(aliased)) return aliased;
	return 'queued';
}

export function buildActions({
	status,
	externalUrl = '',
	retryPath = null,
	cancelPath = null,
	publishNowPath = null,
} = {}) {
	const canRetry = status === 'failed';
	const canCancel = status === 'scheduled';
	const canPublishNow = status === 'scheduled' || status === 'failed';
	const canOpenExternal = Boolean(String(externalUrl || '').trim());
	return {
		canRetry,
		canCancel,
		canPublishNow,
		canOpenExternal,
		retryPath: canRetry ? retryPath : null,
		cancelPath: canCancel ? cancelPath : null,
		publishNowPath: canPublishNow ? publishNowPath : null,
	};
}

/**
 * Start from empty item and apply identity fields.
 */
export function baseItem({ channel, jobId, jobCollection }) {
	const item = emptyPublishingHistoryItem();
	item.channel = channel;
	item.jobId = asText(jobId, 80);
	item.jobCollection = asText(jobCollection, 80);
	item.id = buildPublishingHistoryId(channel, item.jobId);
	return item;
}
