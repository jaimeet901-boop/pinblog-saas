/**
 * Draft overlay provider (Phase C7).
 *
 * Informational only — never treated as publish jobs.
 * Off by default; enabled via includeDrafts=true or channels=draft.
 */

import {
	buildScheduledItemId,
	normalizeScheduledItem,
} from '../scheduled-item.js';
import { buildStudioDeepLinks } from '../studio-links.js';

export const DRAFT_CALENDAR_CHANNEL = 'draft';
export const DRAFT_REF_TYPE = 'studio_draft';

/**
 * True when an ai_pins row is an unscheduled Studio draft overlay candidate.
 */
export function isStudioDraftPin(pin = {}) {
	const status = String(pin.status || '').trim().toLowerCase();
	if (status !== 'draft') return false;
	// Never treat channel publish jobs as drafts.
	if (pin.publish_job_id || pin.publishJobId) return false;
	return true;
}

/**
 * Informational placement date for drafts (not a publish schedule).
 * Prefers updated/created so unscheduled drafts can sit on the calendar grid.
 */
export function draftPlacementAt(pin = {}) {
	return (
		pin.scheduled_at
		|| pin.scheduledAt
		|| pin.updated
		|| pin.updatedAt
		|| pin.created
		|| pin.createdAt
		|| null
	);
}

/**
 * Whether draft overlay should contribute items for this facade query.
 */
export function draftsRequested(filters = {}) {
	if (filters?.includeDrafts === true) return true;
	const channels = Array.isArray(filters?.channels) ? filters.channels : [];
	return channels.map((item) => String(item || '').toLowerCase()).includes(DRAFT_CALENDAR_CHANNEL);
}

/**
 * Map a Studio draft into a Scheduled Item (informational overlay).
 */
export function mapDraftPinToScheduledItem(pin = {}) {
	const refId = String(pin.id || '').trim();
	const title = String(pin.title || pin.overlay_text || pin.overlayText || 'Studio draft').trim();
	const placementAt = draftPlacementAt(pin);

	return normalizeScheduledItem({
		id: buildScheduledItemId(DRAFT_CALENDAR_CHANNEL, refId),
		channel: DRAFT_CALENDAR_CHANNEL,
		status: 'draft',
		scheduledAt: placementAt,
		timezone: pin.scheduled_timezone || pin.timezone || 'UTC',
		websiteId: pin.websiteId || pin.website_id || '',
		websiteName: pin.website_name || pin.websiteName || '',
		websiteDomain: pin.website_domain || pin.websiteDomain || '',
		website: pin.website && typeof pin.website === 'object' ? pin.website : undefined,
		title,
		previewUrl: pin.image_url || pin.imageUrl || pin.preview_url || '',
		refType: DRAFT_REF_TYPE,
		refId,
		actions: [],
		readOnly: true,
		deepLinks: buildStudioDeepLinks(pin, {
			articleId: pin.articleId || pin.article_id || '',
			informational: true,
		}),
		performance: null,
	});
}

/**
 * @param {{ fetchDrafts?: (ctx: object, filters: object) => Promise<object[]> }} [options]
 */
export function createDraftOverlayProvider(options = {}) {
	const fetchDrafts = options.fetchDrafts;

	return {
		channel: DRAFT_CALENDAR_CHANNEL,
		kind: 'draft_overlay',
		async listScheduledItems(ctx, filters) {
			if (!draftsRequested(filters)) return [];
			if (typeof fetchDrafts !== 'function') {
				throw new Error('Draft overlay provider requires fetchDrafts');
			}
			const pins = await fetchDrafts(ctx, filters);
			return (Array.isArray(pins) ? pins : [])
				.filter(isStudioDraftPin)
				.filter((pin) => draftPlacementAt(pin))
				.map(mapDraftPinToScheduledItem);
		},
	};
}
