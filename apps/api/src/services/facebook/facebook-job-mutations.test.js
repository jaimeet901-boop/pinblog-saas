import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	assertOwnedFacebookPublishJob,
	cancelFacebookPublishJob,
	publishNowFacebookPublishJob,
	rescheduleFacebookPublishJob,
	retryFacebookPublishJob,
} from './job-mutations.js';
import {
	buildFacebookPublishCancelledEventPayload,
	buildFacebookPublishRetryManualEventPayload,
	buildFacebookPublishScheduleUpdatedEventPayload,
	FACEBOOK_PUBLISH_EVENT_TYPES,
} from './publish-events.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

function futureIso(msAhead = 120_000) {
	return new Date(Date.now() + msAhead).toISOString();
}

function createMutationStore(initialJob) {
	const jobs = new Map([[initialJob.id, { ...initialJob }]]);
	const events = [];

	const pocketbaseClient = {
		filter: (template, params = {}) => {
			let result = String(template);
			for (const [key, value] of Object.entries(params)) {
				result = result.replace(new RegExp(`\\{:${key}\\}`, 'g'), String(value));
			}
			return result;
		},
		collection: (name) => {
			if (name === 'facebook_publish_jobs') {
				return {
					getOne: async (id) => {
						const row = jobs.get(id);
						if (!row) throw new Error('not found');
						return { ...row };
					},
					update: async (id, payload) => {
						const current = jobs.get(id);
						if (!current) throw new Error('not found');
						const next = { ...current, ...payload };
						jobs.set(id, next);
						return { ...next };
					},
				};
			}
			if (name === 'facebook_publish_events') {
				return {
					getList: async () => ({ items: events }),
					create: async (payload) => {
						const row = { id: `evt_${events.length + 1}`, ...payload };
						events.push(row);
						return row;
					},
				};
			}
			if (name === 'facebook_pages') {
				return {
					getFirstListItem: async () => ({
						id: 'page_rec_1',
						name: 'Chef IA Page',
						page_id: '123456789',
					}),
				};
			}
			throw new Error(`unexpected collection ${name}`);
		},
	};

	const req = {
		workspaceOwnerId: 'user_1',
		pocketbaseUserId: 'user_1',
		workspaceId: 'ws_1',
	};

	const deps = {
		pocketbaseClient,
		sanitizeCollectionPayload: async ({ payload }) => payload,
		recordBelongsToWorkspace: () => true,
		andWorkspaceScope: (_req, filter) => filter,
		getOwnedFacebookAccountById: async () => ({
			id: 'acc_1',
			label: 'My Business',
			connected: true,
		}),
		validateFacebookDestinationPost: async () => ({
			ok: true,
			errors: [],
			normalized: { pageId: '123456789', accountId: 'acc_1' },
		}),
	};

	return { jobs, events, req, deps, getJob: (id) => jobs.get(id) };
}

const scheduledJob = {
	id: 'job_1',
	owner: 'user_1',
	workspace: 'ws_1',
	status: 'scheduled',
	scheduled_at: futureIso(3600_000),
	timezone: 'UTC',
	scheduled_timezone: 'UTC',
	account: 'acc_1',
	page_id: '123456789',
	message: 'Hello',
	image_url: 'https://cdn.example.com/post.jpg',
	destination_url: 'https://example.com/recipe',
};

describe('facebook F5-2 job mutations', () => {
	it('assertOwnedFacebookPublishJob rejects foreign owner', async () => {
		const { req, deps } = createMutationStore(scheduledJob);
		await assert.rejects(
			() => assertOwnedFacebookPublishJob({
				req: { ...req, workspaceOwnerId: 'other_user' },
				jobId: 'job_1',
				deps,
			}),
			(err) => err.status === 403,
		);
	});

	it('assertOwnedFacebookPublishJob rejects workspace mismatch', async () => {
		const { req, deps } = createMutationStore(scheduledJob);
		await assert.rejects(
			() => assertOwnedFacebookPublishJob({
				req,
				jobId: 'job_1',
				deps: {
					...deps,
					recordBelongsToWorkspace: () => false,
				},
			}),
			(err) => err.status === 403,
		);
	});

	it('rescheduleFacebookPublishJob updates future scheduled_at and emits schedule_updated', async () => {
		const { events, req, deps, getJob } = createMutationStore(scheduledJob);
		const nextAt = futureIso(7200_000);

		const result = await rescheduleFacebookPublishJob({
			req,
			jobId: 'job_1',
			body: { scheduledAt: nextAt, timezone: 'UTC' },
			deps,
		});

		assert.equal(result.job.status, 'scheduled');
		assert.equal(getJob('job_1').scheduled_at, nextAt);
		assert.equal(events.length, 1);
		assert.equal(events[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED);
		assert.equal(events[0].payload.idempotencyKey, `schedule_updated:job_1:${nextAt}`);
	});

	it('rescheduleFacebookPublishJob rejects non-scheduled jobs', async () => {
		const { req, deps } = createMutationStore({ ...scheduledJob, status: 'published' });
		await assert.rejects(
			() => rescheduleFacebookPublishJob({ req, jobId: 'job_1', body: { scheduledAt: futureIso(120_000) }, deps }),
			(err) => err.status === 422 && err.errorCode === 'INVALID_STATUS',
		);
	});

	it('rescheduleFacebookPublishJob rejects schedules inside 30-second lead window', async () => {
		const { req, deps } = createMutationStore(scheduledJob);
		await assert.rejects(
			() => rescheduleFacebookPublishJob({
				req,
				jobId: 'job_1',
				body: { scheduledAt: new Date(Date.now() + 5000).toISOString(), timezone: 'UTC' },
				deps,
			}),
			/at least 30 seconds/,
		);
	});

	it('cancelFacebookPublishJob cancels scheduled jobs and emits cancelled', async () => {
		const { events, req, deps, getJob } = createMutationStore(scheduledJob);
		const result = await cancelFacebookPublishJob({ req, jobId: 'job_1', deps });

		assert.equal(result.job.status, 'cancelled');
		assert.equal(getJob('job_1').status, 'cancelled');
		assert.equal(events[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED);
		assert.equal(events[0].payload.idempotencyKey, 'cancelled:job_1');
	});

	it('cancelFacebookPublishJob allows failed jobs', async () => {
		const { req, deps, getJob } = createMutationStore({ ...scheduledJob, status: 'failed' });
		const result = await cancelFacebookPublishJob({ req, jobId: 'job_1', deps });
		assert.equal(result.job.status, 'cancelled');
		assert.equal(getJob('job_1').last_error, 'Cancelled by user');
	});

	it('cancelFacebookPublishJob rejects published jobs', async () => {
		const { req, deps } = createMutationStore({ ...scheduledJob, status: 'published' });
		await assert.rejects(
			() => cancelFacebookPublishJob({ req, jobId: 'job_1', deps }),
			(err) => err.status === 422,
		);
	});

	it('retryFacebookPublishJob resets failed jobs to scheduled', async () => {
		const { events, req, deps, getJob } = createMutationStore({
			...scheduledJob,
			status: 'failed',
			last_error: 'Graph failed',
			attempt_count: 2,
		});

		const result = await retryFacebookPublishJob({ req, jobId: 'job_1', deps });
		assert.equal(result.job.status, 'scheduled');
		assert.equal(getJob('job_1').attempt_count, 0);
		assert.equal(getJob('job_1').last_error, '');
		assert.equal(events[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL);
	});

	it('retryFacebookPublishJob allows cancelled jobs', async () => {
		const { req, deps, getJob } = createMutationStore({ ...scheduledJob, status: 'cancelled' });
		const result = await retryFacebookPublishJob({ req, jobId: 'job_1', deps });
		assert.equal(result.job.status, 'scheduled');
		assert.equal(getJob('job_1').status, 'scheduled');
	});

	it('retryFacebookPublishJob rejects scheduled jobs', async () => {
		const { req, deps } = createMutationStore(scheduledJob);
		await assert.rejects(
			() => retryFacebookPublishJob({ req, jobId: 'job_1', deps }),
			(err) => err.status === 422,
		);
	});

	it('publishNowFacebookPublishJob bumps scheduled_at to now for scheduled jobs', async () => {
		const { events, req, deps, getJob } = createMutationStore(scheduledJob);
		const before = Date.now();
		const result = await publishNowFacebookPublishJob({ req, jobId: 'job_1', deps });
		const after = Date.now();

		assert.equal(result.job.status, 'scheduled');
		const at = new Date(getJob('job_1').scheduled_at).getTime();
		assert.ok(at >= before && at <= after + 1000);
		assert.equal(events[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED);
		assert.equal(events[0].payload.publishNow, true);
	});

	it('publishNowFacebookPublishJob allows failed jobs', async () => {
		const { req, deps, getJob } = createMutationStore({ ...scheduledJob, status: 'failed' });
		const result = await publishNowFacebookPublishJob({ req, jobId: 'job_1', deps });
		assert.equal(result.job.status, 'scheduled');
		assert.ok(getJob('job_1').scheduled_at);
	});

	it('user event builders include idempotency keys', () => {
		const scheduleEvent = buildFacebookPublishScheduleUpdatedEventPayload({
			job: scheduledJob,
			updates: { scheduled_at: '2026-12-01T12:00:00.000Z' },
		});
		assert.equal(scheduleEvent.payload.idempotencyKey, 'schedule_updated:job_1:2026-12-01T12:00:00.000Z');

		const cancelEvent = buildFacebookPublishCancelledEventPayload({ job: scheduledJob });
		assert.equal(cancelEvent.payload.idempotencyKey, 'cancelled:job_1');

		const retryEvent = buildFacebookPublishRetryManualEventPayload({ job: scheduledJob });
		assert.equal(retryEvent.payload.idempotencyKey, 'retry_manual:job_1:attempt:0');
	});

	it('registers mutation routes wired to job-mutations service', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		assert.match(route, /router\.patch\('\/jobs\/:jobId'/);
		assert.match(route, /router\.post\('\/jobs\/:jobId\/cancel'/);
		assert.match(route, /router\.post\('\/jobs\/:jobId\/retry'/);
		assert.match(route, /router\.post\('\/jobs\/:jobId\/publish-now'/);
		assert.match(route, /rescheduleFacebookPublishJob/);
		assert.match(route, /cancelFacebookPublishJob/);
		assert.match(route, /retryFacebookPublishJob/);
		assert.match(route, /publishNowFacebookPublishJob/);
		assert.doesNotMatch(route, /graph-publish|consumeFeatureCredits|facebook-publish-queue/);
	});
});
