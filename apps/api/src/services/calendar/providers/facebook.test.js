import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectScheduledItems } from '../facade.js';
import { parseCalendarFacadeQuery } from '../query.js';
import { createPinterestCalendarProvider } from './pinterest.js';
import { createWordpressCalendarProvider } from './wordpress.js';
import {
	createFacebookCalendarProvider,
	mapFacebookJobToScheduledItem,
	FACEBOOK_CALENDAR_CHANNEL,
	FACEBOOK_JOB_REF_TYPE,
} from './facebook.js';
import { createFacebookMutationAdapter } from '../mutations/adapters/facebook.js';
import { dispatchCalendarMutation } from '../mutations/router.js';
import { CALENDAR_CONSOLIDATION_PHASE, CHANNEL_JOB_REF_TYPES } from '../calendar-architecture.js';
import { assertScheduledItemContract } from '../scheduled-item.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('facebook calendar channel (C9)', () => {
	it('locks phase C10 and registers Facebook in provider + mutation registries', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		assert.ok(CHANNEL_JOB_REF_TYPES.includes('facebook_publish_jobs'));
		assert.equal(FACEBOOK_JOB_REF_TYPE, 'facebook_publish_jobs');

		const provider = createFacebookCalendarProvider({ fetchJobs: async () => [] });
		assert.equal(provider.channel, FACEBOOK_CALENDAR_CHANNEL);
		assert.equal(provider.kind, 'channel_jobs');

		const providerRegistry = readFileSync(path.join(__dirname, 'registry.js'), 'utf8');
		assert.match(providerRegistry, /createFacebookCalendarProvider/);
		assert.match(providerRegistry, /fetchFacebookPublishJobsForCalendar/);

		const mutationRegistry = readFileSync(
			path.join(__dirname, '../mutations/registry.js'),
			'utf8',
		);
		assert.match(mutationRegistry, /createLiveFacebookMutationAdapter/);
	});

	it('maps facebook_publish_jobs into canonical Scheduled Items', () => {
		const item = mapFacebookJobToScheduledItem({
			id: 'fb1',
			status: 'scheduled',
			scheduled_at: '2026-07-25T15:00:00.000Z',
			timezone: 'UTC',
			title: 'FB post',
			websiteId: 'site-1',
			image_url: 'https://cdn/fb.png',
			facebook_post_url: 'https://facebook.com/posts/1',
			page_id: 'page-1',
			page_label: 'Brand Page',
			attempt_count: 0,
		});

		assert.equal(item.channel, FACEBOOK_CALENDAR_CHANNEL);
		assert.equal(item.refType, FACEBOOK_JOB_REF_TYPE);
		assert.equal(item.id, 'facebook:fb1');
		assert.equal(item.websiteId, 'site-1');
		assert.equal(item.previewUrl, 'https://cdn/fb.png');
		assert.deepEqual(item.actions, ['reschedule', 'cancel']);
		assert.equal(item.deepLinks.queue.sourceOfTruth, false);
		assert.equal(item.deepLinks.pageId, 'page-1');
		assertScheduledItemContract(item);
	});

	it('projects Facebook scheduled jobs alongside Pinterest and WordPress via the facade', async () => {
		const providers = [
			createPinterestCalendarProvider({
				fetchJobs: async () => [{
					id: 'p1',
					status: 'scheduled',
					scheduled_at: '2026-07-10T10:00:00.000Z',
					title: 'Pin',
					websiteId: 'site-1',
				}],
			}),
			createWordpressCalendarProvider({
				fetchJobs: async () => [{
					id: 'w1',
					status: 'scheduled',
					scheduled_at: '2026-07-11T10:00:00.000Z',
					title: 'Article',
					website_id: 'site-1',
				}],
			}),
			createFacebookCalendarProvider({
				fetchJobs: async () => [{
					id: 'f1',
					status: 'scheduled',
					scheduled_at: '2026-07-12T10:00:00.000Z',
					title: 'FB',
					websiteId: 'site-1',
				}],
			}),
		];

		const items = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07' }),
			providers,
		);
		assert.deepEqual(
			items.map((item) => item.id).sort(),
			['facebook:f1', 'pinterest:p1', 'wordpress:w1'],
		);
	});

	it('dispatches Facebook reschedule/cancel/retry through the mutation router only', async () => {
		const store = {
			job: {
				id: 'fb1',
				owner: 'user1',
				status: 'scheduled',
				scheduled_at: '2026-07-10T10:00:00.000Z',
				timezone: 'UTC',
				title: 'FB',
				websiteId: 'site-1',
			},
		};
		const adapter = createFacebookMutationAdapter({
			getOwner: (req) => req.pocketbaseUserId,
			getJob: async (id) => (store.job.id === id ? { ...store.job } : null),
			updateJob: async (id, payload) => {
				store.job = { ...store.job, ...payload, id };
				return { ...store.job };
			},
			sanitize: async ({ payload }) => payload,
			resolveScheduledAtUtc: ({ scheduledAt }) => new Date(scheduledAt).toISOString(),
		});

		const req = { pocketbaseUserId: 'user1' };
		const options = { adapters: [adapter], assertCapability: () => {} };

		const rescheduled = await dispatchCalendarMutation(
			req,
			{ eventId: 'facebook:fb1', action: 'reschedule', payload: { scheduledAt: '2026-07-28T09:00:00.000Z' } },
			options,
		);
		assert.equal(rescheduled.channel, 'facebook');
		assert.equal(store.job.scheduled_at, '2026-07-28T09:00:00.000Z');
		assert.equal(rescheduled.item.channel, 'facebook');

		store.job.status = 'failed';
		const retried = await dispatchCalendarMutation(
			req,
			{ eventId: 'facebook:fb1', action: 'retry', payload: {} },
			options,
		);
		assert.equal(retried.action, 'retry');
		assert.equal(store.job.status, 'scheduled');

		const cancelled = await dispatchCalendarMutation(
			req,
			{ eventId: 'facebook:fb1', action: 'cancel', payload: {} },
			options,
		);
		assert.equal(cancelled.action, 'cancel');
		assert.equal(store.job.status, 'cancelled');
	});

	it('keeps Facebook writes out of the mutation router core', () => {
		const routerSource = readFileSync(
			path.join(__dirname, '../mutations/router.js'),
			'utf8',
		);
		assert.doesNotMatch(routerSource, /facebook_publish_jobs/);
		assert.doesNotMatch(routerSource, /createFacebookMutationAdapter/);
		assert.doesNotMatch(routerSource, /mapFacebookJobToScheduledItem/);
	});
});
