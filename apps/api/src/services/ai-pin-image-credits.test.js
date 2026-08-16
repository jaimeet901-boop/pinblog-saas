/**
 * CR-P0-2 — AI image worker credit gate.
 * Reservation happens in the claimed worker before any image provider call.
 * Run: node --test src/services/ai-pin-image-credits.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AI_IMAGE_CREDIT_FEATURE,
	AI_IMAGE_CREDIT_UNITS,
	imageCreditIdempotencyKey,
	readImageJobWorkspaceKey,
	requireImageJobWorkspaceKey,
	withAiImageCredits,
} from './ai-pin-image-credits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.join(here, 'ai-pin-image-credits.js'), 'utf8');
const queueSource = readFileSync(path.join(here, 'ai-pin-image-queue.js'), 'utf8');
const routesSource = readFileSync(path.join(here, '../routes/ai-pin-images.js'), 'utf8');
const engineSource = readFileSync(path.join(here, 'credits-engine.js'), 'utf8');

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
		id: 'job_img_1',
		owner: 'user_owner',
		workspace: 'ws_record_a',
		workspace_key: 'ws-a',
		attempt_count: 0,
		image_mode: 'generate_ai',
		...overrides,
	};
}

describe('imageCreditIdempotencyKey', () => {
	it('is unique per job and attempt so retries cannot reuse a reservation', () => {
		assert.equal(imageCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }), 'ai-image:job1:attempt:0');
		assert.equal(imageCreditIdempotencyKey({ id: 'job1', attempt_count: 1 }), 'ai-image:job1:attempt:1');
		assert.notEqual(
			imageCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			imageCreditIdempotencyKey({ id: 'job2', attempt_count: 0 }),
		);
	});
});

describe('requireImageJobWorkspaceKey', () => {
	it('G. missing workspace key fails closed even when owner is present', async () => {
		await assert.rejects(
			() => requireImageJobWorkspaceKey({ id: 'job1', owner: 'user_owner', workspace: '' }),
			(error) => error.status === 422 && error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('does not use owner as the wallet key', async () => {
		assert.equal(readImageJobWorkspaceKey({ owner: 'user_owner', workspace_key: '' }), '');
		await assert.rejects(
			() => requireImageJobWorkspaceKey({ id: 'job1', owner: 'user_owner' }),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('accepts explicit workspace_key and prompt payload key', async () => {
		assert.equal(await requireImageJobWorkspaceKey({ workspace_key: 'ws-a' }), 'ws-a');
		assert.equal(await requireImageJobWorkspaceKey({
			prompt_payload: { creditWorkspaceKey: 'ws-from-payload' },
		}), 'ws-from-payload');
	});

	it('resolves workspace.workspace_key and never owner from the workspace record', async () => {
		const key = await requireImageJobWorkspaceKey(
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
			() => requireImageJobWorkspaceKey(
				{ workspace: 'ws_record_a', owner: 'user_owner' },
				{ getWorkspace: async () => ({ id: 'ws_record_a', owner: 'user_owner' }) },
			),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});
});

describe('withAiImageCredits', () => {
	it('A. 0 credits → provider called 0 times', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let providerCalls = 0;
		await assert.rejects(
			() => withAiImageCredits(baseJob(), async () => {
				providerCalls += 1;
				return [{ url: 'x' }];
			}, gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls.length, 0);
	});

	it('B. 1 credit → one successful image consumes exactly 1', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		const result = await withAiImageCredits(baseJob(), async () => {
			providerCalls += 1;
			assert.equal(gate.wallets['ws-a'], 0, 'reservation holds the credit before provider');
			return [{ bytes: Buffer.from('img') }];
		}, gate);
		assert.equal(providerCalls, 1);
		assert.equal(result.length, 1);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.beginCalls[0].feature, AI_IMAGE_CREDIT_FEATURE);
		assert.equal(gate.beginCalls[0].units, AI_IMAGE_CREDIT_UNITS);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, true);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
	});

	it('C. provider failure → credit restored/released', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		await assert.rejects(
			() => withAiImageCredits(baseJob(), async () => {
				providerCalls += 1;
				throw new Error('fal timeout');
			}, gate),
			/fal timeout/,
		);
		assert.equal(providerCalls, 1);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, false);
		assert.equal([...gate.reservationsById.values()][0].status, 'released');
	});

	it('D. retry → requires a new valid reservation', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const firstJob = baseJob({ attempt_count: 0 });
		await assert.rejects(
			() => withAiImageCredits(firstJob, async () => {
				throw new Error('openai 500');
			}, gate),
			/openai 500/,
		);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.beginCalls[0].idempotencyKey, 'ai-image:job_img_1:attempt:0');

		const retryJob = baseJob({ attempt_count: 1 });
		let retryProviderCalls = 0;
		await withAiImageCredits(retryJob, async () => {
			retryProviderCalls += 1;
			return [{ ok: true }];
		}, gate);
		assert.equal(retryProviderCalls, 1);
		assert.equal(gate.beginCalls[1].idempotencyKey, 'ai-image:job_img_1:attempt:1');
		assert.notEqual(gate.beginCalls[0].idempotencyKey, gate.beginCalls[1].idempotencyKey);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls[1].success, true);
	});

	it('D. same-attempt released reservation cannot bypass a new reserve', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await assert.rejects(
			() => withAiImageCredits(job, async () => {
				throw new Error('provider down');
			}, gate),
		);
		let providerCalls = 0;
		await assert.rejects(
			() => withAiImageCredits(job, async () => {
				providerCalls += 1;
				return [{ ok: true }];
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_INACTIVE',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 1);
	});

	it('E. regenerate → requires a valid reservation on the new job id', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const regenerated = baseJob({ id: 'job_img_regen', attempt_count: 0 });
		let providerCalls = 0;
		await withAiImageCredits(regenerated, async () => {
			providerCalls += 1;
			return [{ ok: true }];
		}, gate);
		assert.equal(providerCalls, 1);
		assert.equal(gate.beginCalls[0].idempotencyKey, 'ai-image:job_img_regen:attempt:0');
		assert.equal(gate.wallets['ws-a'], 0);
	});

	it('F. bulk → each image requires its own reservation', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 2 });
		const jobA = baseJob({ id: 'bulk_1' });
		const jobB = baseJob({ id: 'bulk_2' });
		let providerCalls = 0;
		await withAiImageCredits(jobA, async () => {
			providerCalls += 1;
			return [{ n: 1 }];
		}, gate);
		await withAiImageCredits(jobB, async () => {
			providerCalls += 1;
			return [{ n: 2 }];
		}, gate);
		assert.equal(providerCalls, 2);
		assert.equal(gate.beginCalls.length, 2);
		assert.equal(gate.beginCalls[0].idempotencyKey, 'ai-image:bulk_1:attempt:0');
		assert.equal(gate.beginCalls[1].idempotencyKey, 'ai-image:bulk_2:attempt:0');
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls.filter((s) => s.success).length, 2);
	});

	it('F. bulk stops when the wallet is exhausted', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		await withAiImageCredits(baseJob({ id: 'bulk_ok' }), async () => {
			providerCalls += 1;
			return [{ ok: true }];
		}, gate);
		await assert.rejects(
			() => withAiImageCredits(baseJob({ id: 'bulk_empty' }), async () => {
				providerCalls += 1;
				return [{ ok: true }];
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(providerCalls, 1);
		assert.equal(gate.wallets['ws-a'], 0);
	});

	it('G. missing workspace key never calls begin or provider', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 9 });
		let providerCalls = 0;
		await assert.rejects(
			() => withAiImageCredits({ id: 'job1', owner: 'user_owner' }, async () => {
				providerCalls += 1;
				return [{ ok: true }];
			}, gate),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.wallets['ws-a'], 9);
	});

	it('H. workspace A cannot consume workspace B credits', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0, 'ws-b': 10 });
		let providerCalls = 0;
		await assert.rejects(
			() => withAiImageCredits(baseJob({ workspace_key: 'ws-a' }), async () => {
				providerCalls += 1;
				return [{ ok: true }];
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.wallets['ws-b'], 10);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.ok(gate.beginCalls.every((call) => call.workspaceKey !== 'ws-b'));
	});

	it('H. a workspace B job spends only workspace B', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 5, 'ws-b': 1 });
		await withAiImageCredits(baseJob({ workspace_key: 'ws-b', owner: 'owner-a' }), async () => [{ ok: true }], gate);
		assert.equal(gate.wallets['ws-a'], 5);
		assert.equal(gate.wallets['ws-b'], 0);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-b');
	});

	it('I. duplicate worker on the same attempt cannot double-charge', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		let providerCalls = 0;
		let entered = 0;
		let releaseBarrier;
		const bothEntered = new Promise((resolve) => {
			releaseBarrier = resolve;
		});
		const execute = async () => {
			providerCalls += 1;
			entered += 1;
			if (entered >= 2) releaseBarrier();
			await Promise.race([
				bothEntered,
				new Promise((resolve) => setTimeout(resolve, 50)),
			]);
			return [{ ok: true }];
		};
		const outcomes = await Promise.allSettled([
			withAiImageCredits(job, execute, gate),
			withAiImageCredits(job, execute, gate),
		]);
		const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
		const rejected = outcomes.filter((o) => o.status === 'rejected');
		assert.ok(fulfilled.length >= 1, 'at least one worker must complete');
		assert.ok(
			rejected.every((o) => o.reason?.errorCode === 'CREDIT_RESERVATION_COMMITTED'
				|| o.reason?.errorCode === 'CREDIT_RESERVATION_INACTIVE'),
			'duplicate worker may only lose on an inactive/committed reservation',
		);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.reservationsByKey.size, 1);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
		assert.equal(gate.beginCalls.every((call) => call.idempotencyKey === 'ai-image:job_img_1:attempt:0'), true);
		assert.ok(providerCalls >= 1);
		assert.ok(providerCalls <= 2);
	});

	it('I. committed reservation for the same attempt cannot bypass and call the provider', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await withAiImageCredits(job, async () => [{ ok: true }], gate);
		let providerCalls = 0;
		await assert.rejects(
			() => withAiImageCredits(job, async () => {
				providerCalls += 1;
				return [{ ok: true }];
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_COMMITTED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
	});
});

describe('CR-P0-2 wiring — reservation location and existing success path', () => {
	it('J. claimed processJob reserves immediately before generateImagesWithProvider', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('async function processJob(job)'),
			queueSource.indexOf('function nextRetryDate'),
		);
		assert.match(processFn, /withAiImageCredits\(job,/);
		assert.match(processFn, /generateImagesWithProvider\(/);
		assert.ok(
			processFn.indexOf('withAiImageCredits(job,') < processFn.indexOf('generateImagesWithProvider('),
			'reservation wrapper must start before the provider call',
		);
		assert.match(processFn, /image_mode === 'use_featured'/);
		assert.ok(
			processFn.indexOf("image_mode === 'use_featured'") < processFn.indexOf('withAiImageCredits(job,'),
			'featured-image jobs must exit before reservation',
		);
		assert.doesNotMatch(processFn, /consumeCredits/);
		assert.match(processFn, /uploadGeneratedImage/);
		assert.match(processFn, /recordGenerationHistory/);
		assert.match(processFn, /status: 'completed'/);
		assert.match(processFn, /image_credits_used: 1/);
	});

	it('J. queue claim still happens before processJob and aborts on token mismatch', () => {
		assert.match(queueSource, /claimJobByCas/);
		assert.match(queueSource, /claimImageJob/);
		assert.match(queueSource, /claim_token/);
		assert.match(queueSource, /processJob\(fullJob\)/);
		assert.ok(
			queueSource.indexOf("fullJob.claim_token") < queueSource.indexOf('processJob(fullJob)'),
			'claim token mismatch must abort before processJob',
		);
	});

	it('enqueue, regenerate, and bulk do not reserve credits', () => {
		assert.doesNotMatch(routesSource, /beginFeatureReservation/);
		assert.doesNotMatch(routesSource, /withAiImageCredits/);
		assert.doesNotMatch(routesSource, /consumeCredits/);
		assert.match(routesSource, /router\.post\('\/jobs'/);
		assert.match(routesSource, /router\.post\('\/jobs\/:jobId\/regenerate'/);
		assert.match(routesSource, /createImageJobRecord/);
		assert.match(routesSource, /status: 'queued'/);
	});

	it('helper never falls back to owner/user id for the wallet', () => {
		assert.doesNotMatch(helperSource, /workspaceKeyForUser/);
		assert.doesNotMatch(helperSource, /workspaceKey \|\| userId/);
		assert.doesNotMatch(helperSource, /job\.owner.*workspaceKey/);
		assert.match(helperSource, /Never uses owner \/ user id as the wallet key/);
		assert.match(helperSource, /AI_IMAGE_CREDIT_FEATURE = 'ai_image'/);
		assert.match(helperSource, /AI_IMAGE_CREDIT_UNITS = 1/);
	});

	it('credits-engine ai_image cost remains 1 and is not redefined here', () => {
		assert.match(engineSource, /ai_image:\s*1/);
		assert.doesNotMatch(helperSource, /planCreditCosts/);
		assert.doesNotMatch(queueSource, /planCreditCosts/);
	});
});
