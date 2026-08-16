/**
 * CR-P1-2 — Facebook publish worker credit gate.
 * Reservation happens in the claimed worker before any Graph publish call.
 * Run: node --test src/services/facebook/facebook-publish-credits.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FACEBOOK_PUBLISH_CREDIT_FEATURE,
	FACEBOOK_PUBLISH_CREDIT_UNITS,
	facebookPublishCreditIdempotencyKey,
	readFacebookPublishWorkspaceKey,
	requireFacebookPublishWorkspaceKey,
	withFacebookPublishCredits,
} from './facebook-publish-credits.js';
import { processDueJobs, processJob } from './facebook-publish-queue.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.join(here, 'facebook-publish-credits.js'), 'utf8');
const queueSource = readFileSync(path.join(here, 'facebook-publish-queue.js'), 'utf8');
const engineSource = readFileSync(path.join(here, '../credits-engine.js'), 'utf8');

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function createMemoryCreditGate(initialWallets = {}) {
	const wallets = { ...initialWallets };
	const reservationsByKey = new Map();
	const reservationsById = new Map();
	const beginCalls = [];
	const settleCalls = [];
	let seq = 0;
	let gateChain = Promise.resolve();

	function serialize(work) {
		const run = gateChain.then(work, work);
		gateChain = run.then(() => undefined, () => undefined);
		return run;
	}

	return {
		wallets,
		beginCalls,
		settleCalls,
		reservationsByKey,
		reservationsById,
		beginFeatureReservation: async ({
			workspaceKey,
			feature,
			units = 1,
			idempotencyKey = '',
		} = {}) => serialize(async () => {
			const key = String(workspaceKey || '').trim();
			beginCalls.push({
				workspaceKey: key,
				feature,
				units,
				idempotencyKey,
			});
			if (!key) {
				throw httpError(422, 'workspaceKey is required', 'VALIDATION_ERROR');
			}
			if (idempotencyKey && reservationsByKey.has(idempotencyKey)) {
				const existing = reservationsByKey.get(idempotencyKey);
				return { ...existing };
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
		}),
		settleFeatureReservation: async (reservationId, { success } = {}) => serialize(async () => {
			settleCalls.push({ id: reservationId, success: Boolean(success) });
			const row = reservationsById.get(reservationId);
			if (!row) return { settled: 'noop', reservation: null };
			if (row.status !== 'reserved') {
				return { settled: row.status, reservation: { ...row } };
			}
			if (success) {
				row.status = 'committed';
				return { settled: 'committed', reservation: { ...row } };
			}
			row.status = 'released';
			wallets[row.workspaceKey] = (Number(wallets[row.workspaceKey]) || 0) + (Number(row.amount) || 1);
			return { settled: 'released', reservation: { ...row } };
		}),
	};
}

function baseJob(overrides = {}) {
	return {
		id: 'job_fb_1',
		owner: 'user_owner',
		workspace: 'ws_record_a',
		workspace_key: 'ws-a',
		attempt_count: 0,
		...overrides,
	};
}

describe('facebookPublishCreditIdempotencyKey', () => {
	it('is unique per job and attempt so retries cannot reuse a reservation', () => {
		assert.equal(
			facebookPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			'facebook-publish:job1:attempt:0',
		);
		assert.equal(
			facebookPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 1 }),
			'facebook-publish:job1:attempt:1',
		);
		assert.notEqual(
			facebookPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			facebookPublishCreditIdempotencyKey({ id: 'job2', attempt_count: 0 }),
		);
	});
});

describe('requireFacebookPublishWorkspaceKey', () => {
	it('D. missing workspace key fails closed even when owner is present', async () => {
		await assert.rejects(
			() => requireFacebookPublishWorkspaceKey({ id: 'job1', owner: 'user_owner', workspace: '' }),
			(error) => error.status === 422 && error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('does not use owner as the wallet key', async () => {
		assert.equal(readFacebookPublishWorkspaceKey({ owner: 'user_owner', workspace_key: '' }), '');
		await assert.rejects(
			() => requireFacebookPublishWorkspaceKey({ id: 'job1', owner: 'user_owner' }),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('accepts explicit workspace_key and expanded workspace.workspace_key', async () => {
		assert.equal(await requireFacebookPublishWorkspaceKey({ workspace_key: 'ws-a' }), 'ws-a');
		assert.equal(await requireFacebookPublishWorkspaceKey({
			workspace: { id: 'ws_record_a', workspace_key: 'ws-from-expand' },
		}), 'ws-from-expand');
	});

	it('resolves workspace.workspace_key and never owner from the workspace record', async () => {
		const key = await requireFacebookPublishWorkspaceKey(
			{ workspace: 'ws_record_a', owner: 'user_owner' },
			{
				getWorkspace: async (id) => {
					assert.equal(id, 'ws_record_a');
					return { id, owner: 'user_owner', workspace_key: 'ws-a' };
				},
			},
		);
		assert.equal(key, 'ws-a');

		await assert.rejects(
			() => requireFacebookPublishWorkspaceKey(
				{ workspace: 'ws_record_a', owner: 'user_owner' },
				{ getWorkspace: async () => ({ id: 'ws_record_a', owner: 'user_owner' }) },
			),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});
});

describe('withFacebookPublishCredits', () => {
	it('A. 0 credits → 0 Facebook Graph API calls', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let providerCalls = 0;
		await assert.rejects(
			() => withFacebookPublishCredits(baseJob(), async () => {
				providerCalls += 1;
				return { postId: 'x' };
			}, gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls.length, 0);
	});

	it('B. 1 credit → one reservation, one Graph publish, one commit', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		const result = await withFacebookPublishCredits(baseJob(), async () => {
			providerCalls += 1;
			assert.equal(gate.wallets['ws-a'], 0, 'reservation holds the credit before Graph');
			return { postId: '123_999' };
		}, gate);
		assert.equal(providerCalls, 1);
		assert.equal(result.postId, '123_999');
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.beginCalls[0].feature, FACEBOOK_PUBLISH_CREDIT_FEATURE);
		assert.equal(gate.beginCalls[0].units, FACEBOOK_PUBLISH_CREDIT_UNITS);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, true);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
	});

	it('C. Graph/provider failure → reservation released', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		await assert.rejects(
			() => withFacebookPublishCredits(baseJob(), async () => {
				providerCalls += 1;
				throw new Error('graph 500');
			}, gate),
			/graph 500/,
		);
		assert.equal(providerCalls, 1);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, false);
		assert.equal([...gate.reservationsById.values()][0].status, 'released');
	});

	it('D. missing workspace key → no reservation and no Graph call', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 9 });
		let providerCalls = 0;
		await assert.rejects(
			() => withFacebookPublishCredits({ id: 'job1', owner: 'user_owner' }, async () => {
				providerCalls += 1;
				return { postId: 'x' };
			}, gate),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.wallets['ws-a'], 9);
	});

	it('E. workspace A cannot spend workspace B', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0, 'ws-b': 10 });
		let providerCalls = 0;
		await assert.rejects(
			() => withFacebookPublishCredits(baseJob({ workspace_key: 'ws-a' }), async () => {
				providerCalls += 1;
				return { postId: 'x' };
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.wallets['ws-b'], 10);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.ok(gate.beginCalls.every((call) => call.workspaceKey !== 'ws-b'));
	});

	it('E. a workspace B job spends only workspace B', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 5, 'ws-b': 1 });
		await withFacebookPublishCredits(
			baseJob({ workspace_key: 'ws-b', owner: 'owner-a' }),
			async () => ({ postId: 'x' }),
			gate,
		);
		assert.equal(gate.wallets['ws-a'], 5);
		assert.equal(gate.wallets['ws-b'], 0);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-b');
	});

	it('F. retry uses a new reservation key', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		await assert.rejects(
			() => withFacebookPublishCredits(baseJob({ attempt_count: 0 }), async () => {
				throw new Error('graph timeout');
			}, gate),
			/graph timeout/,
		);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.beginCalls[0].idempotencyKey, 'facebook-publish:job_fb_1:attempt:0');

		let retryProviderCalls = 0;
		await withFacebookPublishCredits(baseJob({ attempt_count: 1 }), async () => {
			retryProviderCalls += 1;
			return { postId: 'retry' };
		}, gate);
		assert.equal(retryProviderCalls, 1);
		assert.equal(gate.beginCalls[1].idempotencyKey, 'facebook-publish:job_fb_1:attempt:1');
		assert.notEqual(gate.beginCalls[0].idempotencyKey, gate.beginCalls[1].idempotencyKey);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls[1].success, true);
	});

	it('G. released reservation for the same attempt cannot call Graph', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await assert.rejects(
			() => withFacebookPublishCredits(job, async () => {
				throw new Error('provider down');
			}, gate),
		);
		let providerCalls = 0;
		await assert.rejects(
			() => withFacebookPublishCredits(job, async () => {
				providerCalls += 1;
				return { postId: 'x' };
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_INACTIVE',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 1);
	});

	it('G. committed reservation for the same attempt cannot call Graph', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await withFacebookPublishCredits(job, async () => ({ postId: 'x' }), gate);
		let providerCalls = 0;
		await assert.rejects(
			() => withFacebookPublishCredits(job, async () => {
				providerCalls += 1;
				return { postId: 'dup' };
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_COMMITTED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
	});

	it('insufficient credits errors are not swallowed', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		await assert.rejects(
			() => withFacebookPublishCredits(baseJob(), async () => ({ postId: 'x' }), gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
	});
});

describe('CR-P1-2 wiring — reservation location and existing success path', () => {
	it('H. claimed processJob reserves immediately before Graph publish', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('export async function processJob'),
			queueSource.indexOf('async function getDuePublishJobs'),
		);
		assert.match(processFn, /reserveCredits\(job,/);
		assert.match(processFn, /withFacebookPublishCredits/);
		assert.match(processFn, /publishFeed\(/);
		assert.ok(
			processFn.indexOf('reserveCredits(job,') < processFn.indexOf('publishFeed('),
			'reservation wrapper must start before Graph publish',
		);
		assert.ok(
			processFn.indexOf('assertFacebookQueueWorkspaceIsolation')
				< processFn.indexOf('reserveCredits(job,'),
			'workspace isolation must run before credit reservation',
		);
		assert.ok(
			processFn.indexOf('hasExistingFacebookPostId') < processFn.indexOf('reserveCredits(job,'),
			'idempotent already-published skip must exit before reservation',
		);
		assert.doesNotMatch(processFn, /burnFacebookPublishCredits/);
		assert.doesNotMatch(processFn, /consumeFeatureCredits/);
		assert.doesNotMatch(processFn, /workspaceKeyForUser/);
	});

	it('H. existing successful publish path remains intact after the credit gate', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('export async function processJob'),
			queueSource.indexOf('async function getDuePublishJobs'),
		);
		assert.match(processFn, /status: 'published'/);
		assert.match(processFn, /facebook_post_id/);
		assert.match(processFn, /buildFacebookPublishPublishedEventPayload/);
		assert.match(processFn, /publishFeed\(/);
		const wrapperStart = processFn.indexOf('reserveCredits(job,');
		const successPublished = processFn.indexOf("}, 'facebook-queue:mark-published')");
		assert.ok(successPublished > wrapperStart, 'successful mark-published still follows the Graph wrap');
		assert.ok(
			processFn.indexOf("}, 'facebook-queue:mark-published-idempotent'") < wrapperStart,
			'idempotent published skip still exists before reservation',
		);
	});

	it('I. already-published jobs skip Graph before reservation and do not charge', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('export async function processJob'),
			queueSource.indexOf('async function getDuePublishJobs'),
		);
		assert.match(processFn, /hasExistingFacebookPostId\(job\.facebook_post_id\)/);
		assert.ok(
			processFn.indexOf('hasExistingFacebookPostId(job.facebook_post_id)')
				< processFn.indexOf('reserveCredits(job,'),
		);
		assert.match(processFn, /idempotent: true/);
	});

	it('J. scheduled Facebook publishing follows the same gate', () => {
		assert.match(queueSource, /export async function processDueJobs/);
		assert.match(queueSource, /claimScheduledJob/);
		assert.match(queueSource, /processJob\(locked, deps\)/);
		assert.ok(
			queueSource.indexOf('claimScheduledJob(job.id, deps)')
				< queueSource.indexOf('processJob(locked, deps)'),
			'claim must happen before processJob',
		);
		const dueFn = queueSource.slice(
			queueSource.indexOf('export async function processDueJobs'),
			queueSource.indexOf('export async function recoverStuckPublishingJobs'),
		);
		assert.match(dueFn, /processJob\(locked, deps\)/);
		assert.doesNotMatch(dueFn, /publishFacebookFeedPost/);
		assert.doesNotMatch(dueFn, /publishFeed\(/);
	});

	it('queue claim still aborts on token mismatch before processJob', () => {
		assert.match(queueSource, /verified.claim_token !== claimToken/);
		assert.ok(
			queueSource.indexOf('verified.claim_token !== claimToken')
				< queueSource.indexOf('processJob(locked, deps)'),
		);
	});

	it('helper never falls back to owner/user id for the wallet', () => {
		assert.doesNotMatch(helperSource, /workspaceKeyForUser/);
		assert.doesNotMatch(helperSource, /workspaceKey \|\| userId/);
		assert.doesNotMatch(helperSource, /consumeFeatureCredits/);
		assert.doesNotMatch(helperSource, /burnFacebookPublishCredits/);
		assert.match(helperSource, /Never uses owner \/ user id as the wallet key/);
		assert.match(helperSource, /FACEBOOK_PUBLISH_CREDIT_FEATURE = 'facebook_publish'/);
		assert.match(helperSource, /FACEBOOK_PUBLISH_CREDIT_UNITS = 1/);
	});

	it('credits-engine facebook_publish cost remains 1 and is not redefined here', () => {
		assert.match(engineSource, /facebook_publish:\s*1/);
		assert.doesNotMatch(helperSource, /planCreditCosts/);
		assert.doesNotMatch(queueSource, /planCreditCosts/);
		assert.doesNotMatch(helperSource, /DEFAULT_CREDIT_COSTS/);
	});

	it('queue no longer has post-pay consume or swallowed credit errors', () => {
		assert.doesNotMatch(queueSource, /burnFacebookPublishCredits/);
		assert.doesNotMatch(queueSource, /consumeFeatureCredits/);
		assert.doesNotMatch(queueSource, /workspaceKeyForUser/);
		assert.match(queueSource, /withFacebookPublishCredits/);
	});
});

describe('CR-P1-2 processJob / scheduled worker integration', () => {
	const account = {
		id: 'acc_1',
		owner: 'user_1',
		workspace: 'ws_1',
		connected: true,
		page_tokens: { 123456789: 'cipher' },
	};
	const page = {
		id: 'page_row_1',
		owner: 'user_1',
		workspace: 'ws_1',
		account: 'acc_1',
		page_id: '123456789',
	};

	function createStore(jobs) {
		const map = new Map(jobs.map((job) => [job.id, { ...job }]));
		return {
			map,
			client: {
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
								const row = map.get(id);
								if (!row) throw new Error('not found');
								return { ...row };
							},
							update: async (id, payload) => {
								const current = map.get(id);
								const next = { ...current, ...payload, updated: new Date().toISOString() };
								map.set(id, next);
								return { ...next };
							},
						};
					}
					if (name === 'facebook_publish_events') {
						return { create: async (payload) => ({ id: 'evt_1', ...payload }) };
					}
					throw new Error(`unexpected collection ${name}`);
				},
			},
		};
	}

	function workerJob(overrides = {}) {
		return {
			id: 'job_1',
			owner: 'user_1',
			workspace: 'ws_1',
			workspace_key: 'ws-a',
			account: 'acc_1',
			page_id: '123456789',
			message: 'Hello Facebook',
			image_url: 'https://cdn.example.com/post.jpg',
			destination_url: 'https://example.com/recipe',
			status: 'publishing',
			attempt_count: 0,
			max_attempts: 3,
			claim_token: 'tok',
			claim_version: 1,
			...overrides,
		};
	}

	function workerDeps(store, gate, extra = {}) {
		let graphCalls = 0;
		return {
			graphCalls: () => graphCalls,
			deps: {
				pocketbaseClient: store.client,
				client: store.client,
				sanitizePayload: async (payload) => payload,
				getOwnedFacebookAccountById: async () => ({ ...account }),
				getFacebookPageForQueueJob: async () => ({ ...page }),
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
					graphCalls += 1;
					return {
						postId: '123456789_999',
						postUrl: 'https://www.facebook.com/123456789_999',
					};
				},
				beginFeatureReservation: gate.beginFeatureReservation,
				settleFeatureReservation: gate.settleFeatureReservation,
				getWorkspace: async () => ({ workspace_key: 'ws-a' }),
				...extra,
			},
		};
	}

	it('H. processJob success path still marks published after a reserved Graph call', async () => {
		const job = workerJob();
		const store = createStore([job]);
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const { deps, graphCalls } = workerDeps(store, gate);
		await processJob(job, deps);
		assert.equal(graphCalls(), 1);
		assert.equal(store.map.get('job_1').status, 'published');
		assert.equal(store.map.get('job_1').facebook_post_id, '123456789_999');
		assert.equal(gate.settleCalls[0].success, true);
	});

	it('I. processJob skips Graph and does not reserve when facebook_post_id exists', async () => {
		const job = workerJob({
			facebook_post_id: '123456789_existing',
			facebook_post_url: 'https://www.facebook.com/123456789_existing',
		});
		const store = createStore([job]);
		const gate = createMemoryCreditGate({ 'ws-a': 9 });
		const { deps, graphCalls } = workerDeps(store, gate);
		await processJob(job, deps);
		assert.equal(graphCalls(), 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(store.map.get('job_1').status, 'published');
	});

	it('J. processDueJobs uses the same reservation gate before Graph', async () => {
		const scheduled = workerJob({
			id: 'job_sched',
			status: 'scheduled',
			scheduled_at: '2020-01-01T00:00:00.000Z',
			claim_token: '',
			claim_version: 0,
		});
		const store = createStore([scheduled]);
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		const { deps, graphCalls } = workerDeps(store, gate);
		await processDueJobs({
			...deps,
			loadDueJobs: async () => [{ ...scheduled }],
		});
		assert.equal(graphCalls(), 0);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(store.map.get('job_sched').status, 'scheduled');
		assert.equal(store.map.get('job_sched').attempt_count, 1);
		assert.match(store.map.get('job_sched').last_error, /Insufficient credits/i);
	});
});
