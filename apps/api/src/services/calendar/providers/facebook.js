/**
 * Facebook channel provider for the Unified Calendar Facade.
 *
 * Owns facebook_publish_jobs → Scheduled Item mapping. Calendar facade must not
 * import Facebook business rules beyond registering this provider.
 *
 * Collection may be absent until Graph/publish pipeline ships — live source
 * returns [] gracefully. Same pattern as Pinterest / WordPress.
 */

import {
	buildScheduledItemId,
	defaultActionsForStatus,
	normalizeScheduledItem,
} from '../scheduled-item.js';
import { buildStudioDeepLinks } from '../studio-links.js';
import { buildFacebookHistoryHref } from '../product-links.js';
import { applyChannelJobProjections } from '../projections/apply.js';

export const FACEBOOK_CALENDAR_CHANNEL = 'facebook';
/** Reserved PocketBase collection / CHANNEL_JOB_REF_TYPES entry for Facebook jobs. */
export const FACEBOOK_JOB_REF_TYPE = 'facebook_publish_jobs';

/**
 * Map a facebook_publish_jobs row into a generic Scheduled Item.
 * Pure — safe for unit tests without PocketBase.
 *
 * @param {object} job
 * @param {{ queueMirror?: object|null }} [options]
 */
export function mapFacebookJobToScheduledItem(job = {}, options = {}) {
	const refId = String(job.id || '').trim();
	const status = job.status || 'scheduled';
	const page = job.expand?.page || job.page_record || null;
	const title = String(
		job.title
		|| job.message
		|| job.caption
		|| 'Facebook post',
	).trim();
	const websiteId = job.websiteId || job.website_id || page?.websiteId || page?.website_id || '';
	const studioPinId = job.ai_pin || job.aiPin || '';
	const pageId = job.page_id || job.pageId || page?.id || job.page || '';
	const pageName = job.page_label || job.pageLabel || page?.name || page?.label || '';

	const baseDeepLinks = buildStudioDeepLinks({}, {
		studioPinId,
		studioPath: '/app/ai-facebook-pages',
		websiteId,
		historyJobId: refId,
		historyHref: refId ? buildFacebookHistoryHref({ websiteId, jobId: refId }) : '',
		liveUrl: job.facebook_post_url || job.post_url || job.live_url || '',
		destinationUrl: job.destination_url || job.link_url || job.facebook_post_url || '',
		pageId,
		pageLabel: pageName,
		pageName,
		// Calendar row compat — shared mapper reads boardId/boardName.
		boardId: pageId,
		boardName: pageName,
		accountId: job.account || job.account_id || job.accountId || '',
		accountLabel: job.account_label || job.accountLabel || '',
		createdAt: job.created || job.createdAt || '',
		description: job.message || job.description || job.caption || '',
		facebookPostId: job.facebook_post_id != null ? String(job.facebook_post_id) : (job.post_id != null ? String(job.post_id) : ''),
	});

	const projected = applyChannelJobProjections(baseDeepLinks, job, {
		sourceCollection: FACEBOOK_JOB_REF_TYPE,
		sourceId: refId,
		websiteId,
		pinId: studioPinId,
		status,
		scheduledAt: job.scheduled_at || job.scheduledAt || null,
		performance: job.performance && typeof job.performance === 'object' ? job.performance : null,
		queueMirror: options.queueMirror || null,
	});

	return normalizeScheduledItem({
		id: buildScheduledItemId(FACEBOOK_CALENDAR_CHANNEL, refId),
		channel: FACEBOOK_CALENDAR_CHANNEL,
		status,
		scheduledAt: job.scheduled_at || job.scheduledAt || null,
		timezone: job.scheduled_timezone || job.timezone || 'UTC',
		websiteId,
		websiteName: job.website_name || job.websiteName || page?.website_name || '',
		websiteDomain: job.website_domain || job.websiteDomain || '',
		website: job.website && typeof job.website === 'object' ? job.website : undefined,
		title,
		previewUrl: job.image_url || job.preview_url || job.thumbnail_url || job.facebook_post_url || '',
		refType: FACEBOOK_JOB_REF_TYPE,
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
export function createFacebookCalendarProvider(options = {}) {
	const fetchJobs = options.fetchJobs;
	const resolveQueueMirror = options.resolveQueueMirror;

	return {
		channel: FACEBOOK_CALENDAR_CHANNEL,
		kind: 'channel_jobs',
		async listScheduledItems(ctx, filters) {
			if (typeof fetchJobs !== 'function') {
				throw new Error('Facebook calendar provider requires fetchJobs');
			}
			const jobs = await fetchJobs(ctx, filters);
			const scheduled = (Array.isArray(jobs) ? jobs : [])
				.filter((job) => job?.scheduled_at || job?.scheduledAt);

			return Promise.all(scheduled.map(async (job) => {
				let queueMirror = null;
				if (typeof resolveQueueMirror === 'function' && job?.id) {
					queueMirror = await resolveQueueMirror(FACEBOOK_JOB_REF_TYPE, job.id).catch(() => null);
				}
				return mapFacebookJobToScheduledItem(job, { queueMirror });
			}));
		},
	};
}
