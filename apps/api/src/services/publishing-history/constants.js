/**
 * Publishing History — normalized model contract (Option B read model).
 * Derived from specialized job collections; never persisted.
 */

export const PUBLISHING_CHANNELS = Object.freeze([
	'pinterest',
	'wordpress',
	'facebook',
	'instagram',
	'x',
	'linkedin',
]);

/** Generic destination kinds — platform-agnostic. */
export const PUBLISHING_DESTINATION_KINDS = Object.freeze([
	'board',
	'website',
	'page',
	'profile',
	'account',
	'group',
	'community',
	'channel',
	'unknown',
]);

export const PUBLISHING_CONTENT_TYPES = Object.freeze([
	'ai_pin',
	'article',
	'recipe',
	'blog_post',
	'image',
	'video',
	'short',
	'product',
	'media',
	'unknown',
]);

export const PUBLISHING_STATUSES = Object.freeze([
	'queued',
	'scheduled',
	'publishing',
	'retrying',
	'published',
	'failed',
	'cancelled',
]);

export const PUBLISHING_SOURCE_MODULES = Object.freeze([
	'ai_pins',
	'writer',
	'calendar',
	'images',
	'chef_ia',
	'api',
	'unknown',
]);

export const PUBLISHING_JOB_COLLECTIONS = Object.freeze({
	pinterest: 'pinterest_publish_jobs',
	wordpress: 'publish_jobs',
	facebook: 'facebook_publish_jobs',
});

/** @returns {object} Complete PublishingHistoryItem with empty defaults. */
export function emptyPublishingHistoryItem() {
	return {
		id: '',
		jobId: '',
		channel: 'pinterest',
		jobCollection: '',
		sourceModule: 'unknown',
		status: 'queued',
		nativeStatus: '',
		title: '',
		subtitle: '',
		description: '',
		imageUrl: '',
		contentType: 'unknown',
		contentId: '',
		websiteId: '',
		destinationUrl: '',
		destination: {
			kind: 'unknown',
			accountId: '',
			accountLabel: '',
			targetId: '',
			targetLabel: '',
			externalId: '',
			externalUrl: '',
		},
		scheduledAt: null,
		timezone: '',
		publishedAt: null,
		createdAt: '',
		updatedAt: '',
		attemptCount: 0,
		maxAttempts: 3,
		nextRetryAt: null,
		lastError: '',
		actions: {
			canRetry: false,
			canCancel: false,
			canPublishNow: false,
			canOpenExternal: false,
			retryPath: null,
			cancelPath: null,
			publishNowPath: null,
		},
		workflowId: null,
		correlationId: null,
		channelPayload: {},
	};
}

export function buildPublishingHistoryId(channel, jobId) {
	return `${String(channel || '').trim()}:${String(jobId || '').trim()}`;
}
