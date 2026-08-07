/**
 * Analytics projection for Unified Calendar Scheduled Items (Phase C8).
 *
 * Read-only metadata + link-out. Does not duplicate the Analytics warehouse —
 * only a slim summary derived from channel-job performance fields already present.
 */

import { normalizeScheduledItemStatus } from '../scheduled-item.js';
import { buildAnalyticsHref } from '../product-links.js';

const SUMMARY_KEYS = Object.freeze([
	'impressions',
	'saves',
	'outboundClicks',
	'closeups',
]);

/**
 * Slim performance summary for Calendar (never a full analytics payload).
 */
export function slimPerformanceSummary(raw = null) {
	if (!raw || typeof raw !== 'object') return null;
	const summary = {};
	let hasMetric = false;
	for (const key of SUMMARY_KEYS) {
		if (raw[key] == null || raw[key] === '') continue;
		const value = Number(raw[key]);
		if (!Number.isFinite(value)) continue;
		summary[key] = value;
		hasMetric = true;
	}
	const lastSyncedAt = raw.lastSyncedAt || raw.last_synced_at || raw.analytics_synced_at || null;
	if (lastSyncedAt) summary.lastSyncedAt = String(lastSyncedAt);
	const ready = raw.readyForAnalyticsSync;
	if (typeof ready === 'boolean') summary.readyForAnalyticsSync = ready;
	if (!hasMetric && !summary.lastSyncedAt && summary.readyForAnalyticsSync == null) {
		return null;
	}
	return {
		...summary,
		readOnly: true,
		projected: true,
	};
}

/**
 * Project analytics metadata for a Scheduled Item.
 *
 * @returns {{ performance: object|null, analyticsHref: string, analytics: object }}
 */
export function projectAnalyticsMetadata(input = {}) {
	const status = normalizeScheduledItemStatus(input.status);
	const websiteId = String(input.websiteId || '').trim();
	const pinId = String(input.pinId || input.studioItemId || input.studioPinId || '').trim();
	const jobId = String(input.jobId || input.refId || '').trim();
	const analyticsHref = websiteId || pinId || jobId
		? buildAnalyticsHref({ websiteId, pinId, jobId })
		: '';

	const allowSummary = status === 'published'
		|| (input.performance && typeof input.performance === 'object');
	const performance = allowSummary ? slimPerformanceSummary(input.performance) : null;

	return {
		performance,
		analyticsHref,
		analytics: {
			href: analyticsHref,
			hasSummary: Boolean(performance),
			readOnly: true,
			projected: true,
			/** Calendar must not become an analytics store. */
			duplicated: false,
		},
	};
}
