import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	getPublishedFacebookJobsNeedingSync,
	isFacebookAnalyticsSyncEnabled,
	processFacebookAnalyticsSync,
	shouldSyncFacebookAnalyticsJob,
	syncFacebookJobAnalytics,
} from './facebook-analytics-sync.js';

const baseAccount = {
	id: 'acc_1',
	owner: 'user_1',
	connected: true,
	status: 'connected',
	page_tokens: { 123456789: 'cipher' },
};

const publishedJob = {
	id: 'job_1',
	owner: 'user_1',
	account: 'acc_1',
	page_id: '123456789',
	status: 'published',
	facebook_post_id: '123456789_987654321',
	published_at: '2026-01-01T12:00:00.000Z',
	performance: {},
};

function createJobStore(initialJobs = []) {
	const jobs = new Map(initialJobs.map((job) => [job.id, { ...job }]));
	const pins = new Map();

	const client = {
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
					getFullList: async () => [...jobs.values()],
					update: async (id, payload) => {
						const current = jobs.get(id);
						if (!current) throw new Error('not found');
						const next = {
							...current,
							...payload,
							updated: new Date().toISOString(),
						};
						jobs.set(id, next);
						return { ...next };
					},
				};
			}
			if (name === 'ai_pins') {
				return {
					getOne: async (id) => {
						const row = pins.get(id);
						if (!row) throw new Error('not found');
						return { ...row };
					},
					update: async (id, payload) => {
						const current = pins.get(id) || { id };
						const next = { ...current, ...payload };
						pins.set(id, next);
						return { ...next };
					},
				};
			}
			throw new Error(`unexpected collection ${name}`);
		},
	};

	return { jobs, pins, client };
}

describe('facebook-analytics-sync', () => {
	it('isFacebookAnalyticsSyncEnabled defaults to enabled', () => {
		const previous = process.env.FACEBOOK_ANALYTICS_ENABLED;
		delete process.env.FACEBOOK_ANALYTICS_ENABLED;
		assert.equal(isFacebookAnalyticsSyncEnabled(), true);
		if (previous == null) {
			delete process.env.FACEBOOK_ANALYTICS_ENABLED;
		} else {
			process.env.FACEBOOK_ANALYTICS_ENABLED = previous;
		}
	});

	it('shouldSyncFacebookAnalyticsJob selects stale published jobs with post ids', () => {
		const now = Date.parse('2026-08-06T12:00:00.000Z');
		const resyncAfterMs = 6 * 60 * 60 * 1000;
		const staleSyncedAt = new Date(now - (7 * 60 * 60 * 1000)).toISOString();
		const freshSyncedAt = new Date(now - (1 * 60 * 60 * 1000)).toISOString();

		assert.equal(shouldSyncFacebookAnalyticsJob(publishedJob, now, resyncAfterMs), true);
		assert.equal(
			shouldSyncFacebookAnalyticsJob(
				{ ...publishedJob, analytics_synced_at: '' },
				now,
				resyncAfterMs,
			),
			true,
		);
		assert.equal(
			shouldSyncFacebookAnalyticsJob(
				{ ...publishedJob, analytics_synced_at: staleSyncedAt },
				now,
				resyncAfterMs,
			),
			true,
		);
		assert.equal(
			shouldSyncFacebookAnalyticsJob(
				{ ...publishedJob, analytics_synced_at: freshSyncedAt },
				now,
				resyncAfterMs,
			),
			false,
		);
		assert.equal(
			shouldSyncFacebookAnalyticsJob(
				{ ...publishedJob, facebook_post_id: '' },
				now,
				resyncAfterMs,
			),
			false,
		);
		assert.equal(
			shouldSyncFacebookAnalyticsJob(
				{ ...publishedJob, performance: { readyForAnalyticsSync: false } },
				now,
				resyncAfterMs,
			),
			false,
		);
	});

	it('syncFacebookJobAnalytics updates performance and analytics_synced_at', async () => {
		const { jobs, client } = createJobStore([{ ...publishedJob }]);
		let markedExpired = false;

		await syncFacebookJobAnalytics(publishedJob, {
			client,
			pocketbaseClient: client,
			sanitizePayload: async (payload) => payload,
			getOwnedFacebookAccountById: async () => baseAccount,
			decryptPageTokenMap: () => ({ 123456789: 'page-token-plain' }),
			fetchFacebookPostInsights: async () => ({
				data: [
					{ name: 'post_impressions', values: [{ value: 900 }] },
					{ name: 'post_engaged_users', values: [{ value: 30 }] },
					{ name: 'post_clicks', values: [{ value: 7 }] },
					{ name: 'post_reactions_by_type_total', values: [{ value: { like: 4 } }] },
				],
			}),
			markFacebookAccountStatus: async () => {
				markedExpired = true;
			},
		});

		const updated = jobs.get('job_1');
		assert.equal(updated.analytics_synced_at, updated.performance.lastSyncedAt);
		assert.equal(updated.performance.impressions, 900);
		assert.equal(updated.performance.engagedUsers, 30);
		assert.equal(updated.performance.clicks, 7);
		assert.equal(updated.performance.reactions, 4);
		assert.equal(updated.performance.readyForAnalyticsSync, true);
		assert.equal(markedExpired, false);
	});

	it('syncFacebookJobAnalytics skips disconnected accounts and missing page tokens', async () => {
		const { jobs, client } = createJobStore([{ ...publishedJob }]);
		let fetchCalls = 0;

		await syncFacebookJobAnalytics(publishedJob, {
			client,
			pocketbaseClient: client,
			getOwnedFacebookAccountById: async () => ({ ...baseAccount, connected: false }),
			decryptPageTokenMap: () => ({}),
			fetchFacebookPostInsights: async () => {
				fetchCalls += 1;
				return { data: [] };
			},
		});

		assert.equal(fetchCalls, 0);
		assert.equal(jobs.get('job_1').analytics_synced_at, undefined);

		await syncFacebookJobAnalytics(publishedJob, {
			client,
			pocketbaseClient: client,
			sanitizePayload: async (payload) => payload,
			getOwnedFacebookAccountById: async () => baseAccount,
			decryptPageTokenMap: () => ({}),
			fetchFacebookPostInsights: async () => {
				fetchCalls += 1;
				return { data: [] };
			},
		});

		assert.equal(fetchCalls, 0);
	});

	it('processFacebookAnalyticsSync continues after per-job Graph failures', async () => {
		const { jobs, client } = createJobStore([
			{
				...publishedJob,
				id: 'job_fail',
				facebook_post_id: '123456789_111',
			},
			{
				...publishedJob,
				id: 'job_ok',
				facebook_post_id: '123456789_222',
			},
		]);
		const synced = [];

		await processFacebookAnalyticsSync({
			client,
			pocketbaseClient: client,
			sanitizePayload: async (payload) => payload,
			listPublishedJobs: async () => [
				jobs.get('job_fail'),
				jobs.get('job_ok'),
			],
			getOwnedFacebookAccountById: async () => baseAccount,
			decryptPageTokenMap: () => ({ 123456789: 'page-token-plain' }),
			fetchFacebookPostInsights: async ({ postId }) => {
				if (postId === '123456789_111') {
					const error = new Error('Rate limit');
					error.status = 429;
					error.retryable = true;
					error.errorCode = 'FACEBOOK_GRAPH_RATE_LIMITED';
					throw error;
				}
				synced.push(postId);
				return {
					data: [{ name: 'post_impressions', values: [{ value: 10 }] }],
				};
			},
		});

		assert.deepEqual(synced, ['123456789_222']);
		assert.equal(jobs.get('job_ok').performance.impressions, 10);
		assert.equal(jobs.get('job_fail').analytics_synced_at, undefined);
	});
});
