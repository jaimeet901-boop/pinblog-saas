/**
 * Normalize pinterest_publish_jobs → PublishingHistoryItem.
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

const PINTEREST_STATUS_ALIASES = Object.freeze({
	waiting_provider: 'publishing',
});

/**
 * @param {object} job - pinterest_publish_jobs record
 * @param {object} [ctx]
 * @param {object|null} [ctx.pin] - expanded ai_pin record
 * @param {string} [ctx.sourceModule]
 */
export function normalizePinterestPublishJob(job = {}, ctx = {}) {
	const pin = ctx.pin || job.expand?.ai_pin || null;
	const nativeStatus = asText(job.status, 40);
	const status = normalizePublishingStatus(nativeStatus, PINTEREST_STATUS_ALIASES);
	const jobId = asText(job.id, 80);
	const item = baseItem({
		channel: 'pinterest',
		jobId,
		jobCollection: PUBLISHING_JOB_COLLECTIONS.pinterest,
	});

	const externalUrl = asText(job.pinterest_pin_url, 2000);
	const title = asText(pin?.title || job.title || 'Pin', 500);
	const accountLabel = asText(job.account_label || job.accountUsername || job.account_username, 300);

	item.sourceModule = asText(ctx.sourceModule, 40) || 'unknown';
	item.status = status;
	item.nativeStatus = nativeStatus;

	item.title = title;
	item.subtitle = asText(job.board_name, 300);
	item.description = asText(pin?.description, 2000);
	item.imageUrl = asText(pin?.image_url || job.image_url, 2000);
	item.contentType = pin || job.ai_pin ? 'ai_pin' : 'unknown';
	item.contentId = asText(job.ai_pin || pin?.id, 80);
	item.websiteId = asText(job.websiteId || job.website_id, 80);
	item.destinationUrl = asText(
		pin?.destination_url || pin?.source_url || pin?.article_url || job.destination_url,
		2000,
	);

	item.destination = {
		kind: 'board',
		accountId: asText(job.account, 80),
		accountLabel,
		targetId: asText(job.board_id, 120),
		targetLabel: asText(job.board_name, 300),
		externalId: asText(job.pinterest_pin_id, 120),
		externalUrl,
	};

	item.scheduledAt = asIsoOrNull(job.scheduled_at);
	item.timezone = asText(job.timezone, 80) || 'UTC';
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
		retryPath: `/pinterest/jobs/${encodeURIComponent(jobId)}/retry`,
		cancelPath: `/pinterest/jobs/${encodeURIComponent(jobId)}/cancel`,
		publishNowPath: `/pinterest/jobs/${encodeURIComponent(jobId)}/publish-now`,
	});

	item.workflowId = asText(job.workflow_id, 120) || null;
	item.correlationId = asText(job.correlation_id, 120) || null;

	item.channelPayload = {
		boardId: item.destination.targetId,
		boardName: item.destination.targetLabel,
		accountUsername: asText(job.account_username, 200),
		pinterestPinId: item.destination.externalId,
		pinterestPinUrl: externalUrl,
		articleId: asText(job.articleId || job.article_id, 80),
		performance: job.performance && typeof job.performance === 'object' ? job.performance : null,
		pin: pin
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
