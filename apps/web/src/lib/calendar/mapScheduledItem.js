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
	const channel = String(item.channel || '').trim();
	const isFacebook = channel === 'facebook';
	const isWordpress = channel === 'wordpress';
	const facadeId = String(item.id || '').trim();
	const refId = String(item.refId || links.historyJobId || '').trim()
		|| (facadeId.includes(':') ? facadeId.slice(facadeId.indexOf(':') + 1) : facadeId);
	const defaultTitle = (isFacebook || isWordpress) ? 'Scheduled Post' : 'Scheduled Pin';
	const title = String(item.title || defaultTitle).trim() || defaultTitle;
	const previewUrl = String(item.previewUrl || '').trim();
	const website = item.website && typeof item.website === 'object' ? item.website : null;
	const pageId = String(links.pageId || '').trim();
	const pageName = String(links.pageName || links.pageLabel || '').trim();
	const boardId = String(links.boardId || (isFacebook ? pageId : '')).trim();
	const boardName = String(links.boardName || (isFacebook ? pageName : '')).trim();
	const studioItemId = String(links.studioItemId || links.studioPinId || '').trim();
	const contentPreview = {
		id: studioItemId,
		title,
		imageUrl: previewUrl,
		description: links.description || '',
		overlayText: links.overlayText || '',
		destinationUrl: links.destinationUrl || '',
	};

	return {
		id: refId,
		facadeId,
		channel,
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
		boardId,
		boardName,
		pageId,
		pageName,
		pinterestPinUrl: links.liveUrl || '',
		facebookPostUrl: isFacebook ? (links.liveUrl || '') : '',
		destinationUrl: links.destinationUrl || '',
		createdAt: links.createdAt || '',
		actions: Array.isArray(item.actions) ? item.actions : [],
		readOnly: item.readOnly !== false,
		pin: contentPreview,
		post: isFacebook ? contentPreview : undefined,
		studioHref: String(links.studioHref || '').trim(),
		studioPinId: studioItemId,
		studioItemId,
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

function sameDay(dateA, dateB) {
	return dateA.getFullYear() === dateB.getFullYear()
		&& dateA.getMonth() === dateB.getMonth()
		&& dateA.getDate() === dateB.getDate();
}

function startOfDay(date = new Date()) {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function addDays(date, amount) {
	const d = new Date(date);
	d.setDate(d.getDate() + amount);
	return d;
}

/**
 * Channel counts for Calendar summary tiles.
 * Untagged/legacy rows count as Pinterest so existing pin-only feeds stay unchanged.
 *
 * @param {object[]} jobs
 * @param {Date} [now]
 */
export function countCalendarChannelStats(jobs = [], now = new Date()) {
	const today = startOfDay(now);
	const weekEnd = addDays(today, 7);
	let scheduledToday = 0;
	let scheduledWeek = 0;
	let pinterest = 0;
	let facebook = 0;
	let wordpress = 0;
	let pending = 0;
	let failed = 0;

	for (const job of jobs) {
		const channel = String(job?.channel || '').trim().toLowerCase();
		if (channel === 'wordpress') wordpress += 1;
		else if (channel === 'facebook') facebook += 1;
		else pinterest += 1;

		const stamp = job?.scheduledAt ? new Date(job.scheduledAt) : null;
		if (stamp && sameDay(stamp, today) && job.status === 'scheduled') scheduledToday += 1;
		if (stamp && stamp >= today && stamp < weekEnd && job.status === 'scheduled') scheduledWeek += 1;
		if (job.status === 'scheduled' || job.status === 'queued' || job.status === 'publishing') pending += 1;
		if (job.status === 'failed') failed += 1;
	}

	return {
		scheduledToday,
		scheduledWeek,
		pinterest,
		facebook,
		wordpress,
		pending,
		failed,
	};
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
