import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPinterestMutationAdapter } from './adapters/pinterest.js';
import {
	assertCalendarMutationAction,
	buildCalendarEventId,
	parseCalendarEventId,
} from './ids.js';
import {
	cancelCalendarScheduledItem,
	createMutationRouter,
	dispatchCalendarMutation,
	rescheduleCalendarScheduledItem,
	retryCalendarScheduledItem,
} from './router.js';
import { CALENDAR_CONSOLIDATION_PHASE } from '../calendar-architecture.js';

function stubPinterestDeps(job, { connected = true } = {}) {
	const store = { job: { ...job } };
	return {
		deps: {
			getOwner: (req) => req.pocketbaseUserId,
			getJob: async (id) => (store.job?.id === id ? { ...store.job } : null),
			updateJob: async (id, payload) => {
				assert.equal(id, store.job.id);
				store.job = { ...store.job, ...payload };
				return { ...store.job };
			},
			updatePin: async () => null,
			createEvent: async () => null,
			sanitize: async ({ payload }) => payload,
			resolveScheduledAtUtc: ({ scheduledAt }) => new Date(scheduledAt).toISOString(),
			assertPinterestConnected: async () => {
				if (!connected) {
					const error = new Error('Pinterest account is not connected');
					error.status = 422;
					throw error;
				}
				return { id: 'acc1', connected: true, status: 'connected' };
			},
		},
		store,
	};
}

describe('calendar mutation router (C5)', () => {
	it('locks phase C10 and parses channel:refId event ids', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		assert.deepEqual(parseCalendarEventId('pinterest:job42'), {
			channel: 'pinterest',
			refId: 'job42',
			eventId: 'pinterest:job42',
		});
		assert.equal(buildCalendarEventId('pinterest', 'job42'), 'pinterest:job42');
		assert.equal(assertCalendarMutationAction('Reschedule'), 'reschedule');
		assert.throws(() => parseCalendarEventId('job42'), (error) => error.errorCode === 'VALIDATION_ERROR');
		assert.throws(() => assertCalendarMutationAction('delete'), (error) => error.errorCode === 'VALIDATION_ERROR');
	});

	it('dispatches reschedule/cancel/retry to the Pinterest adapter', async () => {
		const { deps, store } = stubPinterestDeps({
			id: 'job1',
			owner: 'user1',
			workspace: 'ws1',
			status: 'scheduled',
			scheduled_at: '2026-07-10T10:00:00.000Z',
			timezone: 'UTC',
			ai_pin: 'pin1',
			title: 'Pin',
		});
		const adapters = [createPinterestMutationAdapter(deps)];
		const req = { pocketbaseUserId: 'user1', workspace: { id: 'ws1' } };

		const rescheduled = await rescheduleCalendarScheduledItem(
			req,
			'pinterest:job1',
			{ scheduledAt: '2026-07-20T12:00:00.000Z', timezone: 'UTC' },
			{ adapters, assertCapability: () => {} },
		);
		assert.equal(rescheduled.ok, true);
		assert.equal(rescheduled.action, 'reschedule');
		assert.equal(rescheduled.channel, 'pinterest');
		assert.equal(rescheduled.eventId, 'pinterest:job1');
		assert.equal(store.job.scheduled_at, '2026-07-20T12:00:00.000Z');
		assert.equal(rescheduled.meta.source, 'unified_calendar_mutation_router');

		store.job.status = 'failed';
		const retried = await retryCalendarScheduledItem(
			req,
			'pinterest:job1',
			{},
			{ adapters, assertCapability: () => {} },
		);
		assert.equal(retried.action, 'retry');
		assert.equal(store.job.status, 'scheduled');

		const cancelled = await cancelCalendarScheduledItem(
			req,
			'pinterest:job1',
			{},
			{ adapters, assertCapability: () => {} },
		);
		assert.equal(cancelled.action, 'cancel');
		assert.equal(store.job.status, 'cancelled');
	});

	it('rejects unsupported channels without executing writes', async () => {
		const { deps, store } = stubPinterestDeps({
			id: 'job1',
			owner: 'user1',
			status: 'scheduled',
			scheduled_at: '2026-07-10T10:00:00.000Z',
		});
		const before = { ...store.job };
		await assert.rejects(
			() => dispatchCalendarMutation(
				{ pocketbaseUserId: 'user1' },
				{ eventId: 'wordpress:job1', action: 'reschedule', payload: { scheduledAt: '2026-07-21T00:00:00.000Z' } },
				{ adapters: [createPinterestMutationAdapter(deps)], assertCapability: () => {} },
			),
			(error) => error.errorCode === 'CHANNEL_NOT_SUPPORTED',
		);
		assert.deepEqual(store.job, before);
	});

	it('stays extensible: future channel adapters plug in without router changes', async () => {
		const wordpressStub = {
			channel: 'wordpress',
			supports: (action) => action === 'reschedule',
			async reschedule(_req, refId, payload) {
				return {
					refId,
					item: {
						id: `wordpress:${refId}`,
						channel: 'wordpress',
						refId,
						status: 'scheduled',
						scheduledAt: payload.scheduledAt,
						title: 'WP',
					},
				};
			},
		};

		const router = createMutationRouter([wordpressStub]);
		const result = await router.dispatch(
			{},
			{ eventId: 'wordpress:w1', action: 'reschedule', payload: { scheduledAt: '2026-08-01T00:00:00.000Z' } },
		);
		assert.equal(result.channel, 'wordpress');
		assert.equal(result.eventId, 'wordpress:w1');
	});

	it('does not put channel write logic in the router core', async () => {
		const routerSource = await import('node:fs').then((fs) => (
			fs.readFileSync(new URL('./router.js', import.meta.url), 'utf8')
		));
		assert.equal(routerSource.includes('pinterest_publish_jobs'), false);
		assert.equal(routerSource.includes('pocketbaseClient'), false);
	});
});
