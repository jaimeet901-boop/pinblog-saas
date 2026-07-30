/**
 * Apply C8 Queue / Analytics / Notification projections onto channel-job Scheduled Items.
 * Pure orchestration used by channel providers — not by facade.js.
 */

import { projectAnalyticsMetadata } from './analytics.js';
import { projectNotificationState } from './notifications.js';
import { projectQueueState } from './queue.js';

/**
 * Merge projection payloads into deepLinks + performance without channel branches.
 *
 * @param {object} baseDeepLinks
 * @param {object} job  Channel job row (or pin-like record)
 * @param {{
 *   sourceCollection: string,
 *   sourceId: string,
 *   websiteId?: string,
 *   pinId?: string,
 *   status?: string,
 *   scheduledAt?: string,
 *   performance?: object|null,
 *   queueMirror?: object|null,
 * }} ctx
 */
export function applyChannelJobProjections(baseDeepLinks = {}, job = {}, ctx = {}) {
	const sourceCollection = String(ctx.sourceCollection || '').trim();
	const sourceId = String(ctx.sourceId || job.id || '').trim();
	const websiteId = String(ctx.websiteId || job.websiteId || job.website_id || '').trim();
	const status = ctx.status || job.status || 'scheduled';
	const scheduledAt = ctx.scheduledAt || job.scheduled_at || job.scheduledAt || null;
	const pinId = String(ctx.pinId || '').trim();
	const mirror = ctx.queueMirror && typeof ctx.queueMirror === 'object' ? ctx.queueMirror : null;

	const queue = projectQueueState({
		sourceCollection,
		sourceId,
		status: mirror?.status || status,
		attemptCount: mirror?.attempt_count ?? job.attempt_count,
		maxAttempts: mirror?.max_attempts ?? job.max_attempts,
		nextRetryAt: mirror?.next_retry_at ?? job.next_retry_at,
		progress: mirror?.progress ?? job.progress,
		deadLetter: mirror?.dead_letter ?? job.dead_letter,
		queueJobId: mirror?.id || job.queue_job_id || '',
		websiteId,
	});

	const analytics = projectAnalyticsMetadata({
		status,
		websiteId,
		pinId,
		jobId: sourceId,
		performance: ctx.performance !== undefined ? ctx.performance : job.performance,
	});

	const notification = projectNotificationState({
		status,
		scheduledAt,
	});

	return {
		deepLinks: {
			...baseDeepLinks,
			historyHref: baseDeepLinks.historyHref
				|| (sourceId ? `/app/pinterest-history?${new URLSearchParams({
					...(websiteId ? { websiteId } : {}),
					jobId: sourceId,
				}).toString()}` : ''),
			analyticsHref: analytics.analyticsHref,
			queue: queue,
			analytics: analytics.analytics,
			notification,
		},
		performance: analytics.performance,
	};
}
