/**
 * Normalize facebook_publish_jobs → PublishingHistoryItem.
 * Pure mapping — no I/O, no workflow side effects.
 */

import { PUBLISHING_JOB_COLLECTIONS } from './constants.js';
import {
	asIsoOrNull,
	asNumber,
	asText,
	baseItem,
	buildActions,
	normalizePublishingStatus,
} from './helpers.js';

/**
 * @param {object} job - facebook_publish_jobs record
 * @param {object} [ctx]
 * @param {object|null} [ctx.pin] - expanded ai_pin record
 * @param {string} [ctx.sourceModule]
 */
export function normalizeFacebookPublishJob(job = {}, ctx = {}) {
	const pin = ctx.pin || job.expand?.ai_pin || null;
	const nativeStatus = asText(job.status, 40);
	const status = normalizePublishingStatus(nativeStatus);
	const jobId = asText(job.id, 80);
	const item = baseItem({
		channel: 'facebook',
		jobId,
		jobCollection: PUBLISHING_JOB_COLLECTIONS.facebook,
	});

	const externalUrl = asText(job.facebook_post_url, 2000);
	const title = asText(pin?.title || job.title || 'Facebook Post', 500);
	const accountLabel = asText(job.account_label || job.accountLabel, 300);
	const pageName = asText(job.page_name || job.page_label, 300);

	item.sourceModule = asText(ctx.sourceModule, 40) || 'unknown';
	item.status = status;
	item.nativeStatus = nativeStatus;

	item.title = title;
	item.subtitle = pageName;
	item.description = asText(pin?.description || job.message || job.caption, 2000);
	item.imageUrl = asText(pin?.image_url || job.image_url, 2000);
	item.contentType = pin || job.ai_pin ? 'ai_pin' : 'unknown';
	item.contentId = asText(job.ai_pin || pin?.id, 80);
	item.websiteId = asText(job.websiteId || job.website_id, 80);
	item.destinationUrl = asText(
		pin?.destination_url || pin?.source_url || pin?.article_url || job.destination_url,
		2000,
	);

	item.destination = {
		kind: 'page',
		accountId: asText(job.account, 80),
		accountLabel,
		targetId: asText(job.page_id, 120),
		targetLabel: pageName,
		externalId: asText(job.facebook_post_id, 120),
		externalUrl,
	};

	item.scheduledAt = asIsoOrNull(job.scheduled_at);
	item.timezone = asText(job.timezone || job.scheduled_timezone, 80) || 'UTC';
	item.publishedAt = asIsoOrNull(job.published_at);
	item.createdAt = asText(job.created, 80);
	item.updatedAt = asText(job.updated, 80);
	item.attemptCount = asNumber(job.attempt_count, 0);
	item.maxAttempts = asNumber(job.max_attempts, 3) || 3;
	item.nextRetryAt = asIsoOrNull(job.next_retry_at);
	item.lastError = asText(job.last_error, 5000);

	item.actions = buildActions({
		status,
		externalUrl,
		retryPath: `/facebook/jobs/${encodeURIComponent(jobId)}/retry`,
		cancelPath: `/facebook/jobs/${encodeURIComponent(jobId)}/cancel`,
		publishNowPath: `/facebook/jobs/${encodeURIComponent(jobId)}/publish-now`,
	});

	item.workflowId = asText(job.workflow_id, 120) || null;
	item.correlationId = asText(job.correlation_id, 120) || null;

	item.channelPayload = {
		pageId: item.destination.targetId,
		pageName: item.destination.targetLabel,
		accountLabel,
		facebookPostId: item.destination.externalId,
		facebookPostUrl: externalUrl,
		message: asText(job.message, 5000),
		caption: asText(job.caption, 2000),
		articleId: asText(job.articleId || job.article_id, 80),
		performance: job.performance && typeof job.performance === 'object' ? job.performance : null,
		analyticsSyncedAt: asIsoOrNull(job.analytics_synced_at),
		post: pin
			? {
				id: asText(pin.id, 80),
				title: asText(pin.title, 500),
				description: asText(pin.description, 2000),
				overlayText: asText(pin.overlay_text, 500),
				imageUrl: asText(pin.image_url, 2000),
				status: asText(pin.status, 40),
			}
			: null,
	};

	return item;
}
