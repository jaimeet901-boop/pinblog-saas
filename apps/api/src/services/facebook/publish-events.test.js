import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildFacebookPublishClaimedEventPayload,
	buildFacebookPublishCancelledEventPayload,
	buildFacebookPublishCreatedEventPayload,
	buildFacebookPublishEventIdempotencyKey,
	buildFacebookPublishFailedEventPayload,
	buildFacebookPublishPublishedEventPayload,
	buildFacebookPublishRetryManualEventPayload,
	buildFacebookPublishRetryScheduledEventPayload,
	buildFacebookPublishScheduleUpdatedEventPayload,
	classifyFacebookPublishFailure,
	compareFacebookPublishEvents,
	FACEBOOK_PUBLISH_EVENT_TYPES,
	FACEBOOK_PUBLISH_USER_EVENT_TYPES,
	FACEBOOK_PUBLISH_FAILURE_KINDS,
	hasExistingFacebookPublishEventKey,
	recordFacebookPublishEvent,
	recordFacebookPublishUserEvent,
	sanitizeFacebookPublishEventPayload,
} from './publish-events.js';

const baseJob = {
	id: 'job_1',
	owner: 'user_1',
	workspace: 'ws_1',
	attempt_count: 0,
	max_attempts: 3,
	claim_token: 'claim_abc',
	claim_version: 2,
};

describe('facebook F4-5 publish execution events', () => {
	it('buildFacebookPublishCreatedEventPayload includes created lifecycle metadata', () => {
		const record = buildFacebookPublishCreatedEventPayload({
			owner: 'user_1',
			workspaceId: 'ws_1',
			accountId: 'acc_1',
			pageId: '123',
			aiPinId: 'pin_1',
			scheduledAt: '2026-08-06T12:00:00.000Z',
		});
		assert.equal(record.event_type, FACEBOOK_PUBLISH_EVENT_TYPES.CREATED);
		assert.equal(record.owner, 'user_1');
		assert.equal(record.workspace, 'ws_1');
		assert.equal(record.payload.idempotencyKey, '');
		assert.equal(record.payload.sequence, 10);
	});

	it('buildFacebookPublishCreatedEventPayload includes job-scoped idempotency key', () => {
		const record = buildFacebookPublishCreatedEventPayload({
			owner: 'user_1',
			jobId: 'job_1',
		});
		assert.equal(record.payload.idempotencyKey, 'created:job_1');
	});

	it('buildFacebookPublishClaimedEventPayload uses claim token idempotency', () => {
		const record = buildFacebookPublishClaimedEventPayload({
			job: baseJob,
			claimToken: 'claim_abc',
		});
		assert.equal(record.event_type, FACEBOOK_PUBLISH_EVENT_TYPES.CLAIMED);
		assert.equal(record.payload.idempotencyKey, 'claimed:job_1:claim_abc');
		assert.equal(record.payload.sequence, 20);
	});

	it('buildFacebookPublishPublishedEventPayload captures post metadata', () => {
		const record = buildFacebookPublishPublishedEventPayload({
			job: baseJob,
			facebookPostId: '123_456',
			facebookPostUrl: 'https://www.facebook.com/123_456',
		});
		assert.equal(record.event_type, FACEBOOK_PUBLISH_EVENT_TYPES.PUBLISHED);
		assert.equal(record.payload.facebookPostId, '123_456');
		assert.equal(record.payload.idempotencyKey, 'published:job_1:123_456');
	});

	it('buildFacebookPublishFailedEventPayload classifies terminal failures', () => {
		const record = buildFacebookPublishFailedEventPayload({
			job: baseJob,
			normalizedError: {
				message: 'Invalid parameter',
				errorCode: 'FACEBOOK_GRAPH_INVALID_PARAMETER',
				retryable: false,
				status: 422,
			},
			attempt: 3,
			maxAttempts: 3,
		});
		assert.equal(record.event_type, FACEBOOK_PUBLISH_EVENT_TYPES.FAILED);
		assert.equal(record.payload.failureKind, FACEBOOK_PUBLISH_FAILURE_KINDS.TERMINAL);
		assert.equal(record.payload.idempotencyKey, 'failed:job_1:attempt:3');
	});

	it('buildFacebookPublishRetryScheduledEventPayload classifies rate limits and token expiry', () => {
		const rateLimit = buildFacebookPublishRetryScheduledEventPayload({
			job: baseJob,
			normalizedError: {
				message: 'rate limited',
				errorCode: 'FACEBOOK_GRAPH_RATE_LIMITED',
				retryable: true,
				rateLimitRetryAfterMs: 30000,
			},
			nextRetryAt: '2026-08-06T12:05:00.000Z',
			attempt: 1,
		});
		assert.equal(rateLimit.event_type, FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_SCHEDULED);
		assert.equal(rateLimit.payload.failureKind, FACEBOOK_PUBLISH_FAILURE_KINDS.RATE_LIMITED);

		const tokenExpired = buildFacebookPublishFailedEventPayload({
			job: baseJob,
			normalizedError: {
				message: 'Token expired',
				errorCode: 'FACEBOOK_TOKEN_EXPIRED',
				tokenExpired: true,
				retryable: false,
			},
			attempt: 1,
		});
		assert.equal(classifyFacebookPublishFailure({ tokenExpired: true, errorCode: 'FACEBOOK_TOKEN_EXPIRED' }),
			FACEBOOK_PUBLISH_FAILURE_KINDS.TOKEN_EXPIRED);
		assert.equal(tokenExpired.payload.failureKind, FACEBOOK_PUBLISH_FAILURE_KINDS.TOKEN_EXPIRED);

		const permission = buildFacebookPublishFailedEventPayload({
			job: baseJob,
			normalizedError: {
				message: 'Permission denied',
				errorCode: 'FACEBOOK_GRAPH_PERMISSION_DENIED',
				retryable: false,
			},
			attempt: 1,
		});
		assert.equal(permission.payload.failureKind, FACEBOOK_PUBLISH_FAILURE_KINDS.PERMISSION_DENIED);
	});

	it('sanitizeFacebookPublishEventPayload redacts access tokens', () => {
		const sanitized = sanitizeFacebookPublishEventPayload({
			access_token: 'EAAG1234567890',
			nested: { accessToken: 'page-token-plain', message: 'ok' },
		});
		const serialized = JSON.stringify(sanitized);
		assert.ok(!serialized.includes('EAAG1234567890'));
		assert.ok(serialized.includes('[REDACTED'));
	});

	it('compareFacebookPublishEvents orders lifecycle transitions', () => {
		const created = { event_type: 'created', payload: { sequence: 10 }, created: '2026-01-01T00:00:00.000Z' };
		const claimed = { event_type: 'claimed', payload: { sequence: 20 }, created: '2026-01-01T00:00:01.000Z' };
		const published = { event_type: 'published', payload: { sequence: 30 }, created: '2026-01-01T00:00:02.000Z' };
		const ordered = [published, created, claimed].sort(compareFacebookPublishEvents);
		assert.deepEqual(ordered.map((evt) => evt.event_type), ['created', 'claimed', 'published']);
	});

	it('recordFacebookPublishEvent skips duplicate idempotency keys', async () => {
		const events = [];
		const deps = {
			loadEventIdempotencyKeys: async () => ['published:job_1:123_456'],
			createPublishEvent: async (record) => { events.push(record); },
		};

		const duplicate = await recordFacebookPublishEvent({
			job: baseJob,
			eventRecord: buildFacebookPublishPublishedEventPayload({
				job: baseJob,
				facebookPostId: '123_456',
				facebookPostUrl: 'https://www.facebook.com/123_456',
			}),
			deps,
		});
		assert.equal(duplicate.skipped, true);
		assert.equal(events.length, 0);

		const first = await recordFacebookPublishEvent({
			job: baseJob,
			eventRecord: buildFacebookPublishClaimedEventPayload({ job: baseJob, claimToken: 'claim_abc' }),
			deps: {
				...deps,
				loadEventIdempotencyKeys: async () => [],
			},
		});
		assert.equal(first.skipped, false);
		assert.equal(events.length, 1);
		assert.equal(events[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.CLAIMED);
	});

	it('hasExistingFacebookPublishEventKey detects persisted keys', () => {
		const keys = ['claimed:job_1:abc', 'published:job_1:123_456'];
		assert.equal(hasExistingFacebookPublishEventKey(keys, 'claimed:job_1:abc'), true);
		assert.equal(hasExistingFacebookPublishEventKey(keys, 'failed:job_1:attempt:1'), false);
		assert.equal(buildFacebookPublishEventIdempotencyKey({
			jobId: 'job_1',
			eventType: 'retry_scheduled',
			attempt: 2,
		}), 'retry_scheduled:job_1:attempt:2');
	});

	it('FACEBOOK_PUBLISH_USER_EVENT_TYPES covers all user-initiated lifecycle events', () => {
		assert.ok(FACEBOOK_PUBLISH_USER_EVENT_TYPES.includes(FACEBOOK_PUBLISH_EVENT_TYPES.CREATED));
		assert.ok(FACEBOOK_PUBLISH_USER_EVENT_TYPES.includes(FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED));
		assert.ok(FACEBOOK_PUBLISH_USER_EVENT_TYPES.includes(FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED));
		assert.ok(FACEBOOK_PUBLISH_USER_EVENT_TYPES.includes(FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL));
	});

	it('user event builders expose stable idempotency keys', () => {
		const job = { id: 'job_1', owner: 'user_1', workspace: 'ws_1', scheduled_at: '2026-12-01T12:00:00.000Z' };
		assert.equal(
			buildFacebookPublishScheduleUpdatedEventPayload({ job, updates: { scheduled_at: '2026-12-02T12:00:00.000Z' } }).payload.idempotencyKey,
			'schedule_updated:job_1:2026-12-02T12:00:00.000Z',
		);
		assert.equal(
			buildFacebookPublishCancelledEventPayload({ job }).payload.idempotencyKey,
			'cancelled:job_1',
		);
		assert.equal(
			buildFacebookPublishRetryManualEventPayload({ job }).payload.idempotencyKey,
			'retry_manual:job_1:attempt:0',
		);
	});

	it('recordFacebookPublishUserEvent delegates to idempotent recorder', async () => {
		const events = [];
		const deps = {
			loadEventIdempotencyKeys: async () => [],
			createPublishEvent: async (record) => { events.push(record); },
		};

		await recordFacebookPublishUserEvent({
			job: baseJob,
			eventRecord: buildFacebookPublishCancelledEventPayload({ job: baseJob }),
			deps,
		});

		assert.equal(events.length, 1);
		assert.equal(events[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED);
	});
});
