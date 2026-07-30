/**
 * Manual / planned overlay provider (calendar_events demoted SoT).
 * Skips rows that mirror channel jobs to avoid duplicate projections.
 */

import { isChannelJobRefType } from '../calendar-architecture.js';
import {
	buildScheduledItemId,
	defaultActionsForStatus,
	normalizeScheduledItem,
} from '../scheduled-item.js';

export const MANUAL_CALENDAR_CHANNEL = 'manual';

/**
 * Map a calendar_events row into a generic Scheduled Item (manual overlay only).
 */
export function mapManualEventToScheduledItem(record = {}) {
	const refId = String(record.id || '').trim();
	const status = String(record.status || 'scheduled').trim().toLowerCase() || 'scheduled';
	const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};

	return normalizeScheduledItem({
		id: buildScheduledItemId(MANUAL_CALENDAR_CHANNEL, refId),
		channel: MANUAL_CALENDAR_CHANNEL,
		status,
		scheduledAt: record.scheduled_at || record.scheduledAt || null,
		timezone: record.timezone || 'UTC',
		websiteId: meta.websiteId || meta.website_id || record.websiteId || record.website_id || '',
		websiteName: meta.websiteName || meta.website_name || '',
		websiteDomain: meta.websiteDomain || meta.website_domain || '',
		website: meta.website && typeof meta.website === 'object' ? meta.website : undefined,
		title: record.title || 'Planned item',
		previewUrl: meta.previewUrl || meta.preview_url || '',
		refType: record.ref_type || record.refType || 'manual_plan',
		refId,
		actions: defaultActionsForStatus(status),
		readOnly: false,
		deepLinks: {},
		performance: null,
	});
}

export function isManualOverlayRecord(record = {}) {
	const refType = record.ref_type ?? record.refType ?? '';
	if (isChannelJobRefType(refType)) return false;
	return Boolean(record.scheduled_at || record.scheduledAt);
}

/**
 * @param {{ fetchEvents?: (ctx: object, filters: object) => Promise<object[]> }} [options]
 */
export function createManualOverlayProvider(options = {}) {
	const fetchEvents = options.fetchEvents;

	return {
		channel: MANUAL_CALENDAR_CHANNEL,
		kind: 'manual_overlay',
		async listScheduledItems(ctx, filters) {
			if (filters?.includeManual === false) return [];
			if (typeof fetchEvents !== 'function') {
				throw new Error('Manual overlay provider requires fetchEvents');
			}
			const events = await fetchEvents(ctx, filters);
			return (Array.isArray(events) ? events : [])
				.filter(isManualOverlayRecord)
				.map(mapManualEventToScheduledItem);
		},
	};
}
