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
	facebookPublishCreditIdempotencyKey,
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
	workspace: 'ws_1',
	workspace_key: 'ws_1',
	account: 'acc_1',
	page_id: '123456789',
	message: 'Hello Facebook',
	image_url: 'https://cdn.example.com/post.jpg',
	destination_url: 'https://example.com/recipe',
	status: 'publishing',
	attempt_count: 0,
};

function createMemoryCreditGate(initialWallets = {}) {
	const wallets = { ...initialWallets };
	const reservationsByKey = new Map();
	const reservationsById = new Map();
	const beginCalls = [];
	const settleCalls = [];
	let seq = 0;

	function httpError(status, message, errorCode) {
		const error = new Error(message);
		error.status = status;
		error.errorCode = errorCode;
		return error;
	}

	return {
		wallets,
		beginCalls,
		settleCalls,
		beginFeatureReservation: async ({
			workspaceKey,
			feature,
			units = 1,
			idempotencyKey = '',
		} = {}) => {
			const key = String(workspaceKey || '').trim();
			beginCalls.push({ workspaceKey: key, feature, units, idempotencyKey });
			if (idempotencyKey && reservationsByKey.has(idempotencyKey)) {
				return { ...reservationsByKey.get(idempotencyKey) };
			}
			const balance = Number(wallets[key] || 0);
			if (balance < 1) {
				const error = httpError(402, `Insufficient credits. Remaining: ${balance}`, 'INSUFFICIENT_CREDITS');
				error.remaining = balance;
				throw error;
			}
			wallets[key] = balance - 1;
			const row = {
				id: `res_${++seq}`,
				workspaceKey: key,
				status: 'reserved',
				amount: 1,
				feature,
				units,
				idempotencyKey,
			};
			if (idempotencyKey) reservationsByKey.set(idempotencyKey, row);
			reservationsById.set(row.id, row);
			return { ...row };
		},
		settleFeatureReservation: async (reservationId, { success } = {}) => {
			settleCalls.push({ id: reservationId, success: Boolean(success) });
			const row = reservationsById.get(reservationId);
			if (!row || row.status !== 'reserved') {
				return { settled: row?.status || 'noop', reservation: row ? { ...row } : null };
			}
			if (success) {
				row.status = 'committed';
				return { settled: 'committed', reservation: { ...row } };
			}
			row.status = 'released';
			wallets[row.workspaceKey] = (Number(wallets[row.workspaceKey]) || 0) + (Number(row.amount) || 1);
			return { settled: 'released', reservation: { ...row } };
		},
	};
}

function createMinimalDeps(overrides = {}) {
	const gate = overrides.creditGate || createMemoryCreditGate({ ws_1: 10 });
	const graphCalls = [];
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
				if (name === 'workspaces') {
					return {
						getOne: async () => ({ id: 'ws_1', workspace_key: 'ws_1' }),
					};
				}
				throw new Error(`unexpected collection ${name}`);
			},
		},
		sanitizePayload: async (payload) => payload,
		getOwnedFacebookAccountById: async () => ({
			id: 'acc_1',
			owner: 'user_1',
			workspace: 'ws_1',
			connected: true,
			page_tokens: { 123456789: 'cipher' },
		}),
		getFacebookPageForQueueJob: async () => ({
			id: 'page_row_1',
			owner: 'user_1',
			workspace: 'ws_1',
			account: 'acc_1',
			page_id: '123456789',
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
		publishFacebookFeedPost: async () => {
			graphCalls.push(Date.now());
			return {
				postId: '123456789_999',
				postUrl: 'https://www.facebook.com/123456789_999',
			};
		},
		beginFeatureReservation: gate.beginFeatureReservation,
		settleFeatureReservation: gate.settleFeatureReservation,
		getWorkspace: async () => ({ workspace_key: 'ws_1' }),
		...overrides,
	};
	delete deps.creditGate;
	return { deps, gate, graphCalls };
}

describe('facebook F4-6 production integration', () => {
	it('enables publishNow, queueImplemented, schedule, and publishing history capabilities', () => {
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

	it('buildFacebookPublishCreditIdempotencyKey is unique per job attempt', () => {
		assert.equal(
			buildFacebookPublishCreditIdempotencyKey('job_abc'),
			'facebook-publish:job_abc:attempt:0',
		);
		assert.equal(
			facebookPublishCreditIdempotencyKey({ id: 'job_abc', attempt_count: 1 }),
			'facebook-publish:job_abc:attempt:1',
		);
		assert.notEqual(
			facebookPublishCreditIdempotencyKey({ id: 'job_abc', attempt_count: 0 }),
			facebookPublishCreditIdempotencyKey({ id: 'job_abc', attempt_count: 1 }),
		);
	});

	it('processJob reserves before Graph and commits after successful publish', async () => {
		const gate = createMemoryCreditGate({ ws_1: 1 });
		const { deps, graphCalls } = createMinimalDeps({ creditGate: gate });
		await processJob(baseJob, deps);

		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.beginCalls[0].feature, FACEBOOK_PUBLISH_CREDIT_FEATURE);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws_1');
		assert.equal(graphCalls.length, 1);
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, true);
		assert.ok(
			gate.beginCalls[0].idempotencyKey === 'facebook-publish:job_credit_1:attempt:0',
		);
	});

	it('processJob releases the reservation on Graph failure and does not swallow it', async () => {
		const gate = createMemoryCreditGate({ ws_1: 1 });
		const { deps, graphCalls } = createMinimalDeps({
			creditGate: gate,
			publishFacebookFeedPost: async () => {
				graphCalls.push(1);
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
		assert.equal(graphCalls.length, 1);
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, false);
		assert.equal(gate.wallets.ws_1, 1);
	});

	it('processJob does not reserve or call Graph on the idempotent finalize path', async () => {
		const gate = createMemoryCreditGate({ ws_1: 10 });
		const { deps, graphCalls } = createMinimalDeps({ creditGate: gate });
		const idempotentJob = {
			...baseJob,
			facebook_post_id: '123456789_existing',
			facebook_post_url: 'https://www.facebook.com/123456789_existing',
			published_at: '2026-08-06T10:00:00.000Z',
		};

		await processJob(idempotentJob, deps);
		assert.equal(graphCalls.length, 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.settleCalls.length, 0);
	});

	it('processJob with 0 credits never calls Graph and does not swallow 402', async () => {
		const gate = createMemoryCreditGate({ ws_1: 0 });
		const { deps, graphCalls } = createMinimalDeps({ creditGate: gate });
		await assert.rejects(
			() => processJob(baseJob, deps),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
		assert.equal(graphCalls.length, 0);
		assert.equal(gate.settleCalls.length, 0);
	});
});
