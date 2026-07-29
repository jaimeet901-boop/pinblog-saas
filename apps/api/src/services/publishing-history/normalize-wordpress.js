/**
 * Normalize publish_jobs (WordPress) → PublishingHistoryItem.
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
 * @param {object} job - publish_jobs record
 * @param {object} [ctx]
 * @param {object|null} [ctx.site] - optional wordpress_sites expand
 * @param {string} [ctx.sourceModule]
 */
export function normalizeWordpressPublishJob(job = {}, ctx = {}) {
	const site = ctx.site || job.expand?.site || null;
	const nativeStatus = asText(job.status, 40);
	const status = normalizePublishingStatus(nativeStatus);
	const jobId = asText(job.id, 80);
	const item = baseItem({
		channel: 'wordpress',
		jobId,
		jobCollection: PUBLISHING_JOB_COLLECTIONS.wordpress,
	});

	const externalId = job.wp_post_id != null && Number(job.wp_post_id) > 0
		? String(job.wp_post_id)
		: '';
	const externalUrl = asText(job.wp_post_url, 2000);
	const siteLabel = asText(site?.name || site?.url || site?.domain, 300);

	item.sourceModule = asText(ctx.sourceModule, 40) || 'unknown';
	item.status = status;
	item.nativeStatus = nativeStatus;

	item.title = asText(job.title, 500) || 'WordPress post';
	item.subtitle = siteLabel;
	item.description = asText(job.excerpt || job.meta_description, 2000);
	item.imageUrl = asText(job.featured_image_url, 2000);
	item.contentType = job.article_id ? 'article' : 'blog_post';
	item.contentId = asText(job.article_id, 80);
	item.websiteId = asText(job.website_id || job.websiteId || site?.websiteId || site?.website_id, 80);
	item.destinationUrl = externalUrl;

	item.destination = {
		kind: 'website',
		accountId: '',
		accountLabel: '',
		targetId: asText(job.site, 80),
		targetLabel: siteLabel,
		externalId,
		externalUrl,
	};

	item.scheduledAt = asIsoOrNull(job.scheduled_at);
	item.timezone = asText(job.timezone, 80) || 'UTC';
	item.publishedAt = status === 'published'
		? asIsoOrNull(job.published_at || job.completed_at)
		: asIsoOrNull(job.published_at);
	item.createdAt = asText(job.created, 80);
	item.updatedAt = asText(job.updated, 80);
	item.attemptCount = asNumber(job.attempt_count, 0);
	item.maxAttempts = asNumber(job.max_attempts, 3) || 3;
	item.nextRetryAt = asIsoOrNull(job.next_retry_at);
	item.lastError = asText(job.last_error, 5000);

	item.actions = buildActions({
		status,
		externalUrl,
		retryPath: `/wordpress/jobs/${encodeURIComponent(jobId)}/retry`,
		cancelPath: `/wordpress/jobs/${encodeURIComponent(jobId)}/cancel`,
		publishNowPath: null,
	});

	item.workflowId = asText(job.workflow_id, 120) || null;
	item.correlationId = asText(job.correlation_id || job.idempotency_key, 120) || null;

	item.channelPayload = {
		siteId: item.destination.targetId,
		wpStatus: asText(job.wp_status, 40),
		wpPostId: job.wp_post_id != null ? Number(job.wp_post_id) || null : null,
		wpPostUrl: externalUrl,
		progress: asNumber(job.progress, 0),
		slug: asText(job.slug, 300),
		deadLetter: Boolean(job.dead_letter),
	};

	return item;
}
