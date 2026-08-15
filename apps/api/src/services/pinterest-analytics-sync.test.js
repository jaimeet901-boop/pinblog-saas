import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { syncPinterestJobAnalytics } from './pinterest-analytics-sync.js';

const baseAccount = {
	id: 'acc_1',
	owner: 'user_1',
	workspace: 'ws_1',
	connected: true,
	status: 'connected',
};

const publishedJob = {
	id: 'job_1',
	owner: 'user_1',
	workspace: 'ws_1',
	account: 'acc_1',
	status: 'published',
	pinterest_pin_id: 'pin_ext_1',
	published_at: '2026-01-01T12:00:00.000Z',
	performance: {},
};

function createJobStore(initialJobs = []) {
	const jobs = new Map(initialJobs.map((job) => [job.id, { ...job }]));
	const client = {
		collection: (name) => {
			if (name === 'pinterest_publish_jobs') {
				return {
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
			throw new Error(`unexpected collection ${name}`);
		},
	};
	return { jobs, client };
}

function isolationDeps({
	account = baseAccount,
	jobs,
	client,
	tokenCalls,
	fetchCalls,
	sanitizeCalls,
} = {}) {
	return {
		pocketbaseClient: client,
		sanitizeCollectionPayload: async ({ payload }) => {
			if (sanitizeCalls) sanitizeCalls.value += 1;
			return payload;
		},
		getOwnedPinterestAccountById: async () => account,
		ensureValidPinterestAccessToken: async () => {
			tokenCalls.value += 1;
			return { accessToken: 'pinterest-token-plain' };
		},
		fetchPinterestPinAnalytics: async () => {
			fetchCalls.value += 1;
			return { summary_metrics: { IMPRESSION: 7, SAVE: 2 } };
		},
	};
}

describe('pinterest analytics workspace isolation (P2-5)', () => {
	it('syncs a WS-A job with a WS-A account', async () => {
		const { jobs, client } = createJobStore([{ ...publishedJob }]);
		const tokenCalls = { value: 0 };
		const fetchCalls = { value: 0 };
		const sanitizeCalls = { value: 0 };

		await syncPinterestJobAnalytics(publishedJob, isolationDeps({
			jobs,
			client,
			tokenCalls,
			fetchCalls,
			sanitizeCalls,
		}));

		assert.equal(tokenCalls.value, 1);
		assert.equal(fetchCalls.value, 1);
		assert.equal(sanitizeCalls.value, 1);
		assert.equal(jobs.get('job_1').performance.impressions, 7);
		assert.ok(jobs.get('job_1').analytics_synced_at);
	});

	it('skips a WS-A job with a WS-B account and does not call Pinterest or use tokens', async () => {
		const { jobs, client } = createJobStore([{ ...publishedJob }]);
		const tokenCalls = { value: 0 };
		const fetchCalls = { value: 0 };
		const sanitizeCalls = { value: 0 };

		await syncPinterestJobAnalytics(publishedJob, isolationDeps({
			account: { ...baseAccount, workspace: 'ws_b' },
			jobs,
			client,
			tokenCalls,
			fetchCalls,
			sanitizeCalls,
		}));

		assert.equal(tokenCalls.value, 0);
		assert.equal(fetchCalls.value, 0);
		assert.equal(sanitizeCalls.value, 0);
		assert.equal(jobs.get('job_1').analytics_synced_at, undefined);
		assert.deepEqual(jobs.get('job_1').performance, {});
	});

	it('skips a job with missing workspace', async () => {
		const job = { ...publishedJob, workspace: '' };
		const { jobs, client } = createJobStore([job]);
		const tokenCalls = { value: 0 };
		const fetchCalls = { value: 0 };
		const sanitizeCalls = { value: 0 };

		await syncPinterestJobAnalytics(job, isolationDeps({
			jobs,
			client,
			tokenCalls,
			fetchCalls,
			sanitizeCalls,
		}));

		assert.equal(tokenCalls.value, 0);
		assert.equal(fetchCalls.value, 0);
		assert.equal(sanitizeCalls.value, 0);
		assert.equal(jobs.get('job_1').analytics_synced_at, undefined);
	});

	it('skips a job when the account workspace is missing', async () => {
		const { jobs, client } = createJobStore([{ ...publishedJob }]);
		const tokenCalls = { value: 0 };
		const fetchCalls = { value: 0 };
		const sanitizeCalls = { value: 0 };

		await syncPinterestJobAnalytics(publishedJob, isolationDeps({
			account: { ...baseAccount, workspace: '   ' },
			jobs,
			client,
			tokenCalls,
			fetchCalls,
			sanitizeCalls,
		}));

		assert.equal(tokenCalls.value, 0);
		assert.equal(fetchCalls.value, 0);
		assert.equal(sanitizeCalls.value, 0);
		assert.equal(jobs.get('job_1').analytics_synced_at, undefined);
	});

	it('skips when the account owner does not match the job', async () => {
		const { jobs, client } = createJobStore([{ ...publishedJob }]);
		const tokenCalls = { value: 0 };
		const fetchCalls = { value: 0 };
		const sanitizeCalls = { value: 0 };

		await syncPinterestJobAnalytics(publishedJob, isolationDeps({
			account: { ...baseAccount, owner: 'other_user' },
			jobs,
			client,
			tokenCalls,
			fetchCalls,
			sanitizeCalls,
		}));

		assert.equal(tokenCalls.value, 0);
		assert.equal(fetchCalls.value, 0);
		assert.equal(sanitizeCalls.value, 0);
		assert.equal(jobs.get('job_1').analytics_synced_at, undefined);
	});

	it('skips when the account id does not match the job', async () => {
		const { jobs, client } = createJobStore([{ ...publishedJob }]);
		const tokenCalls = { value: 0 };
		const fetchCalls = { value: 0 };
		const sanitizeCalls = { value: 0 };

		await syncPinterestJobAnalytics(publishedJob, isolationDeps({
			account: { ...baseAccount, id: 'acc_other' },
			jobs,
			client,
			tokenCalls,
			fetchCalls,
			sanitizeCalls,
		}));

		assert.equal(tokenCalls.value, 0);
		assert.equal(fetchCalls.value, 0);
		assert.equal(sanitizeCalls.value, 0);
		assert.equal(jobs.get('job_1').analytics_synced_at, undefined);
	});
});
