/**
 * Pinterest channel provider for the Unified Calendar Facade.
 *
 * Owns Pinterest → Scheduled Item mapping. Calendar facade must not import
 * Pinterest business rules beyond registering this provider.
 */

import {
	buildScheduledItemId,
	defaultActionsForStatus,
	normalizeScheduledItem,
} from '../scheduled-item.js';
import { buildStudioDeepLinks } from '../studio-links.js';
import { applyChannelJobProjections } from '../projections/apply.js';

export const PINTEREST_CALENDAR_CHANNEL = 'pinterest';
export const PINTEREST_JOB_REF_TYPE = 'pinterest_publish_jobs';

/**
 * Map a pinterest_publish_jobs row into a generic Scheduled Item.
 * Pure — safe for unit tests without PocketBase.
 *
 * @param {object} job
 * @param {{ queueMirror?: object|null }} [options]
 */
export function mapPinterestJobToScheduledItem(job = {}, options = {}) {
	const refId = String(job.id || '').trim();
	const status = job.status || 'scheduled';
	const pin = job.expand?.ai_pin || job.pin || null;
	const title = String(
		job.title
		|| pin?.title
		|| pin?.overlay_text
		|| 'Scheduled pin',
	).trim();
	const websiteId = job.websiteId || job.website_id || '';
	const studioPinId = job.ai_pin || pin?.id || '';

	const baseDeepLinks = buildStudioDeepLinks(pin || {}, {
		studioPinId,
		websiteId,
		historyJobId: refId,
		liveUrl: job.pinterest_pin_url || '',
		// Display-only opaque links for Calendar UI continuity (not Calendar business logic).
		accountId: job.account || job.accountId || '',
		accountLabel: job.account_label || job.accountLabel || '',
		accountUsername: job.account_username || job.accountUsername || '',
		boardId: job.board_id || job.boardId || '',
		boardName: job.board_name || job.boardName || '',
		destinationUrl: pin?.destination_url || pin?.source_url || job.destination_url || '',
		createdAt: job.created || job.createdAt || '',
		description: pin?.description || '',
		overlayText: pin?.overlay_text || pin?.overlayText || '',
	});

	const projected = applyChannelJobProjections(baseDeepLinks, job, {
		sourceCollection: PINTEREST_JOB_REF_TYPE,
		sourceId: refId,
		websiteId,
		pinId: studioPinId,
		status,
		scheduledAt: job.scheduled_at || job.scheduledAt || null,
		performance: job.performance && typeof job.performance === 'object' ? job.performance : null,
		queueMirror: options.queueMirror || null,
	});

	return normalizeScheduledItem({
		id: buildScheduledItemId(PINTEREST_CALENDAR_CHANNEL, refId),
		channel: PINTEREST_CALENDAR_CHANNEL,
		status,
		scheduledAt: job.scheduled_at || job.scheduledAt || null,
		timezone: job.scheduled_timezone || job.timezone || 'UTC',
		websiteId,
		websiteName: job.website_name || job.websiteName || '',
		websiteDomain: job.website_domain || job.websiteDomain || '',
		website: job.website && typeof job.website === 'object' ? job.website : undefined,
		title,
		previewUrl: pin?.image_url || job.preview_url || job.pinterest_pin_url || '',
		refType: PINTEREST_JOB_REF_TYPE,
		refId,
		actions: defaultActionsForStatus(status),
		readOnly: true,
		deepLinks: projected.deepLinks,
		performance: projected.performance,
	});
}

/**
 * @param {{
 *   fetchJobs?: (ctx: object, filters: object) => Promise<object[]>,
 *   resolveQueueMirror?: (sourceCollection: string, sourceId: string) => Promise<object|null>,
 * }} [options]
 */
export function createPinterestCalendarProvider(options = {}) {
	const fetchJobs = options.fetchJobs;
	const resolveQueueMirror = options.resolveQueueMirror;

	return {
		channel: PINTEREST_CALENDAR_CHANNEL,
		kind: 'channel_jobs',
		async listScheduledItems(ctx, filters) {
			if (typeof fetchJobs !== 'function') {
				throw new Error('Pinterest calendar provider requires fetchJobs');
			}
			const jobs = await fetchJobs(ctx, filters);
			const scheduled = (Array.isArray(jobs) ? jobs : [])
				.filter((job) => job?.scheduled_at || job?.scheduledAt);

			return Promise.all(scheduled.map(async (job) => {
				let queueMirror = null;
				if (typeof resolveQueueMirror === 'function' && job?.id) {
					queueMirror = await resolveQueueMirror(PINTEREST_JOB_REF_TYPE, job.id).catch(() => null);
				}
				return mapPinterestJobToScheduledItem(job, { queueMirror });
			}));
		},
	};
}
