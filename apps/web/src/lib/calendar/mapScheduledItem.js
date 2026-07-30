/**
 * Map Unified Calendar Facade Scheduled Items into the CalendarPage event row shape.
 * Channel-agnostic: uses generic fields + opaque deepLinks only.
 * Mutations use facade event ids (`channel:refId`) via the Mutation Router (C5+).
 */

import { PRODUCT_CALENDAR_STATUSES } from './productCalendarDefaults.js';

/**
 * @param {object} item  Scheduled Item from GET /workspace/v1/calendar/events
 * @returns {object} Calendar event row compatible with existing CalendarPage rendering
 */
export function mapScheduledItemToCalendarEvent(item = {}) {
	const links = item.deepLinks && typeof item.deepLinks === 'object' ? item.deepLinks : {};
	const facadeId = String(item.id || '').trim();
	const refId = String(item.refId || links.historyJobId || '').trim()
		|| (facadeId.includes(':') ? facadeId.slice(facadeId.indexOf(':') + 1) : facadeId);
	const title = String(item.title || 'Scheduled Pin').trim() || 'Scheduled Pin';
	const previewUrl = String(item.previewUrl || '').trim();
	const website = item.website && typeof item.website === 'object' ? item.website : null;

	return {
		id: refId,
		facadeId,
		channel: String(item.channel || '').trim(),
		refType: String(item.refType || '').trim(),
		refId,
		status: String(item.status || 'scheduled').trim() || 'scheduled',
		scheduledAt: item.scheduledAt || null,
		timezone: item.timezone || 'UTC',
		websiteId: item.websiteId || website?.id || '',
		website: website || (item.websiteId ? { id: item.websiteId, name: null, domain: null } : null),
		accountId: links.accountId || '',
		accountLabel: links.accountLabel || '',
		accountUsername: links.accountUsername || '',
		boardId: links.boardId || '',
		boardName: links.boardName || '',
		pinterestPinUrl: links.liveUrl || '',
		destinationUrl: links.destinationUrl || '',
		createdAt: links.createdAt || '',
		actions: Array.isArray(item.actions) ? item.actions : [],
		readOnly: item.readOnly !== false,
		pin: {
			id: links.studioPinId || '',
			title,
			imageUrl: previewUrl,
			description: links.description || '',
			overlayText: links.overlayText || '',
			destinationUrl: links.destinationUrl || '',
		},
		studioHref: String(links.studioHref || '').trim(),
		studioPinId: String(links.studioPinId || '').trim(),
		// C8 opaque projections (no UI redesign — pass-through only).
		analyticsHref: String(links.analyticsHref || '').trim(),
		historyHref: String(links.historyHref || '').trim(),
		queue: links.queue && typeof links.queue === 'object' ? links.queue : null,
		notification: links.notification && typeof links.notification === 'object' ? links.notification : null,
		performance: item.performance && typeof item.performance === 'object' ? item.performance : null,
	};
}

/**
 * @param {object} payload  Facade list response
 * @returns {object[]}
 */
export function mapFacadeCalendarResponse(payload) {
	const items = Array.isArray(payload?.items)
		? payload.items
		: (Array.isArray(payload) ? payload : []);
	return items.map(mapScheduledItemToCalendarEvent);
}

/**
 * Build the product Calendar read URL (facade only).
 * C4: expanded statuses + optional server-side websiteId.
 */
export function buildCalendarEventsUrl({
	month,
	channels = '',
	includeManual = false,
	includeDrafts = false,
	websiteId = '',
	statuses = PRODUCT_CALENDAR_STATUSES,
} = {}) {
	const params = new URLSearchParams();
	if (month) params.set('month', month);
	if (channels) params.set('channels', channels);
	params.set('includeManual', includeManual ? 'true' : 'false');
	params.set('includeDrafts', includeDrafts ? 'true' : 'false');
	if (websiteId) params.set('websiteId', websiteId);
	const statusList = Array.isArray(statuses) ? statuses.filter(Boolean) : String(statuses || '').split(',').map((s) => s.trim()).filter(Boolean);
	if (statusList.length) params.set('statuses', statusList.join(','));
	return `/workspace/v1/calendar/events?${params.toString()}`;
}
