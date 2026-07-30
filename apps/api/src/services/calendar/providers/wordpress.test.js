import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectScheduledItems } from '../facade.js';
import { parseCalendarFacadeQuery } from '../query.js';
import { createPinterestCalendarProvider } from './pinterest.js';
import {
	createWordpressCalendarProvider,
	mapWordpressJobToScheduledItem,
	WORDPRESS_CALENDAR_CHANNEL,
	WORDPRESS_JOB_REF_TYPE,
} from './wordpress.js';
import { createWordpressMutationAdapter } from '../mutations/adapters/wordpress.js';
import { dispatchCalendarMutation } from '../mutations/router.js';
import { CALENDAR_CONSOLIDATION_PHASE } from '../calendar-architecture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('wordpress calendar channel (C6)', () => {
	it('locks phase C10 and WordPress provider channel id', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		const provider = createWordpressCalendarProvider({ fetchJobs: async () => [] });
		assert.equal(provider.channel, WORDPRESS_CALENDAR_CHANNEL);
		assert.equal(provider.kind, 'channel_jobs');
		assert.equal(WORDPRESS_JOB_REF_TYPE, 'publish_jobs');

		const providerRegistry = readFileSync(path.join(__dirname, 'registry.js'), 'utf8');
		assert.match(providerRegistry, /createWordpressCalendarProvider/);
		assert.match(providerRegistry, /fetchWordpressPublishJobsForCalendar/);

		const mutationRegistry = readFileSync(
			path.join(__dirname, '../mutations/registry.js'),
			'utf8',
		);
		assert.match(mutationRegistry, /createLiveWordpressMutationAdapter/);
	});

	it('maps publish_jobs into canonical Scheduled Items', () => {
		const item = mapWordpressJobToScheduledItem({
			id: 'wp1',
			status: 'scheduled',
			scheduled_at: '2026-07-18T12:00:00.000Z',
			timezone: 'UTC',
			title: 'WP post',
			website_id: 'site-1',
			featured_image_url: 'https://cdn/w.png',
			wp_post_url: 'https://blog.test/post',
			site: 'siteRec',
			expand: { site: { id: 'siteRec', name: 'Blog', domain: 'blog.test', websiteId: 'site-1' } },
		});

		assert.equal(item.channel, WORDPRESS_CALENDAR_CHANNEL);
		assert.equal(item.refType, WORDPRESS_JOB_REF_TYPE);
		assert.equal(item.id, 'wordpress:wp1');
		assert.equal(item.websiteId, 'site-1');
		assert.equal(item.previewUrl, 'https://cdn/w.png');
		assert.deepEqual(item.actions, ['reschedule', 'cancel']);
	});

	it('projects WordPress scheduled jobs alongside Pinterest via the facade', async () => {
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
		];

		const items = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07' }),
			providers,
		);
		assert.deepEqual(items.map((item) => item.id).sort(), ['pinterest:p1', 'wordpress:w1']);
	});

	it('dispatches WordPress reschedule/cancel/retry through the mutation router', async () => {
		const store = {
			job: {
				id: 'wp1',
				owner: 'user1',
				status: 'scheduled',
				scheduled_at: '2026-07-10T10:00:00.000Z',
				timezone: 'UTC',
				title: 'WP',
			},
		};
		const adapter = createWordpressMutationAdapter({
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
			{ eventId: 'wordpress:wp1', action: 'reschedule', payload: { scheduledAt: '2026-07-22T09:00:00.000Z' } },
			options,
		);
		assert.equal(rescheduled.channel, 'wordpress');
		assert.equal(store.job.scheduled_at, '2026-07-22T09:00:00.000Z');

		store.job.status = 'failed';
		const retried = await dispatchCalendarMutation(
			req,
			{ eventId: 'wordpress:wp1', action: 'retry', payload: {} },
			options,
		);
		assert.equal(retried.action, 'retry');
		assert.equal(store.job.status, 'scheduled');

		const cancelled = await dispatchCalendarMutation(
			req,
			{ eventId: 'wordpress:wp1', action: 'cancel', payload: {} },
			options,
		);
		assert.equal(cancelled.action, 'cancel');
		assert.equal(store.job.status, 'cancelled');
	});
});
