/**
 * CR-P0-3 — integrated-ai/stream credit gate.
 * Run: node --test src/services/integrated-ai-stream-credits.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PIN_COPY_CREDIT_FEATURE,
	STREAM_CREDIT_FEATURES,
	WRITER_CREDIT_FEATURE,
	resolveIntegratedAiStreamCreditIntent,
	withIntegratedAiStreamCredits,
} from './integrated-ai-stream-credits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.join(here, 'integrated-ai-stream-credits.js'), 'utf8');
const routeSource = readFileSync(path.join(here, '../routes/integrated-ai.js'), 'utf8');
const engineSource = readFileSync(path.join(here, 'credits-engine.js'), 'utf8');
const writerPage = readFileSync(path.join(here, '../../../web/src/pages/app/WriterPage.jsx'), 'utf8');
const writerSections = readFileSync(path.join(here, '../../../web/src/components/writer/WriterSectionBlocks.jsx'), 'utf8');
const pinCopy = readFileSync(path.join(here, '../../../web/src/lib/aiPinsPinCopy.js'), 'utf8');
const aiGenerate = readFileSync(path.join(here, '../../../web/src/lib/aiGenerate.js'), 'utf8');
const chatHook = readFileSync(path.join(here, '../../../web/src/hooks/use-integrated-ai.jsx'), 'utf8');

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
			beginCalls.push({ workspaceKey: key, feature, units, idempotencyKey });
			if (!key) {
				throw httpError(422, 'workspaceKey is required', 'VALIDATION_ERROR');
			}
			if (idempotencyKey && reservationsByKey.has(idempotencyKey)) {
				return { ...reservationsByKey.get(idempotencyKey) };
			}
			const amount = feature === WRITER_CREDIT_FEATURE ? 2 : 1;
			const balance = Number(wallets[key] || 0);
			if (balance < amount) {
				const error = httpError(402, `Insufficient credits. Remaining: ${balance}`, 'INSUFFICIENT_CREDITS');
				error.remaining = balance;
				throw error;
			}
			wallets[key] = balance - amount;
			const row = {
				id: `res_${++seq}`,
				workspaceKey: key,
				status: 'reserved',
				amount,
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
			wallets[row.workspaceKey] = (Number(wallets[row.workspaceKey]) || 0) + (Number(row.amount) || 0);
			return { settled: 'released', reservation: { ...row } };
		}),
	};
}

describe('resolveIntegratedAiStreamCreditIntent', () => {
	it('A/L. missing creditFeature without singleShot fails closed', () => {
		assert.throws(
			() => resolveIntegratedAiStreamCreditIntent({}),
			(error) => error.status === 422 && error.errorCode === 'CREDIT_FEATURE_REQUIRED',
		);
		assert.throws(
			() => resolveIntegratedAiStreamCreditIntent({
				singleShot: false,
				writerContinuation: false,
				creditFeature: '',
			}),
			(error) => error.errorCode === 'CREDIT_FEATURE_REQUIRED',
		);
	});

	it('B. unknown creditFeature fails closed and is not defaulted to cost 1', () => {
		assert.throws(
			() => resolveIntegratedAiStreamCreditIntent({ creditFeature: 'not_a_feature' }),
			(error) => error.status === 422 && error.errorCode === 'CREDIT_FEATURE_UNKNOWN',
		);
		assert.throws(
			() => resolveIntegratedAiStreamCreditIntent({
				singleShot: true,
				creditFeature: 'ai_image',
			}),
			(error) => error.errorCode === 'CREDIT_FEATURE_UNKNOWN',
		);
		assert.throws(
			() => resolveIntegratedAiStreamCreditIntent({ creditFeature: 'ai_analyze' }),
			(error) => error.errorCode === 'CREDIT_FEATURE_UNKNOWN',
		);
	});

	it('J. Writer singleShot infers ai_writer', () => {
		assert.deepEqual(
			resolveIntegratedAiStreamCreditIntent({ singleShot: true }),
			{ mode: 'billable', creditFeature: WRITER_CREDIT_FEATURE },
		);
		assert.deepEqual(
			resolveIntegratedAiStreamCreditIntent({ singleShot: '1', writerContinuation: false }),
			{ mode: 'billable', creditFeature: WRITER_CREDIT_FEATURE },
		);
	});

	it('K. explicit ai_pin_copy is billable', () => {
		assert.deepEqual(
			resolveIntegratedAiStreamCreditIntent({ creditFeature: 'ai_pin_copy' }),
			{ mode: 'billable', creditFeature: PIN_COPY_CREDIT_FEATURE },
		);
	});

	it('Writer length continuation is the only free stream mode', () => {
		assert.deepEqual(
			resolveIntegratedAiStreamCreditIntent({
				singleShot: true,
				writerContinuation: true,
			}),
			{ mode: 'writer_continuation', creditFeature: WRITER_CREDIT_FEATURE },
		);
		assert.throws(
			() => resolveIntegratedAiStreamCreditIntent({ writerContinuation: true }),
			(error) => error.errorCode === 'CREDIT_FEATURE_REQUIRED',
		);
	});
});

describe('withIntegratedAiStreamCredits', () => {
	it('A. missing creditFeature → provider called 0 times', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 10 });
		let providerCalls = 0;
		await assert.rejects(
			() => withIntegratedAiStreamCredits({
				workspaceKey: 'ws-a',
				idempotencyKey: 'miss-1',
			}, async () => {
				providerCalls += 1;
				return 'ok';
			}, gate),
			(error) => error.errorCode === 'CREDIT_FEATURE_REQUIRED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
	});

	it('B. unknown creditFeature → provider called 0 times', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 10 });
		let providerCalls = 0;
		await assert.rejects(
			() => withIntegratedAiStreamCredits({
				workspaceKey: 'ws-a',
				creditFeature: 'mystery',
				singleShot: true,
				idempotencyKey: 'unk-1',
			}, async () => {
				providerCalls += 1;
				return 'ok';
			}, gate),
			(error) => error.errorCode === 'CREDIT_FEATURE_UNKNOWN',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.wallets['ws-a'], 10);
	});

	it('C. missing workspace key → provider called 0 times', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 10 });
		let providerCalls = 0;
		await assert.rejects(
			() => withIntegratedAiStreamCredits({
				singleShot: true,
				workspaceKey: '',
				actorUserId: 'user_owner',
				idempotencyKey: 'ws-miss',
			}, async () => {
				providerCalls += 1;
				return 'ok';
			}, gate),
			(error) => error.status === 422 && error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
	});

	it('D. 0 credits → provider called 0 times', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let providerCalls = 0;
		await assert.rejects(
			() => withIntegratedAiStreamCredits({
				singleShot: true,
				workspaceKey: 'ws-a',
				idempotencyKey: 'zero-1',
			}, async () => {
				providerCalls += 1;
				return 'ok';
			}, gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
	});

	it('E. ai_writer → reservation before provider, commit on success', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 4 });
		let reservedBeforeProvider = false;
		const result = await withIntegratedAiStreamCredits({
			singleShot: true,
			workspaceKey: 'ws-a',
			idempotencyKey: 'writer-1',
			actorUserId: 'user_owner',
		}, async (ctx) => {
			reservedBeforeProvider = ctx.reservation?.status === 'reserved';
			assert.equal(ctx.intent.creditFeature, WRITER_CREDIT_FEATURE);
			assert.equal(gate.beginCalls[0].feature, WRITER_CREDIT_FEATURE);
			assert.equal(gate.wallets['ws-a'], 2);
			return { text: 'article' };
		}, gate);
		assert.equal(result.text, 'article');
		assert.equal(reservedBeforeProvider, true);
		assert.equal(gate.settleCalls[0].success, true);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
		assert.equal(gate.wallets['ws-a'], 2);
	});

	it('F. ai_pin_copy → reservation before provider, commit on success', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		await withIntegratedAiStreamCredits({
			creditFeature: PIN_COPY_CREDIT_FEATURE,
			workspaceKey: 'ws-a',
			idempotencyKey: 'copy-1',
		}, async (ctx) => {
			assert.equal(ctx.intent.creditFeature, PIN_COPY_CREDIT_FEATURE);
			assert.equal(gate.beginCalls[0].feature, PIN_COPY_CREDIT_FEATURE);
			assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
			return { text: 'pins' };
		}, gate);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls[0].success, true);
	});

	it('G. provider failure → reservation released', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 2 });
		let providerCalls = 0;
		await assert.rejects(
			() => withIntegratedAiStreamCredits({
				singleShot: true,
				workspaceKey: 'ws-a',
				idempotencyKey: 'fail-1',
			}, async () => {
				providerCalls += 1;
				throw new Error('gemini 500');
			}, gate),
			/gemini 500/,
		);
		assert.equal(providerCalls, 1);
		assert.equal(gate.wallets['ws-a'], 2);
		assert.equal(gate.settleCalls[0].success, false);
		assert.equal([...gate.reservationsById.values()][0].status, 'released');
	});

	it('H. retry/new request → valid new reservation', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 4 });
		await assert.rejects(
			() => withIntegratedAiStreamCredits({
				singleShot: true,
				workspaceKey: 'ws-a',
				idempotencyKey: 'writer-attempt-0',
			}, async () => {
				throw new Error('timeout');
			}, gate),
		);
		assert.equal(gate.wallets['ws-a'], 4);
		await withIntegratedAiStreamCredits({
			singleShot: true,
			workspaceKey: 'ws-a',
			idempotencyKey: 'writer-attempt-1',
		}, async () => ({ ok: true }), gate);
		assert.equal(gate.beginCalls.length, 2);
		assert.notEqual(gate.beginCalls[0].idempotencyKey, gate.beginCalls[1].idempotencyKey);
		assert.equal(gate.wallets['ws-a'], 2);
		assert.equal(gate.settleCalls[1].success, true);
	});

	it('I. concurrent duplicate attempt cannot double-charge', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 2 });
		const input = {
			singleShot: true,
			workspaceKey: 'ws-a',
			idempotencyKey: 'dup-stream-1',
		};
		let providerCalls = 0;
		const outcomes = await Promise.allSettled([
			withIntegratedAiStreamCredits(input, async () => {
				providerCalls += 1;
				return { ok: true };
			}, gate),
			withIntegratedAiStreamCredits(input, async () => {
				providerCalls += 1;
				return { ok: true };
			}, gate),
		]);
		const rejected = outcomes.filter((o) => o.status === 'rejected');
		assert.ok(outcomes.some((o) => o.status === 'fulfilled'));
		assert.ok(
			rejected.every((o) => o.reason?.errorCode === 'CREDIT_RESERVATION_COMMITTED'
				|| o.reason?.errorCode === 'CREDIT_RESERVATION_INACTIVE'),
		);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.reservationsByKey.size, 1);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
		assert.ok(providerCalls >= 1);
	});

	it('workspace A cannot spend workspace B credits', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0, 'ws-b': 10 });
		let providerCalls = 0;
		await assert.rejects(
			() => withIntegratedAiStreamCredits({
				singleShot: true,
				workspaceKey: 'ws-a',
				idempotencyKey: 'iso-1',
			}, async () => {
				providerCalls += 1;
				return { ok: true };
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-b'], 10);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
	});

	it('Writer continuation does not reserve and still runs provider work', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 10 });
		let providerCalls = 0;
		const result = await withIntegratedAiStreamCredits({
			singleShot: true,
			writerContinuation: true,
			workspaceKey: 'ws-a',
			idempotencyKey: 'cont-1',
		}, async (ctx) => {
			providerCalls += 1;
			assert.equal(ctx.intent.mode, 'writer_continuation');
			assert.equal(ctx.reservation, null);
			return { text: 'more words' };
		}, gate);
		assert.equal(result.text, 'more words');
		assert.equal(providerCalls, 1);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.wallets['ws-a'], 10);
	});
});

describe('CR-P0-3 wiring', () => {
	it('J. existing Writer callers still send singleShot', () => {
		assert.match(writerPage, /singleShot:\s*true/);
		assert.match(writerSections, /singleShot:\s*true/);
		assert.match(aiGenerate, /writerContinuation:\s*true/);
		assert.match(aiGenerate, /creditFeature:\s*undefined/);
	});

	it('K. existing AI Pin Copy caller still sends creditFeature=ai_pin_copy', () => {
		assert.match(pinCopy, /creditFeature:\s*'ai_pin_copy'/);
	});

	it('L. route fail-closes before stream() when feature is missing', () => {
		const handler = routeSource.slice(routeSource.indexOf("router.post('/stream'"));
		assert.match(handler, /resolveIntegratedAiStreamCreditIntent/);
		assert.match(handler, /reserveIntegratedAiStreamCredits/);
		assert.ok(
			handler.indexOf('resolveIntegratedAiStreamCreditIntent') < handler.indexOf('await stream('),
			'credit intent must be resolved before stream()',
		);
		assert.ok(
			handler.indexOf('reserveIntegratedAiStreamCredits') < handler.indexOf('await stream('),
			'reservation must start before stream()',
		);
		assert.doesNotMatch(handler, /beginFeatureReservation/);
		assert.doesNotMatch(handler, /workspaceKeyForUser/);
		assert.doesNotMatch(handler, /req\.workspaceKey \|\| req\.pocketbaseUserId/);
	});

	it('does not default unknown stream features to cost 1', () => {
		assert.match(engineSource, /if \(!key\) return 1;/);
		assert.match(helperSource, /CREDIT_FEATURE_UNKNOWN/);
		assert.match(helperSource, /Never fall back to owner\/user id/);
		assert.deepEqual([...STREAM_CREDIT_FEATURES], ['ai_writer', 'ai_pin_copy']);
		assert.match(engineSource, /ai_writer:\s*2/);
		assert.match(engineSource, /ai_pin_copy:\s*1/);
		assert.doesNotMatch(helperSource, /planCreditCosts/);
	});

	it('unrouted chat hook still omits creditFeature (backend fail-closed covers it)', () => {
		assert.match(chatHook, /integratedAiClient\.stream\('\/integrated-ai\/stream'/);
		assert.doesNotMatch(chatHook, /creditFeature/);
		assert.doesNotMatch(chatHook, /singleShot/);
	});
});
