/**
 * WordPress channel provider for the Unified Calendar Facade.
 *
 * Owns publish_jobs → Scheduled Item mapping. Calendar facade must not import
 * WordPress business rules beyond registering this provider.
 */

import {
	buildScheduledItemId,
	defaultActionsForStatus,
	normalizeScheduledItem,
} from '../scheduled-item.js';
import { applyChannelJobProjections } from '../projections/apply.js';

export const WORDPRESS_CALENDAR_CHANNEL = 'wordpress';
/** Actual PocketBase collection for WordPress publish jobs. */
export const WORDPRESS_JOB_REF_TYPE = 'publish_jobs';

/**
 * Map a publish_jobs row into a generic Scheduled Item.
 * Pure — safe for unit tests without PocketBase.
 *
 * @param {object} job
 * @param {{ queueMirror?: object|null }} [options]
 */
export function mapWordpressJobToScheduledItem(job = {}, options = {}) {
	const refId = String(job.id || '').trim();
	const status = job.status || 'scheduled';
	const site = job.expand?.site || job.site_record || null;
	const title = String(
		job.title
		|| job.slug
		|| 'WordPress post',
	).trim();
	const websiteId = job.website_id || job.websiteId || site?.websiteId || site?.website_id || '';

	const baseDeepLinks = {
		historyJobId: refId,
		liveUrl: job.wp_post_url || '',
		destinationUrl: job.wp_post_url || '',
		siteId: job.site || site?.id || '',
		siteLabel: site?.name || site?.url || site?.domain || '',
		articleId: job.article_id || job.articleId || '',
		createdAt: job.created || job.createdAt || '',
		description: job.excerpt || job.meta_description || '',
		wpStatus: job.wp_status || '',
		wpPostId: job.wp_post_id != null ? String(job.wp_post_id) : '',
	};

	const projected = applyChannelJobProjections(baseDeepLinks, job, {
		sourceCollection: WORDPRESS_JOB_REF_TYPE,
		sourceId: refId,
		websiteId,
		status,
		scheduledAt: job.scheduled_at || job.scheduledAt || null,
		performance: null,
		queueMirror: options.queueMirror || null,
	});

	return normalizeScheduledItem({
		id: buildScheduledItemId(WORDPRESS_CALENDAR_CHANNEL, refId),
		channel: WORDPRESS_CALENDAR_CHANNEL,
		status,
		scheduledAt: job.scheduled_at || job.scheduledAt || null,
		timezone: job.timezone || 'UTC',
		websiteId,
		websiteName: site?.name || job.website_name || job.websiteName || '',
		websiteDomain: site?.domain || site?.url || job.website_domain || '',
		website: job.website && typeof job.website === 'object' ? job.website : undefined,
		title,
		previewUrl: job.featured_image_url || job.preview_url || job.wp_post_url || '',
		refType: WORDPRESS_JOB_REF_TYPE,
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
export function createWordpressCalendarProvider(options = {}) {
	const fetchJobs = options.fetchJobs;
	const resolveQueueMirror = options.resolveQueueMirror;

	return {
		channel: WORDPRESS_CALENDAR_CHANNEL,
		kind: 'channel_jobs',
		async listScheduledItems(ctx, filters) {
			if (typeof fetchJobs !== 'function') {
				throw new Error('WordPress calendar provider requires fetchJobs');
			}
			const jobs = await fetchJobs(ctx, filters);
			const scheduled = (Array.isArray(jobs) ? jobs : [])
				.filter((job) => job?.scheduled_at || job?.scheduledAt);

			return Promise.all(scheduled.map(async (job) => {
				let queueMirror = null;
				if (typeof resolveQueueMirror === 'function' && job?.id) {
					queueMirror = await resolveQueueMirror(WORDPRESS_JOB_REF_TYPE, job.id).catch(() => null);
				}
				return mapWordpressJobToScheduledItem(job, { queueMirror });
			}));
		},
	};
}
