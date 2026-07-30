/**
 * Shared product Calendar read for CalendarPage + Dashboard.
 * Both surfaces must use the Unified Calendar Facade with the same defaults
 * so scheduled items never diverge.
 */

import { listUnifiedCalendarEvents } from './facade.js';
import { PRODUCT_CALENDAR_STATUSES } from './scheduled-item.js';

/** Defaults aligned with product Calendar / Dashboard (C4/C7). Drafts off by default. */
export const PRODUCT_CALENDAR_READ_DEFAULTS = Object.freeze({
	includeManual: false,
	includeDrafts: false,
	statuses: [...PRODUCT_CALENDAR_STATUSES],
});

export function localCalendarMonthKey(date = new Date()) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Map Scheduled Items into the existing Dashboard calendarJobs widget shape.
 * UI fields preserved: id, title, status, scheduledAt, timezone, eventType.
 */
export function mapScheduledItemsToDashboardCalendarJobs(items = []) {
	return (Array.isArray(items) ? items : []).map((item) => ({
		id: item.id,
		title: item.title || 'Scheduled item',
		status: item.status || 'scheduled',
		scheduledAt: item.scheduledAt || null,
		timezone: item.timezone || 'UTC',
		eventType: item.channel === 'draft'
			? 'draft'
			: (item.channel === 'manual' ? 'schedule' : 'publish'),
		channel: item.channel || '',
		websiteId: item.websiteId || '',
		website: item.website || null,
		refId: item.refId || '',
	}));
}

/**
 * Load the product calendar month via the Unified Calendar Facade.
 * Same query contract as CalendarPage: month + includeManual=false + full status set (C4).
 *
 * @param {object} req
 * @param {{ month?: string, websiteId?: string, providers?: object[], assertCapability?: Function }} [options]
 */
export async function loadProductCalendarMonth(req, options = {}) {
	const month = String(options.month || localCalendarMonthKey()).trim();
	const websiteId = String(options.websiteId || '').trim();
	const result = await listUnifiedCalendarEvents(
		req,
		{
			month,
			includeManual: PRODUCT_CALENDAR_READ_DEFAULTS.includeManual ? 'true' : 'false',
			includeDrafts: PRODUCT_CALENDAR_READ_DEFAULTS.includeDrafts ? 'true' : 'false',
			statuses: PRODUCT_CALENDAR_READ_DEFAULTS.statuses.join(','),
			...(websiteId ? { websiteId } : {}),
		},
		{
			providers: options.providers,
			assertCapability: options.assertCapability,
		},
	);

	return {
		month: result.month || month,
		from: result.from,
		to: result.to,
		items: result.items,
		calendarJobs: mapScheduledItemsToDashboardCalendarJobs(result.items),
		filters: result.filters,
		meta: {
			...(result.meta || {}),
			source: 'unified_calendar_facade',
			consumer: options.consumer || 'product_calendar',
		},
	};
}

/**
 * Dashboard-specific helper (thin wrapper for clear call sites).
 */
export async function loadDashboardCalendarJobs(req, options = {}) {
	return loadProductCalendarMonth(req, {
		...options,
		consumer: 'dashboard',
	});
}
