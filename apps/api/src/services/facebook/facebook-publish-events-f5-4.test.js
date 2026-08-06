import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistFacebookPublishJobWithCreatedEvent } from './publish-persist.js';
import {
	buildFacebookPublishCancelledEventPayload,
	buildFacebookPublishCreatedEventForJob,
	buildFacebookPublishRetryManualEventPayload,
	buildFacebookPublishScheduleUpdatedEventPayload,
	compareFacebookPublishEvents,
	FACEBOOK_PUBLISH_EVENT_SEQUENCE,
	FACEBOOK_PUBLISH_EVENT_TYPES,
	FACEBOOK_PUBLISH_USER_EVENT_TYPES,
	recordFacebookPublishCreatedEvent,
	recordFacebookPublishUserEvent,
} from './publish-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const basePrepared = {
	ok: true,
	jobPayload: {
		owner: 'user_1',
		workspace: 'ws_1',
		ai_pin: 'pin_1',
		account: 'acc_1',
		page_id: '123456789',
		scheduled_at: '2026-12-01T15:00:00.000Z',
		timezone: 'UTC',
		scheduled_timezone: 'UTC',
		status: 'scheduled',
	},
};

function createEventStoreDeps() {
	const jobs = [];
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
					create: async (payload) => {
						const row = { id: `job_${jobs.length + 1}`, ...payload };
						jobs.push(row);
						return { ...row };
					},
				};
			}
			if (name === 'facebook_publish_events') {
				return {
					getList: async () => ({ items: events }),
					create: async (payload) => {
						const row = { id: `evt_${events.length + 1}`, ...payload };
						events.push(row);
						return { ...row };
					},
				};
			}
			throw new Error(`unexpected collection ${name}`);
		},
	};

	return {
		jobs,
		events,
		deps: {
			pocketbaseClient,
			sanitizeCollectionPayload: async ({ payload }) => payload,
		},
	};
}

describe('facebook F5-4 publish-events hardening', () => {
	it('declares user-triggered event types for centralized recording', () => {
		assert.deepEqual(FACEBOOK_PUBLISH_USER_EVENT_TYPES, [
			FACEBOOK_PUBLISH_EVENT_TYPES.CREATED,
			FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED,
			FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED,
			FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL,
		]);
	});

	it('orders user and worker lifecycle events by sequence', () => {
		const created = { event_type: 'created', payload: { sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE.created } };
		const scheduleUpdated = { event_type: 'schedule_updated', payload: { sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE.schedule_updated } };
		const claimed = { event_type: 'claimed', payload: { sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE.claimed } };
		const cancelled = { event_type: 'cancelled', payload: { sequence: FACEBOOK_PUBLISH_EVENT_SEQUENCE.cancelled } };
		const ordered = [cancelled, claimed, scheduleUpdated, created].sort(compareFacebookPublishEvents);
		assert.deepEqual(
			ordered.map((evt) => evt.event_type),
			['created', 'schedule_updated', 'claimed', 'cancelled'],
		);
	});

	it('buildFacebookPublishCreatedEventForJob produces job-scoped created idempotency key', () => {
		const event = buildFacebookPublishCreatedEventForJob(basePrepared, 'job_abc', { publishMode: 'schedule' });
		assert.equal(event.job, 'job_abc');
		assert.equal(event.payload.idempotencyKey, 'created:job_abc');
		assert.equal(event.payload.publishMode, 'schedule');
	});

	it('recordFacebookPublishCreatedEvent uses idempotent user-event path', async () => {
		const { events, deps } = createEventStoreDeps();
		const job = { id: 'job_1', owner: 'user_1', workspace: 'ws_1' };

		const first = await recordFacebookPublishCreatedEvent({
			job,
			prepared: basePrepared,
			publishMode: 'now',
			deps: { ...deps, eventCreateContext: 'facebook:publish-created-event' },
		});

		assert.equal(first.skipped, false);
		assert.equal(events.length, 1);
		assert.equal(events[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.CREATED);
		assert.equal(events[0].payload.idempotencyKey, 'created:job_1');

		const duplicate = await recordFacebookPublishCreatedEvent({
			job,
			prepared: basePrepared,
			publishMode: 'now',
			deps,
		});
		assert.equal(duplicate.skipped, true);
		assert.equal(events.length, 1);
	});

	it('recordFacebookPublishUserEvent records schedule_updated, cancelled, and retry_manual', async () => {
		const { events, deps } = createEventStoreDeps();
		const job = {
			id: 'job_1',
			owner: 'user_1',
			workspace: 'ws_1',
			scheduled_at: '2026-12-01T15:00:00.000Z',
			timezone: 'UTC',
		};

		await recordFacebookPublishUserEvent({
			job,
			eventRecord: buildFacebookPublishScheduleUpdatedEventPayload({
				job,
				updates: { scheduled_at: '2026-12-02T15:00:00.000Z' },
			}),
			deps,
		});
		await recordFacebookPublishUserEvent({
			job,
			eventRecord: buildFacebookPublishCancelledEventPayload({ job }),
			deps,
		});
		await recordFacebookPublishUserEvent({
			job,
			eventRecord: buildFacebookPublishRetryManualEventPayload({ job }),
			deps,
		});

		assert.equal(events.length, 3);
		assert.deepEqual(
			events.map((row) => row.event_type),
			['schedule_updated', 'cancelled', 'retry_manual'],
		);
	});

	it('persistFacebookPublishJobWithCreatedEvent routes created events through shared recorder', async () => {
		const { jobs, events, deps } = createEventStoreDeps();

		const job = await persistFacebookPublishJobWithCreatedEvent({
			prepared: basePrepared,
			publishMode: 'schedule',
			deps: { ...deps, eventCreateContext: 'facebook:schedule-created-event' },
		});

		assert.equal(jobs.length, 1);
		assert.equal(events.length, 1);
		assert.equal(events[0].job, job.id);
		assert.equal(events[0].payload.idempotencyKey, `created:${job.id}`);
		assert.equal(events[0].payload.publishMode, 'schedule');
	});

	it('publish-persist no longer creates facebook_publish_events directly', () => {
		const source = readFileSync(path.join(__dirname, 'publish-persist.js'), 'utf8');
		assert.match(source, /recordFacebookPublishCreatedEvent/);
		assert.doesNotMatch(source, /facebook_publish_events'\)\.create/);
	});

	it('job-mutations emits user events through recordFacebookPublishUserEvent', () => {
		const source = readFileSync(path.join(__dirname, 'job-mutations.js'), 'utf8');
		assert.match(source, /recordFacebookPublishUserEvent/);
		assert.doesNotMatch(source, /recordFacebookPublishEvent\(/);
	});
});
