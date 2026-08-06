import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildFacebookCalendarMutationDepsFromLegacy,
	createFacebookMutationAdapter,
	mapFacebookPublishJobDtoToCalendarRecord,
} from './facebook.js';
import { FACEBOOK_PUBLISH_EVENT_TYPES } from '../../../facebook/publish-events.js';
import { dispatchCalendarMutation } from '../router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function futureIso(msAhead = 120_000) {
	return new Date(Date.now() + msAhead).toISOString();
}

function createAdapterStore(initialJob) {
	const store = {
		job: { ...initialJob },
		events: [],
	};

	const legacyDeps = {
		getOwner: (req) => req.pocketbaseUserId,
		getJob: async (id) => (store.job.id === id ? { ...store.job } : null),
		updateJob: async (id, payload) => {
			store.job = { ...store.job, ...payload, id };
			return { ...store.job };
		},
		sanitize: async ({ payload }) => payload,
		recordBelongsToWorkspace: () => true,
		andWorkspaceScope: (_req, filter) => filter,
		getOwnedFacebookAccountById: async () => ({
			id: 'acc_1',
			label: 'My Business',
			connected: true,
		}),
	};

	const mutationDeps = buildFacebookCalendarMutationDepsFromLegacy(legacyDeps);
	mutationDeps._trackEvents = (event) => {
		store.events.push(event);
	};

	const adapter = createFacebookMutationAdapter({ mutationDeps });

	return { store, adapter, mutationDeps, req: { pocketbaseUserId: initialJob.owner, workspaceId: 'ws_1' } };
}

function getRecordedEvents(store, mutationDeps) {
	return mutationDeps._events || store.events || [];
}

const baseJob = {
	id: 'fb1',
	owner: 'user1',
	workspace: 'ws_1',
	status: 'scheduled',
	scheduled_at: futureIso(3_600_000),
	timezone: 'UTC',
	scheduled_timezone: 'UTC',
	title: 'FB',
	websiteId: 'site-1',
	account: 'acc_1',
	page_id: '123456789',
	message: 'Hello',
	image_url: 'https://cdn.example.com/post.jpg',
};

describe('facebook calendar mutation adapter (F5-3)', () => {
	it('delegates reschedule/cancel/retry to shared job-mutations service', async () => {
		const adapterSource = readFileSync(path.join(__dirname, 'facebook.js'), 'utf8');
		assert.match(adapterSource, /job-mutations\.js/);
		assert.match(adapterSource, /rescheduleFacebookPublishJob/);
		assert.match(adapterSource, /cancelFacebookPublishJob/);
		assert.match(adapterSource, /retryFacebookPublishJob/);
		assert.match(adapterSource, /publishNowFacebookPublishJob/);
		assert.doesNotMatch(adapterSource, /completed_at|dead_letter|progress:\s*0|'queued'/);
	});

	it('reschedule updates scheduled_at and emits schedule_updated without duplicate adapter logic', async () => {
		const { store, adapter, mutationDeps, req } = createAdapterStore(baseJob);
		const nextAt = futureIso(7_200_000);

		const result = await adapter.reschedule(req, 'fb1', { scheduledAt: nextAt, timezone: 'UTC' });

		assert.equal(result.channel, 'facebook');
		assert.equal(store.job.scheduled_at, nextAt);
		assert.equal(result.item.channel, 'facebook');
		assert.equal(result.item.status, 'scheduled');
		assert.equal(getRecordedEvents(store, mutationDeps).length, 1);
		assert.equal(getRecordedEvents(store, mutationDeps)[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.SCHEDULE_UPDATED);
	});

	it('cancel clears retry fields and never writes completed_at', async () => {
		const { store, adapter, mutationDeps, req } = createAdapterStore({ ...baseJob, status: 'failed', last_error: 'Graph failed' });

		await adapter.cancel(req, 'fb1');

		assert.equal(store.job.status, 'cancelled');
		assert.equal(store.job.last_error, 'Cancelled by user');
		assert.equal(store.job.next_retry_at, '');
		assert.ok(!('completed_at' in store.job));
		assert.equal(getRecordedEvents(store, mutationDeps)[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.CANCELLED);
	});

	it('retry always uses status scheduled even when scheduled_at is missing', async () => {
		const { store, adapter, mutationDeps, req } = createAdapterStore({
			...baseJob,
			status: 'failed',
			scheduled_at: '',
			attempt_count: 2,
			last_error: 'failed',
		});

		await adapter.retry(req, 'fb1');

		assert.equal(store.job.status, 'scheduled');
		assert.ok(store.job.scheduled_at);
		assert.equal(store.job.attempt_count, 0);
		assert.equal(store.job.last_error, '');
		assert.ok(!('progress' in store.job));
		assert.ok(!('dead_letter' in store.job));
		assert.equal(getRecordedEvents(store, mutationDeps)[0].event_type, FACEBOOK_PUBLISH_EVENT_TYPES.RETRY_MANUAL);
	});

	it('retry allows cancelled jobs and preserves existing scheduled_at when present', async () => {
		const preservedAt = futureIso(9_000_000);
		const { store, adapter, req } = createAdapterStore({
			...baseJob,
			status: 'cancelled',
			scheduled_at: preservedAt,
		});

		await adapter.retry(req, 'fb1');

		assert.equal(store.job.status, 'scheduled');
		assert.equal(store.job.scheduled_at, preservedAt);
	});

	it('publishNow delegates to shared service and emits schedule_updated with publishNow flag', async () => {
		const { store, adapter, mutationDeps, req } = createAdapterStore(baseJob);
		const before = Date.now();

		await adapter.publishNow(req, 'fb1');

		const at = new Date(store.job.scheduled_at).getTime();
		assert.ok(at >= before && at <= Date.now() + 1000);
		assert.equal(store.job.status, 'scheduled');
		assert.equal(getRecordedEvents(store, mutationDeps)[0].payload.publishNow, true);
	});

	it('rejects reschedule without scheduledAt at the adapter boundary', async () => {
		const { adapter, req } = createAdapterStore(baseJob);
		await assert.rejects(
			() => adapter.reschedule(req, 'fb1', { timezone: 'UTC' }),
			(err) => err.status === 422,
		);
	});

	it('rejects cancel for published jobs via shared service state gate', async () => {
		const { adapter, req } = createAdapterStore({ ...baseJob, status: 'published' });
		await assert.rejects(
			() => adapter.cancel(req, 'fb1'),
			(err) => err.status === 422 && err.errorCode === 'INVALID_STATUS',
		);
	});

	it('maps publish job DTO fields for calendar scheduled item projection', () => {
		const record = mapFacebookPublishJobDtoToCalendarRecord({
			id: 'fb1',
			status: 'scheduled',
			scheduledAt: '2026-12-01T12:00:00.000Z',
			timezone: 'UTC',
			title: 'Post',
			message: 'Hello',
			imageUrl: 'https://cdn.example.com/post.jpg',
			pageId: 'page-1',
			pageName: 'Brand Page',
			accountId: 'acc-1',
		});

		assert.equal(record.scheduled_at, '2026-12-01T12:00:00.000Z');
		assert.equal(record.image_url, 'https://cdn.example.com/post.jpg');
		assert.equal(record.page_id, 'page-1');
	});

	it('dispatches through mutation router without router core changes', async () => {
		const { store, adapter, req } = createAdapterStore(baseJob);
		const options = { adapters: [adapter], assertCapability: () => {} };
		const nextAt = futureIso(10_800_000);

		const rescheduled = await dispatchCalendarMutation(
			req,
			{ eventId: 'facebook:fb1', action: 'reschedule', payload: { scheduledAt: nextAt } },
			options,
		);
		assert.equal(rescheduled.action, 'reschedule');
		assert.equal(store.job.scheduled_at, nextAt);

		store.job.status = 'failed';
		await dispatchCalendarMutation(req, { eventId: 'facebook:fb1', action: 'retry', payload: {} }, options);
		assert.equal(store.job.status, 'scheduled');

		await dispatchCalendarMutation(req, { eventId: 'facebook:fb1', action: 'cancel', payload: {} }, options);
		assert.equal(store.job.status, 'cancelled');
		assert.ok(!('completed_at' in store.job));
	});

	it('live adapter wires pocketbase and workspace ownership only', () => {
		const liveSource = readFileSync(path.join(__dirname, 'facebook-live.js'), 'utf8');
		assert.match(liveSource, /mutationDeps/);
		assert.match(liveSource, /recordBelongsToWorkspace/);
		assert.match(liveSource, /andWorkspaceScope/);
		assert.doesNotMatch(liveSource, /resolveScheduledAtUtc|updateJob:/);
	});
});
