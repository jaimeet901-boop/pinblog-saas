import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	claimScheduledJob,
	isFacebookQueueEnabled,
	processDueJobs,
	processJob,
	recoverStuckPublishingJobs,
} from './facebook-publish-queue.js';

const baseAccount = {
	id: 'acc_1',
	owner: 'user_1',
	workspace: 'ws_1',
	connected: true,
	status: 'connected',
	page_tokens: { 123456789: 'cipher' },
};

const basePage = {
	id: 'page_row_1',
	owner: 'user_1',
	workspace: 'ws_1',
	account: 'acc_1',
	page_id: '123456789',
};

const baseJob = {
	id: 'job_1',
	owner: 'user_1',
	workspace: 'ws_1',
	account: 'acc_1',
	page_id: '123456789',
	message: 'Hello Facebook',
	image_url: 'https://cdn.example.com/post.jpg',
	destination_url: 'https://example.com/recipe',
	status: 'publishing',
	attempt_count: 0,
	max_attempts: 3,
	claim_token: 'abc',
	claim_version: 1,
};

function createJobStore(initialJobs = []) {
	const jobs = new Map(initialJobs.map((job) => [job.id, { ...job }]));
	const events = [];

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
					getOne: async (id) => {
						const row = jobs.get(id);
						if (!row) throw new Error('not found');
						return { ...row };
					},
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
			if (name === 'facebook_publish_events') {
				return {
					create: async (payload) => {
						events.push({ ...payload });
						return { id: `evt_${events.length}`, ...payload };
					},
				};
			}
			throw new Error(`unexpected collection ${name}`);
		},
	};

	return {
		jobs,
		events,
		client,
		getJob: (id) => jobs.get(id),
	};
}

function createEventDeps(store) {
	return {
		loadEventIdempotencyKeys: async (jobId) => store.events
			.filter((evt) => evt.job === jobId)
			.map((evt) => evt.payload?.idempotencyKey)
			.filter(Boolean),
		createPublishEvent: async (record) => {
			store.events.push({
				...record,
				created: new Date().toISOString(),
			});
		},
	};
}

function baseDeps(overrides = {}) {
	const store = overrides.store || createJobStore([baseJob]);
	const validationOk = {
		ok: true,
		errors: [],
		warnings: [],
		normalized: { pageId: '123456789', accountId: 'acc_1' },
	};

	return {
		store,
		deps: {
			pocketbaseClient: store.client,
			client: store.client,
			sanitizePayload: async (payload) => payload,
			getOwnedFacebookAccountById: async ({ accountId }) => (
				accountId === baseAccount.id ? { ...baseAccount } : null
			),
			getFacebookPageForQueueJob: async () => ({ ...basePage }),
			decryptPageTokenMap: () => ({ 123456789: 'page-token-plain' }),
			validateFacebookDestinationPost: async () => validationOk,
			markFacebookAccountStatus: async () => null,
			...createEventDeps(store),
			publishFacebookFeedPost: async () => ({
				postId: '123456789_999',
				postUrl: 'https://www.facebook.com/123456789_999',
				raw: { id: '123456789_999' },
			}),
			withFacebookPublishCredits: async (_job, execute) => execute(),
			...overrides.deps,
		},
	};
}

describe('facebook F4-4 publish queue executor', () => {
	it('isFacebookQueueEnabled respects FACEBOOK_QUEUE_ENABLED', () => {
		const prev = process.env.FACEBOOK_QUEUE_ENABLED;
		try {
			delete process.env.FACEBOOK_QUEUE_ENABLED;
			assert.equal(isFacebookQueueEnabled(), true);
			process.env.FACEBOOK_QUEUE_ENABLED = 'false';
			assert.equal(isFacebookQueueEnabled(), false);
			process.env.FACEBOOK_QUEUE_ENABLED = 'true';
			assert.equal(isFacebookQueueEnabled(), true);
		} finally {
			if (prev === undefined) delete process.env.FACEBOOK_QUEUE_ENABLED;
			else process.env.FACEBOOK_QUEUE_ENABLED = prev;
		}
	});

	it('processJob publishes successfully and updates job + event', async () => {
		const { store, deps } = baseDeps();
		await processJob(baseJob, deps);

		const updated = store.getJob('job_1');
		assert.equal(updated.status, 'published');
		assert.equal(updated.facebook_post_id, '123456789_999');
		assert.equal(updated.facebook_post_url, 'https://www.facebook.com/123456789_999');
		assert.ok(updated.published_at);

		const publishedEvent = store.events.find((evt) => evt.event_type === 'published');
		assert.ok(publishedEvent);
		assert.equal(publishedEvent.payload.facebookPostId, '123456789_999');
	});

	it('processJob is idempotent when facebook_post_id already exists', async () => {
		const jobWithPost = {
			...baseJob,
			facebook_post_id: '123456789_existing',
			facebook_post_url: 'https://www.facebook.com/123456789_existing',
			published_at: '2026-08-06T10:00:00.000Z',
		};
		const { store, deps } = baseDeps({ store: createJobStore([jobWithPost]) });
		let publishCalls = 0;
		deps.publishFacebookFeedPost = async () => {
			publishCalls += 1;
			return { postId: 'should-not-call', postUrl: '' };
		};

		await processJob(jobWithPost, deps);

		assert.equal(publishCalls, 0);
		assert.equal(store.getJob('job_1').status, 'published');
		const idempotentEvent = store.events.find((evt) => evt.payload?.idempotent === true);
		assert.ok(idempotentEvent);
	});

	it('processDueJobs schedules retry on retryable failure', async () => {
		const scheduledJob = {
			...baseJob,
			id: 'job_retry',
			status: 'scheduled',
			scheduled_at: '2020-01-01T00:00:00.000Z',
			claim_token: '',
			claim_version: 0,
		};
		const { store, deps } = baseDeps({ store: createJobStore([scheduledJob]) });
		deps.publishFacebookFeedPost = async () => {
			const error = new Error('rate limited');
			error.status = 429;
			error.retryable = true;
			error.errorCode = 'FACEBOOK_GRAPH_RATE_LIMITED';
			error.rateLimitRetryAfterMs = 30000;
			throw error;
		};

		await processDueJobs({
			...deps,
			loadDueJobs: async () => [{ ...scheduledJob }],
		});

		const updated = store.getJob('job_retry');
		assert.equal(updated.status, 'scheduled');
		assert.equal(updated.attempt_count, 1);
		assert.ok(updated.next_retry_at);
		assert.match(updated.last_error, /rate limited/);

		const retryEvent = store.events.find((evt) => evt.event_type === 'retry_scheduled');
		assert.ok(retryEvent);
		assert.equal(retryEvent.payload.failureKind, 'rate_limited');
	});

	it('processDueJobs marks terminal failure when retries exhausted or non-retryable', async () => {
		const scheduledJob = {
			...baseJob,
			id: 'job_fail',
			status: 'scheduled',
			scheduled_at: '2020-01-01T00:00:00.000Z',
			attempt_count: 2,
			max_attempts: 3,
			claim_token: '',
			claim_version: 0,
		};
		const { store, deps } = baseDeps({ store: createJobStore([scheduledJob]) });
		deps.publishFacebookFeedPost = async () => {
			const error = new Error('Invalid parameter');
			error.status = 422;
			error.retryable = false;
			error.errorCode = 'FACEBOOK_GRAPH_INVALID_PARAMETER';
			throw error;
		};

		await processDueJobs({
			...deps,
			loadDueJobs: async () => [{ ...scheduledJob }],
		});

		const updated = store.getJob('job_fail');
		assert.equal(updated.status, 'failed');
		assert.equal(updated.attempt_count, 3);
		const failedEvent = store.events.find((evt) => evt.event_type === 'failed');
		assert.ok(failedEvent);
		assert.equal(failedEvent.payload.failureKind, 'terminal');
	});

	it('processDueJobs emits claimed before published in order', async () => {
		const scheduledJob = {
			...baseJob,
			id: 'job_order',
			status: 'scheduled',
			scheduled_at: '2020-01-01T00:00:00.000Z',
			claim_token: '',
			claim_version: 0,
		};
		const { store, deps } = baseDeps({ store: createJobStore([scheduledJob]) });

		await processDueJobs({
			...deps,
			loadDueJobs: async () => [{ ...scheduledJob }],
		});

		const types = store.events.map((evt) => evt.event_type);
		assert.deepEqual(types, ['claimed', 'published']);
	});

	it('processJob skips duplicate published events for the same post id', async () => {
		const jobWithPost = {
			...baseJob,
			facebook_post_id: '123456789_existing',
			facebook_post_url: 'https://www.facebook.com/123456789_existing',
		};
		const store = createJobStore([jobWithPost]);
		store.events.push({
			job: 'job_1',
			event_type: 'published',
			payload: { idempotencyKey: 'published:job_1:123456789_existing' },
		});
		const { deps } = baseDeps({ store });

		await processJob(jobWithPost, deps);
		const publishedEvents = store.events.filter((evt) => evt.event_type === 'published');
		assert.equal(publishedEvents.length, 1);
	});

	it('claimScheduledJob allows only one concurrent winner (CAS)', async () => {
		const scheduledJob = {
			...baseJob,
			id: 'job_cas',
			status: 'scheduled',
			claim_token: '',
			claim_version: 0,
		};
		const { deps } = baseDeps({ store: createJobStore([scheduledJob]) });

		const outcomes = await Promise.all([
			claimScheduledJob('job_cas', deps),
			claimScheduledJob('job_cas', deps),
		]);

		const winners = outcomes.filter(Boolean);
		assert.equal(winners.length, 1);
		assert.equal(winners[0].status, 'publishing');
		assert.ok(winners[0].claim_token);
	});

	it('recoverStuckPublishingJobs finalizes published post ids and re-schedules others', async () => {
		const stuckPublished = {
			...baseJob,
			id: 'job_stuck_published',
			status: 'publishing',
			facebook_post_id: '123456789_done',
			updated: '2020-01-01T00:00:00.000Z',
		};
		const stuckOpen = {
			...baseJob,
			id: 'job_stuck_open',
			status: 'publishing',
			facebook_post_id: '',
			updated: '2020-01-01T00:00:00.000Z',
		};
		const recent = {
			...baseJob,
			id: 'job_recent',
			status: 'publishing',
			updated: new Date().toISOString(),
		};
		const { store, deps } = baseDeps({
			store: createJobStore([stuckPublished, stuckOpen, recent]),
		});

		await recoverStuckPublishingJobs({
			...deps,
			loadStuckJobs: async () => [
				{ ...stuckPublished },
				{ ...stuckOpen },
				{ ...recent },
			],
		});

		assert.equal(store.getJob('job_stuck_published').status, 'published');
		assert.equal(store.getJob('job_stuck_open').status, 'scheduled');
		assert.match(store.getJob('job_stuck_open').last_error, /Recovered after stuck publishing/);
		assert.equal(store.getJob('job_recent').status, 'publishing');
	});
});

describe('facebook queue workspace isolation (P2-5)', () => {
	it('processJob publishes a WS-A job with a WS-A account', async () => {
		const { store, deps } = baseDeps();
		let publishCalls = 0;
		deps.publishFacebookFeedPost = async () => {
			publishCalls += 1;
			return {
				postId: '123456789_999',
				postUrl: 'https://www.facebook.com/123456789_999',
			};
		};
		await processJob(baseJob, deps);
		assert.equal(publishCalls, 1);
		assert.equal(store.getJob('job_1').status, 'published');
	});

	it('rejects a WS-A job with a WS-B account and does not call Facebook', async () => {
		const { store, deps } = baseDeps();
		let publishCalls = 0;
		deps.getOwnedFacebookAccountById = async () => ({ ...baseAccount, workspace: 'ws_b' });
		deps.publishFacebookFeedPost = async () => {
			publishCalls += 1;
			return { postId: 'should-not-call', postUrl: '' };
		};

		await assert.rejects(
			() => processJob(baseJob, deps),
			(error) => error.status === 422 && /not connected/.test(error.message),
		);
		assert.equal(publishCalls, 0);
		assert.equal(store.getJob('job_1').status, 'publishing');
		assert.equal(store.getJob('job_1').facebook_post_id, undefined);
	});

	it('rejects a job with missing workspace and does not call Facebook', async () => {
		const { deps } = baseDeps();
		let publishCalls = 0;
		deps.publishFacebookFeedPost = async () => {
			publishCalls += 1;
			return { postId: 'should-not-call', postUrl: '' };
		};

		await assert.rejects(
			() => processJob({ ...baseJob, workspace: '' }, deps),
			(error) => error.status === 403 && /workspace is missing/.test(error.message) && error.retryable === false,
		);
		assert.equal(publishCalls, 0);
	});

	it('rejects a mismatched account workspace and does not call Facebook', async () => {
		const { deps } = baseDeps();
		let publishCalls = 0;
		deps.getOwnedFacebookAccountById = async () => ({ ...baseAccount, workspace: 'ws_other' });
		deps.publishFacebookFeedPost = async () => {
			publishCalls += 1;
			return { postId: 'should-not-call', postUrl: '' };
		};

		await assert.rejects(
			() => processJob(baseJob, deps),
			(error) => error.status === 422,
		);
		assert.equal(publishCalls, 0);
	});

	it('rejects a mismatched page workspace and does not call Facebook', async () => {
		const { deps } = baseDeps();
		let publishCalls = 0;
		deps.getFacebookPageForQueueJob = async () => ({ ...basePage, workspace: 'ws_b' });
		deps.publishFacebookFeedPost = async () => {
			publishCalls += 1;
			return { postId: 'should-not-call', postUrl: '' };
		};

		await assert.rejects(
			() => processJob(baseJob, deps),
			(error) => error.status === 404 && /Page was not found/.test(error.message),
		);
		assert.equal(publishCalls, 0);
	});
});
