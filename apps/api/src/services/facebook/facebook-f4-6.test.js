import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FACEBOOK_CHANNEL_CAPABILITIES,
	getFacebookChannelPackDto,
} from './channel-pack.js';
import {
	FACEBOOK_PUBLISH_CREDIT_FEATURE,
	buildFacebookPublishCreditIdempotencyKey,
	burnFacebookPublishCredits,
} from './facebook-publish-credits.js';
import { processJob } from './facebook-publish-queue.js';
import { getFacebookQueueStatus } from './facebook-publish-queue.js';
import {
	CHANNEL_EXECUTORS,
	getChannelExecutorRuntimeCatalog,
	getQueueOwnershipSnapshot,
} from '../queue/ownership.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

const baseJob = {
	id: 'job_credit_1',
	owner: 'user_1',
	account: 'acc_1',
	page_id: '123456789',
	message: 'Hello Facebook',
	image_url: 'https://cdn.example.com/post.jpg',
	destination_url: 'https://example.com/recipe',
	status: 'publishing',
	attempt_count: 0,
};

function createMinimalDeps(overrides = {}) {
	const burnCalls = [];
	const deps = {
		pocketbaseClient: {
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
						update: async (id, payload) => ({ id, ...payload }),
					};
				}
				if (name === 'facebook_publish_events') {
					return {
						create: async (payload) => ({ id: 'evt_1', ...payload }),
					};
				}
				throw new Error(`unexpected collection ${name}`);
			},
		},
		sanitizePayload: async (payload) => payload,
		getOwnedFacebookAccountById: async () => ({
			id: 'acc_1',
			owner: 'user_1',
			connected: true,
			page_tokens: { 123456789: 'cipher' },
		}),
		decryptPageTokenMap: () => ({ 123456789: 'page-token-plain' }),
		validateFacebookDestinationPost: async () => ({
			ok: true,
			errors: [],
			warnings: [],
			normalized: { pageId: '123456789', accountId: 'acc_1' },
		}),
		markFacebookAccountStatus: async () => null,
		loadEventIdempotencyKeys: async () => [],
		createPublishEvent: async () => null,
		publishFacebookFeedPost: async () => ({
			postId: '123456789_999',
			postUrl: 'https://www.facebook.com/123456789_999',
		}),
		burnFacebookPublishCredits: async (job, options = {}) => {
			burnCalls.push({ job, options });
			return { transactionId: 'tx_1' };
		},
		...overrides,
	};
	return { deps, burnCalls };
}

describe('facebook F4-6 production integration', () => {
	it('enables publishNow, queueImplemented, schedule, and publishing history with insights still off', () => {
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishNow, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.queueImplemented, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.schedule, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, true);

		const dto = getFacebookChannelPackDto();
		assert.equal(dto.publishImplemented, true);
		assert.equal(dto.queueImplemented, true);
	});

	it('registers facebook_publish in credits engine with default cost 1', () => {
		const creditsEngine = readFileSync(
			path.join(root, 'apps/api/src/services/credits-engine.js'),
			'utf8',
		);
		const platformSettings = readFileSync(
			path.join(root, 'apps/api/src/services/platform-settings.js'),
			'utf8',
		);
		assert.match(creditsEngine, /facebook_publish:\s*1/);
		assert.match(platformSettings, /facebook_publish:\s*1/);
		assert.equal(FACEBOOK_PUBLISH_CREDIT_FEATURE, 'facebook_publish');
	});

	it('registers Facebook executor in ownership catalog', () => {
		const facebook = CHANNEL_EXECUTORS.find((entry) => entry.id === 'facebook-publish');
		assert.ok(facebook);
		assert.equal(facebook.jobType, 'facebook_publishing');
		assert.equal(facebook.sourceCollection, 'facebook_publish_jobs');
		assert.equal(facebook.envFlag, 'FACEBOOK_QUEUE_ENABLED');
		assert.equal(facebook.statusHelper, 'getFacebookQueueStatus');

		const snapshot = getQueueOwnershipSnapshot();
		assert.match(snapshot.executionSourceOfTruth, /facebook_publish_jobs/);
	});

	it('exposes Facebook in channel executor runtime catalog', () => {
		const catalog = getChannelExecutorRuntimeCatalog();
		const facebook = catalog.find((entry) => entry.id === 'facebook-publish');
		assert.ok(facebook);
		assert.equal(facebook.statusHelper, 'getFacebookQueueStatus');
		assert.equal(typeof getFacebookQueueStatus(), 'object');
	});

	it('registers Facebook queue in health-check and monitor runtime surfaces', () => {
		const healthCheck = readFileSync(
			path.join(root, 'apps/api/src/routes/health-check.js'),
			'utf8',
		);
		assert.match(healthCheck, /getFacebookQueueStatus/);
		assert.match(healthCheck, /facebookQueue/);

		const monitor = readFileSync(
			path.join(root, 'apps/api/src/services/health/monitor.js'),
			'utf8',
		);
		assert.match(monitor, /facebook-publish-queue/);
	});

	it('buildFacebookPublishCreditIdempotencyKey is stable per job id', () => {
		assert.equal(
			buildFacebookPublishCreditIdempotencyKey('job_abc'),
			'facebook-publish:job_abc',
		);
		assert.equal(
			buildFacebookPublishCreditIdempotencyKey('job_abc'),
			buildFacebookPublishCreditIdempotencyKey('job_abc'),
		);
	});

	it('burnFacebookPublishCredits uses facebook_publish feature and idempotency key', async () => {
		const calls = [];
		await burnFacebookPublishCredits(
			{ id: 'job_99', owner: 'user_9', workspace_key: 'ws_9' },
			{
				facebookPostId: '123_456',
				deps: {
					workspaceKeyForUser: () => 'ws_fallback',
					consumeFeatureCredits: async (_pb, payload) => {
						calls.push(payload);
						return { transactionId: 'tx_99' };
					},
				},
			},
		);

		assert.equal(calls.length, 1);
		assert.equal(calls[0].feature, 'facebook_publish');
		assert.equal(calls[0].units, 1);
		assert.equal(calls[0].idempotencyKey, 'facebook-publish:job_99');
		assert.equal(calls[0].workspaceKey, 'ws_9');
		assert.equal(calls[0].metadata.facebookPostId, '123_456');
	});

	it('processJob burns credits only after successful publish', async () => {
		const { deps, burnCalls } = createMinimalDeps();
		await processJob(baseJob, deps);

		assert.equal(burnCalls.length, 1);
		assert.equal(burnCalls[0].job.id, 'job_credit_1');
		assert.equal(burnCalls[0].options.facebookPostId, '123456789_999');
	});

	it('processJob does not burn credits on publish failure', async () => {
		const { deps, burnCalls } = createMinimalDeps({
			publishFacebookFeedPost: async () => {
				const error = new Error('Graph API failed');
				error.status = 400;
				error.retryable = false;
				throw error;
			},
		});

		await assert.rejects(
			() => processJob(baseJob, deps),
			/Graph API failed|failed/i,
		);
		assert.equal(burnCalls.length, 0);
	});

	it('processJob does not burn credits on idempotent finalize path', async () => {
		const { deps, burnCalls } = createMinimalDeps();
		const idempotentJob = {
			...baseJob,
			facebook_post_id: '123456789_existing',
			facebook_post_url: 'https://www.facebook.com/123456789_existing',
			published_at: '2026-08-06T10:00:00.000Z',
		};

		await processJob(idempotentJob, deps);
		assert.equal(burnCalls.length, 0);
	});

	it('burnFacebookPublishCredits idempotency prevents duplicate burn calls', async () => {
		const calls = [];
		const sharedDeps = {
			workspaceKeyForUser: () => 'ws_1',
			consumeFeatureCredits: async (_pb, payload) => {
				calls.push(payload.idempotencyKey);
				return { idempotent: calls.length > 1, transactionId: 'tx_1' };
			},
		};

		await burnFacebookPublishCredits(
			{ id: 'job_dup', owner: 'user_1' },
			{ deps: sharedDeps },
		);
		await burnFacebookPublishCredits(
			{ id: 'job_dup', owner: 'user_1' },
			{ deps: sharedDeps },
		);

		assert.equal(calls.length, 2);
		assert.equal(calls[0], 'facebook-publish:job_dup');
		assert.equal(calls[1], 'facebook-publish:job_dup');
	});
});
