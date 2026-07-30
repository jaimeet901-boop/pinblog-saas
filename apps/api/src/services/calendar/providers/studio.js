/**
 * Content Studio calendar provider (Phase C7).
 *
 * Projects scheduled AI Content Studio pins (ai_pins) that are not already
 * owned by a channel publish job. Facade / mutation router cores stay untouched.
 */

import {
	buildScheduledItemId,
	normalizeScheduledItem,
} from '../scheduled-item.js';
import { buildStudioDeepLinks } from '../studio-links.js';

export const STUDIO_CALENDAR_CHANNEL = 'studio';
export const STUDIO_PIN_REF_TYPE = 'ai_pins';

const STUDIO_SCHEDULE_STATUSES = new Set([
	'scheduled',
	'publishing',
	'published',
	'failed',
	'cancelled',
	'queued',
	'processing',
	'waiting',
	'waiting_provider',
	'error',
	'canceled',
]);

/**
 * True when an ai_pins row should appear as a Studio scheduled calendar item.
 * Drafts are handled by the draft overlay. Pins with publish_job_id are already
 * projected by the owning channel job provider (e.g. Pinterest).
 */
export function isStudioScheduledPin(pin = {}) {
	const status = String(pin.status || '').trim().toLowerCase();
	if (!status || status === 'draft') return false;
	if (!STUDIO_SCHEDULE_STATUSES.has(status) && status !== 'scheduled') return false;
	const scheduledAt = pin.scheduled_at || pin.scheduledAt;
	if (!scheduledAt) return false;
	if (pin.publish_job_id || pin.publishJobId) return false;
	return true;
}

/**
 * Map an ai_pins row into a canonical Scheduled Item with Studio deep links.
 */
export function mapStudioPinToScheduledItem(pin = {}) {
	const refId = String(pin.id || '').trim();
	const status = pin.status || 'scheduled';
	const title = String(pin.title || pin.overlay_text || pin.overlayText || 'Studio pin').trim();

	return normalizeScheduledItem({
		id: buildScheduledItemId(STUDIO_CALENDAR_CHANNEL, refId),
		channel: STUDIO_CALENDAR_CHANNEL,
		status,
		scheduledAt: pin.scheduled_at || pin.scheduledAt || null,
		timezone: pin.scheduled_timezone || pin.timezone || 'UTC',
		websiteId: pin.websiteId || pin.website_id || '',
		websiteName: pin.website_name || pin.websiteName || '',
		websiteDomain: pin.website_domain || pin.websiteDomain || '',
		website: pin.website && typeof pin.website === 'object' ? pin.website : undefined,
		title,
		previewUrl: pin.image_url || pin.imageUrl || pin.preview_url || '',
		refType: STUDIO_PIN_REF_TYPE,
		refId,
		actions: [],
		readOnly: true,
		deepLinks: buildStudioDeepLinks(pin, {
			articleId: pin.articleId || pin.article_id || '',
		}),
		performance: null,
	});
}

/**
 * @param {{ fetchPins?: (ctx: object, filters: object) => Promise<object[]> }} [options]
 */
export function createStudioCalendarProvider(options = {}) {
	const fetchPins = options.fetchPins;

	return {
		channel: STUDIO_CALENDAR_CHANNEL,
		kind: 'content_studio',
		async listScheduledItems(ctx, filters) {
			if (typeof fetchPins !== 'function') {
				throw new Error('Studio calendar provider requires fetchPins');
			}
			const pins = await fetchPins(ctx, filters);
			return (Array.isArray(pins) ? pins : [])
				.filter(isStudioScheduledPin)
				.map(mapStudioPinToScheduledItem);
		},
	};
}
