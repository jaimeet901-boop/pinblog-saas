/**
 * Facebook Channel Pack — publish execution events (F4-5).
 * Pure builders + idempotent event recording for the publish worker lifecycle.
 */

import { sanitizeFacebookGraphErrorPayload } from './graph-publish.js';

/** Canonical facebook_publish_events.event_type values for execution lifecycle. */
export const FACEBOOK_PUBLISH_EVENT_TYPES = Object.freeze({
	CREATED: 'created',
	SCHEDULE_UPDATED: 'schedule_updated',
	CANCELLED: 'cancelled',
	RETRY_MANUAL: 'retry_manual',
	CLAIMED: 'claimed',
	PUBLISHED: 'published',
	FAILED: 'failed',
	RETRY_SCHEDULED: 'retry_scheduled',
});

/** Back-compat alias used by F4-2 publish service. */
export const FACEBOOK_PUBLISH_CREATED_EVENT_TYPE = FACEBOOK_PUBLISH_EVENT_TYPES.CREATED;

/** Monotonic sequence for lifecycle ordering (lower = earlier). */
export const FACEBOOK_PUBLISH_EVENT_SEQUENCE = Object.freeze({
	[FACEBOOK_PUBLISH_EVENT_TYPES.CREATED]: 10,
	[FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED]: 12,
	[FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL]: 12,
	[FACEBOOK_PUBLISH_EVENT_TYPES.CLAIMED]: 20,
	[FACEBOOK_PUBLISH_EVENT_TYPES.PUBLISHED]: 30,
	[FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_SCHEDULED]: 30,
	[FACEBOOK_PUBLISH_EVENT_TYPES.FAILED]: 30,
	[FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED]: 35,
});

export const FACEBOOK_PUBLISH_FAILURE_KINDS = Object.freeze({
	TOKEN_EXPIRED: 'token_expired',
	PERMISSION_DENIED: 'permission_denied',
	RATE_LIMITED: 'rate_limited',
	RETRYABLE: 'retryable',
	TERMINAL: 'terminal',
	VALIDATION: 'validation',
});

function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

/**
 * Redact token-like values from event payloads before persistence.
 *
 * @param {unknown} payload
 */
export function sanitizeFacebookPublishEventPayload(payload) {
	if (payload == null) return null;
	try {
		const text = JSON.stringify(payload);
		const redacted = text
			.replace(/access_token=[^&"\s]+/gi, 'access_token=[REDACTED]')
			.replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[REDACTED]"')
			.replace(/EAAG[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]')
			.replace(/page-token-plain/gi, '[REDACTED_TOKEN]');
		return JSON.parse(redacted);
	} catch {
		return { message: 'Event payload could not be sanitized' };
	}
}

/**
 * Stable idempotency key per lifecycle transition.
 */
export function buildFacebookPublishEventIdempotencyKey({
	jobId = '',
	eventType = '',
	claimToken = '',
	attempt = 0,
	facebookPostId = '',
	scheduledAt = '',
} = {}) {
	const id = String(jobId || '').trim();
	const type = String(eventType || '').trim();
	if (!id || !type) return '';

	switch (type) {
	case FACEBOOK_PUBLISH_EVENT_TYPES.CREATED:
		return `created:${id}`;
	case FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED: {
		const at = String(scheduledAt || '').trim();
		return at ? `schedule_updated:${id}:${at}` : `schedule_updated:${id}`;
	}
	case FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED:
		return `cancelled:${id}`;
	case FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL:
		return `retry_manual:${id}:attempt:0`;
	case FACEBOOK_PUBLISH_EVENT_TYPES.CLAIMED: {
		const token = String(claimToken || '').trim();
		return token ? `claimed:${id}:${token}` : `claimed:${id}`;
	}
	case FACEBOOK_PUBLISH_EVENT_TYPES.PUBLISHED: {
		const postId = String(facebookPostId || '').trim();
		return postId ? `published:${id}:${postId}` : `published:${id}:attempt:${attempt || 0}`;
	}
	case FACEBOOK_PUBLISH_EVENT_TYPES.FAILED:
		return `failed:${id}:attempt:${attempt || 0}`;
	case FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_SCHEDULED:
		return `retry_scheduled:${id}:attempt:${attempt || 0}`;
	default:
		return `${type}:${id}`;
	}
}

/**
 * Compare two execution events for timeline ordering.
 */
export function compareFacebookPublishEvents(a, b) {
	const seqA = Number(a?.payload?.sequence ?? FACEBOOK_PUBLISH_EVENT_SEQUENCE[a?.event_type] ?? 0);
	const seqB = Number(b?.payload?.sequence ?? FACEBOOK_PUBLISH_EVENT_SEQUENCE[b?.event_type] ?? 0);
	if (seqA !== seqB) return seqA - seqB;
	const atA = new Date(a?.created || a?.at || 0).getTime();
	const atB = new Date(b?.created || b?.at || 0).getTime();
	if (Number.isFinite(atA) && Number.isFinite(atB) && atA !== atB) return atA - atB;
	return String(a?.payload?.idempotencyKey || '').localeCompare(String(b?.payload?.idempotencyKey || ''));
}

/**
 * True when an idempotency key already exists for the job.
 *
 * @param {string[]} existingKeys
 * @param {string} idempotencyKey
 */
export function hasExistingFacebookPublishEventKey(existingKeys, idempotencyKey) {
	const key = String(idempotencyKey || '').trim();
	if (!key) return false;
	return (existingKeys || []).includes(key);
}

/**
 * Classify normalized Graph/worker errors for event payloads.
 *
 * @param {unknown} error
 */
export function classifyFacebookPublishFailure(error = {}) {
	if (error.tokenExpired || error.errorCode === 'FACEBOOK_TOKEN_EXPIRED') {
		return FACEBOOK_PUBLISH_FAILURE_KINDS.TOKEN_EXPIRED;
	}
	if (error.errorCode === 'FACEBOOK_GRAPH_PERMISSION_DENIED') {
		return FACEBOOK_PUBLISH_FAILURE_KINDS.PERMISSION_DENIED;
	}
	if (error.errorCode === 'FACEBOOK_GRAPH_RATE_LIMITED' || error.status === 429) {
		return FACEBOOK_PUBLISH_FAILURE_KINDS.RATE_LIMITED;
	}
	if (error.retryable === false) {
		return FACEBOOK_PUBLISH_FAILURE_KINDS.TERMINAL;
	}
	if (error.status === 422 && error.retryable === false) {
		return FACEBOOK_PUBLISH_FAILURE_KINDS.VALIDATION;
	}
	return FACEBOOK_PUBLISH_FAILURE_KINDS.RETRYABLE;
}

/**
 * Build PocketBase create payload for facebook_publish_events (pure).
 */
export function buildFacebookPublishEventRecord({
	owner = '',
	workspaceId = '',
	jobId = '',
	eventType = '',
	message = '',
	payload = null,
} = {}) {
	const record = {
		owner: String(owner || '').trim(),
		event_type: String(eventType || '').trim(),
		message: String(message || '').trim().slice(0, 2000),
		payload: payload == null ? null : sanitizeFacebookPublishEventPayload(payload),
	};
	const ws = recordFieldId(workspaceId);
	if (ws) record.workspace = ws;
	if (jobId) record.job = String(jobId).trim();
	return record;
}

export function buildFacebookPublishCreatedEventPayload(input = {}) {
	const {
		owner = '',
		workspaceId = '',
		jobId = '',
		accountId = '',
		pageId = '',
		aiPinId = '',
		scheduledAt = '',
		timezone = 'UTC',
		publishMode = 'now',
	} = input;

	const jobIdStr = String(jobId || '').trim();
	const idempotencyKey = buildFacebookPublishEventIdempotencyKey({
		jobId: jobIdStr,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.CREATED,
	});

	return buildFacebookPublishEventRecord({
		owner,
		workspaceId,
		jobId: jobIdStr,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.CREATED,
		message: 'Facebook publish job created',
		payload: {
			idempotencyKey,
			sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE[FACEBOOK_PUBLISH_EVENT_TYPES.CREATED],
			accountId: String(accountId || '').trim(),
			pageId: String(pageId || '').trim(),
			aiPinId: String(aiPinId || '').trim(),
			scheduledAt: scheduledAt || null,
			timezone: String(timezone || 'UTC').trim() || 'UTC',
			publishMode: String(publishMode || 'now').trim() || 'now',
		},
	});
}

export function buildFacebookPublishScheduleUpdatedEventPayload({
	job = {},
	updates = {},
	publishNow = false,
} = {}) {
	const jobId = String(job.id || '').trim();
	const scheduledAt = String(
		updates.scheduled_at
		|| updates.scheduledAt
		|| job.scheduled_at
		|| job.scheduledAt
		|| '',
	).trim();
	const idempotencyKey = buildFacebookPublishEventIdempotencyKey({
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED,
		scheduledAt,
	});

	return buildFacebookPublishEventRecord({
		owner: job.owner,
		workspaceId: job.workspace,
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED,
		message: publishNow ? 'Facebook publish job moved to immediate queue' : 'Facebook publish job rescheduled',
		payload: {
			idempotencyKey,
			sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE[FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED],
			scheduledAt: scheduledAt || null,
			timezone: String(
				updates.scheduled_timezone
				|| updates.timezone
				|| job.scheduled_timezone
				|| job.timezone
				|| 'UTC',
			).trim() || 'UTC',
			publishNow: Boolean(publishNow),
			accountId: String(updates.account || job.account || '').trim(),
			pageId: String(updates.page_id || job.page_id || '').trim(),
		},
	});
}

export function buildFacebookPublishCancelledEventPayload({ job = {} } = {}) {
	const jobId = String(job.id || '').trim();
	const idempotencyKey = buildFacebookPublishEventIdempotencyKey({
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED,
	});

	return buildFacebookPublishEventRecord({
		owner: job.owner,
		workspaceId: job.workspace,
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED,
		message: 'Facebook publish job cancelled',
		payload: {
			idempotencyKey,
			sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE[FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED],
		},
	});
}

export function buildFacebookPublishRetryManualEventPayload({ job = {} } = {}) {
	const jobId = String(job.id || '').trim();
	const idempotencyKey = buildFacebookPublishEventIdempotencyKey({
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL,
	});

	return buildFacebookPublishEventRecord({
		owner: job.owner,
		workspaceId: job.workspace,
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL,
		message: 'Facebook publish job manually retried',
		payload: {
			idempotencyKey,
			sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE[FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL],
			scheduledAt: job.scheduled_at || job.scheduledAt || null,
		},
	});
}

export function buildFacebookPublishClaimedEventPayload({
	job = {},
	claimToken = '',
} = {}) {
	const jobId = String(job.id || '').trim();
	const idempotencyKey = buildFacebookPublishEventIdempotencyKey({
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.CLAIMED,
		claimToken,
	});

	return buildFacebookPublishEventRecord({
		owner: job.owner,
		workspaceId: job.workspace,
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.CLAIMED,
		message: 'Facebook publish job claimed',
		payload: {
			idempotencyKey,
			sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE[FACEBOOK_PUBLISH_EVENT_TYPES.CLAIMED],
			claimVersion: Number(job.claim_version ?? job.claimVersion) || 0,
			attempt: Number(job.attempt_count ?? job.attemptCount) || 0,
		},
	});
}

export function buildFacebookPublishPublishedEventPayload({
	job = {},
	facebookPostId = '',
	facebookPostUrl = '',
	idempotent = false,
} = {}) {
	const jobId = String(job.id || '').trim();
	const postId = String(facebookPostId || '').trim();
	const attempt = (Number(job.attempt_count ?? job.attemptCount) || 0) + (idempotent ? 0 : 1);
	const idempotencyKey = buildFacebookPublishEventIdempotencyKey({
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.PUBLISHED,
		facebookPostId: postId,
		attempt,
	});

	return buildFacebookPublishEventRecord({
		owner: job.owner,
		workspaceId: job.workspace,
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.PUBLISHED,
		message: idempotent ? 'Post already published; skipped duplicate create' : 'Facebook post published',
		payload: {
			idempotencyKey,
			sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE[FACEBOOK_PUBLISH_EVENT_TYPES.PUBLISHED],
			facebookPostId: postId,
			facebookPostUrl: String(facebookPostUrl || '').trim(),
			attempt,
			idempotent: Boolean(idempotent),
		},
	});
}

export function buildFacebookPublishRetryScheduledEventPayload({
	job = {},
	normalizedError = {},
	nextRetryAt = null,
	attempt = 0,
	maxAttempts = 3,
} = {}) {
	const jobId = String(job.id || '').trim();
	const nextAttempts = Number(attempt) || (Number(job.attempt_count ?? job.attemptCount) || 0) + 1;
	const failureKind = classifyFacebookPublishFailure(normalizedError);

	return buildFacebookPublishEventRecord({
		owner: job.owner,
		workspaceId: job.workspace,
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_SCHEDULED,
		message: String(normalizedError?.message || 'Facebook publish retry scheduled').slice(0, 2000),
		payload: sanitizeFacebookPublishEventPayload({
			idempotencyKey: buildFacebookPublishEventIdempotencyKey({
				jobId,
				eventType: FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_SCHEDULED,
				attempt: nextAttempts,
			}),
			sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE[FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_SCHEDULED],
			attempt: nextAttempts,
			maxAttempts,
			nextRetryAt,
			errorCode: normalizedError?.errorCode || null,
			retryable: normalizedError?.retryable !== false,
			failureKind,
			rateLimitRetryAfterMs: normalizedError?.rateLimitRetryAfterMs || null,
		}),
	});
}

export function buildFacebookPublishFailedEventPayload({
	job = {},
	normalizedError = {},
	attempt = 0,
	maxAttempts = 3,
} = {}) {
	const jobId = String(job.id || '').trim();
	const nextAttempts = Number(attempt) || (Number(job.attempt_count ?? job.attemptCount) || 0) + 1;
	const failureKind = classifyFacebookPublishFailure(normalizedError);
	const raw = normalizedError?.raw
		? sanitizeFacebookGraphErrorPayload(normalizedError.raw)
		: null;

	return buildFacebookPublishEventRecord({
		owner: job.owner,
		workspaceId: job.workspace,
		jobId,
		eventType: FACEBOOK_PUBLISH_EVENT_TYPES.FAILED,
		message: String(normalizedError?.message || 'Facebook publish failed').slice(0, 2000),
		payload: sanitizeFacebookPublishEventPayload({
			idempotencyKey: buildFacebookPublishEventIdempotencyKey({
				jobId,
				eventType: FACEBOOK_PUBLISH_EVENT_TYPES.FAILED,
				attempt: nextAttempts,
			}),
			sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE[FACEBOOK_PUBLISH_EVENT_TYPES.FAILED],
			attempt: nextAttempts,
			maxAttempts,
			errorCode: normalizedError?.errorCode || null,
			retryable: false,
			failureKind,
			tokenExpired: Boolean(normalizedError?.tokenExpired),
			graphCode: normalizedError?.graphCode ?? null,
			sanitizedRaw: raw,
		}),
	});
}

async function resolveEventDeps(deps = {}) {
	let pocketbaseClient = deps.pocketbaseClient;
	if (!pocketbaseClient) {
		pocketbaseClient = (await import('../../utils/pocketbaseClient.js')).default;
	}

	let sanitizeCollectionPayload = deps.sanitizeCollectionPayload;
	if (!sanitizeCollectionPayload) {
		({ sanitizeCollectionPayload } = await import('../../utils/pocketbase-safe-query.js'));
	}

	return { pocketbaseClient, sanitizeCollectionPayload };
}

/**
 * Load persisted idempotency keys for a job (newest-first scan, capped).
 */
export async function loadFacebookPublishEventIdempotencyKeys(jobId, deps = {}, limit = 50) {
	const id = String(jobId || '').trim();
	if (!id) return [];

	if (typeof deps.loadEventIdempotencyKeys === 'function') {
		return deps.loadEventIdempotencyKeys(id);
	}

	const { pocketbaseClient } = await resolveEventDeps(deps);
	const result = await pocketbaseClient.collection('facebook_publish_events').getList(1, limit, {
		filter: pocketbaseClient.filter('job = {:job}', { job: id }),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	return (result.items || [])
		.map((row) => String(row?.payload?.idempotencyKey || '').trim())
		.filter(Boolean);
}

/**
 * Idempotent append of a facebook_publish_events row.
 *
 * @returns {Promise<{ skipped: boolean, idempotencyKey: string, record?: object }>}
 */
export async function recordFacebookPublishEvent({
	job = {},
	eventRecord = {},
	deps = {},
}) {
	const record = eventRecord?.event_type ? eventRecord : null;
	if (!record) {
		return { skipped: true, idempotencyKey: '' };
	}

	const idempotencyKey = String(record.payload?.idempotencyKey || '').trim();
	const existingKeys = await loadFacebookPublishEventIdempotencyKeys(job.id, deps);
	if (hasExistingFacebookPublishEventKey(existingKeys, idempotencyKey)) {
		return { skipped: true, idempotencyKey };
	}

	if (typeof deps.createPublishEvent === 'function') {
		await deps.createPublishEvent(record);
		return { skipped: false, idempotencyKey, record };
	}

	const { pocketbaseClient, sanitizeCollectionPayload } = await resolveEventDeps(deps);
	const createPayload = await sanitizeCollectionPayload({
		collection: 'facebook_publish_events',
		context: 'facebook:record-publish-event',
		payload: record,
	}).catch(() => record);

	await pocketbaseClient.collection('facebook_publish_events').create(createPayload).catch(() => null);
	return { skipped: false, idempotencyKey, record };
}

/**
 * Optional execution bookkeeping on facebook_publish_jobs (no schema changes).
 * Persists sanitized terminal error metadata when the field exists.
 */
export async function applyFacebookPublishExecutionBookkeeping({
	jobId,
	status,
	lastError = '',
	normalizedError = null,
	deps = {},
}) {
	if (!jobId || !status) return null;

	const patch = {
		last_error: String(lastError || '').slice(0, 3000),
	};
	if (normalizedError?.raw) {
		patch.raw_api_error = sanitizeFacebookGraphErrorPayload(normalizedError.raw);
	} else if (status === 'published') {
		patch.raw_api_error = null;
	}

	if (typeof deps.updateJob === 'function') {
		return deps.updateJob(jobId, patch);
	}

	const { pocketbaseClient } = await resolveEventDeps(deps);
	return pocketbaseClient.collection('facebook_publish_jobs').update(jobId, patch).catch(() => null);
}
