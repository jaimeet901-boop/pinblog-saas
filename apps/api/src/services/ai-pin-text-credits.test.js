/**
 * CR-P0-4 — AI analyze / prompts credit gate.
 * Run: node --test src/services/ai-pin-text-credits.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ANALYZE_CREDIT_FEATURE,
	PROMPT_CREDIT_FEATURE,
	withAnalyzeAndPromptCredits,
	withPinTextFeatureCredits,
} from './ai-pin-text-credits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.join(here, 'ai-pin-text-credits.js'), 'utf8');
const routeSource = readFileSync(path.join(here, '../routes/ai-pins.js'), 'utf8');
const analysisSource = readFileSync(path.join(here, 'ai-pin-analysis.js'), 'utf8');
const engineSource = readFileSync(path.join(here, 'credits-engine.js'), 'utf8');
const studioSource = readFileSync(path.join(here, '../../../web/src/pages/app/ContentStudioPage.jsx'), 'utf8');

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

describe('withPinTextFeatureCredits', () => {
	it('A. 0 credits → analyze provider called 0 times', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let providerCalls = 0;
		await assert.rejects(
			() => withPinTextFeatureCredits({
				workspaceKey: 'ws-a',
				feature: ANALYZE_CREDIT_FEATURE,
				idempotencyKey: 'analyze-0',
			}, async () => {
				providerCalls += 1;
				return { title: 'x', source: 'gemini' };
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
	});

	it('C. successful analyze → reservation + commit', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let reservedBeforeProvider = false;
		const result = await withPinTextFeatureCredits({
			workspaceKey: 'ws-a',
			feature: ANALYZE_CREDIT_FEATURE,
			idempotencyKey: 'analyze-ok',
			actorUserId: 'user_owner',
		}, async (ctx) => {
			reservedBeforeProvider = ctx.reservation?.status === 'reserved';
			assert.equal(gate.wallets['ws-a'], 0);
			assert.equal(gate.beginCalls[0].feature, ANALYZE_CREDIT_FEATURE);
			assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
			return {
				title: 'Pin title',
				seoDescription: 'desc',
				cta: 'Save',
				keywords: ['a'],
				hashtags: ['#a'],
				source: 'gemini',
			};
		}, gate);
		assert.equal(reservedBeforeProvider, true);
		assert.equal(result.title, 'Pin title');
		assert.equal(result.source, 'gemini');
		assert.equal(gate.settleCalls[0].success, true);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
	});

	it('E. provider failure → reservation released', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		await assert.rejects(
			() => withPinTextFeatureCredits({
				workspaceKey: 'ws-a',
				feature: ANALYZE_CREDIT_FEATURE,
				idempotencyKey: 'analyze-fail',
			}, async () => {
				providerCalls += 1;
				throw new Error('openai 500');
			}, gate),
			/openai 500/,
		);
		assert.equal(providerCalls, 1);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.settleCalls[0].success, false);
	});

	it('F. missing workspace key → no provider', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 5 });
		let providerCalls = 0;
		await assert.rejects(
			() => withPinTextFeatureCredits({
				workspaceKey: '',
				feature: ANALYZE_CREDIT_FEATURE,
				actorUserId: 'user_owner',
				idempotencyKey: 'no-ws',
			}, async () => {
				providerCalls += 1;
				return { source: 'gemini' };
			}, gate),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
	});

	it('G. workspace A cannot consume workspace B', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0, 'ws-b': 9 });
		let providerCalls = 0;
		await assert.rejects(
			() => withPinTextFeatureCredits({
				workspaceKey: 'ws-a',
				feature: PROMPT_CREDIT_FEATURE,
				idempotencyKey: 'iso-1',
			}, async () => {
				providerCalls += 1;
				return { source: 'gemini', imagePrompt: 'x' };
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-b'], 9);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
	});

	it('H. retry/new request requires a new reservation', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		await assert.rejects(
			() => withPinTextFeatureCredits({
				workspaceKey: 'ws-a',
				feature: ANALYZE_CREDIT_FEATURE,
				idempotencyKey: 'analyze-attempt-0',
			}, async () => {
				throw new Error('timeout');
			}, gate),
		);
		assert.equal(gate.wallets['ws-a'], 1);
		await withPinTextFeatureCredits({
			workspaceKey: 'ws-a',
			feature: ANALYZE_CREDIT_FEATURE,
			idempotencyKey: 'analyze-attempt-1',
		}, async () => ({ source: 'gemini', title: 'ok' }), gate);
		assert.notEqual(gate.beginCalls[0].idempotencyKey, gate.beginCalls[1].idempotencyKey);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls[1].success, true);
	});

	it('I. heuristic/template-only result → no charge', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const heuristic = await withPinTextFeatureCredits({
			workspaceKey: 'ws-a',
			feature: ANALYZE_CREDIT_FEATURE,
			idempotencyKey: 'analyze-heur',
		}, async () => ({ title: 'local', source: 'heuristic' }), gate);
		assert.equal(heuristic.source, 'heuristic');
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.settleCalls[0].success, false);

		const templated = await withPinTextFeatureCredits({
			workspaceKey: 'ws-a',
			feature: PROMPT_CREDIT_FEATURE,
			idempotencyKey: 'prompt-tmpl',
		}, async () => ({ imagePrompt: 'base', source: 'template' }), gate);
		assert.equal(templated.source, 'template');
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.settleCalls[1].success, false);
	});
});

describe('withAnalyzeAndPromptCredits', () => {
	it('B. 0 credits → prompts provider called 0 times', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let analyzeCalls = 0;
		let promptCalls = 0;
		await assert.rejects(
			() => withAnalyzeAndPromptCredits({
				analysisProvided: true,
				workspaceKey: 'ws-a',
				promptIdempotencyKey: 'prompt-0',
				runPrompt: async () => {
					promptCalls += 1;
					return { imagePrompt: 'x', source: 'gemini' };
				},
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(analyzeCalls, 0);
		assert.equal(promptCalls, 0);
	});

	it('D. successful prompts → ai_prompt reservation + commit', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const out = await withAnalyzeAndPromptCredits({
			analysisProvided: true,
			workspaceKey: 'ws-a',
			promptIdempotencyKey: 'prompt-ok',
			runPrompt: async () => {
				assert.equal(gate.beginCalls[0].feature, PROMPT_CREDIT_FEATURE);
				assert.equal(gate.wallets['ws-a'], 0);
				return { imagePrompt: 'premium pin', style: 'food', source: 'openai' };
			},
		}, gate);
		assert.equal(out.promptResult.imagePrompt, 'premium pin');
		assert.equal(gate.settleCalls[0].success, true);
		assert.equal(gate.beginCalls.length, 1);
	});

	it('J. prompts without analysis reserves both features before any provider', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 2 });
		let analyzeCalls = 0;
		let promptCalls = 0;
		const out = await withAnalyzeAndPromptCredits({
			analysisProvided: false,
			workspaceKey: 'ws-a',
			analyzeIdempotencyKey: 'combo-analyze',
			promptIdempotencyKey: 'combo-prompt',
			runAnalyze: async () => {
				analyzeCalls += 1;
				assert.equal(gate.beginCalls.length, 2, 'both reservations exist before analyze provider');
				assert.deepEqual(gate.beginCalls.map((c) => c.feature), [ANALYZE_CREDIT_FEATURE, PROMPT_CREDIT_FEATURE]);
				return { title: 'A', source: 'gemini' };
			},
			runPrompt: async (analysis) => {
				promptCalls += 1;
				assert.equal(analysis.title, 'A');
				return { imagePrompt: 'img', source: 'gemini' };
			},
		}, gate);
		assert.equal(analyzeCalls, 1);
		assert.equal(promptCalls, 1);
		assert.equal(out.resolvedAnalysis.source, 'gemini');
		assert.equal(out.promptResult.source, 'gemini');
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls.filter((s) => s.success).length, 2);
	});

	it('J. 1 credit cannot start analyze+prompt providers (no accidental half-charge)', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let analyzeCalls = 0;
		let promptCalls = 0;
		await assert.rejects(
			() => withAnalyzeAndPromptCredits({
				analysisProvided: false,
				workspaceKey: 'ws-a',
				analyzeIdempotencyKey: 'half-analyze',
				promptIdempotencyKey: 'half-prompt',
				runAnalyze: async () => {
					analyzeCalls += 1;
					return { source: 'gemini' };
				},
				runPrompt: async () => {
					promptCalls += 1;
					return { source: 'gemini' };
				},
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(analyzeCalls, 0);
		assert.equal(promptCalls, 0);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.beginCalls[0].feature, ANALYZE_CREDIT_FEATURE);
		assert.equal(gate.beginCalls[1].feature, PROMPT_CREDIT_FEATURE);
	});

	it('J. provided analysis does not re-reserve ai_analyze', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let analyzeCalls = 0;
		await withAnalyzeAndPromptCredits({
			analysisProvided: true,
			workspaceKey: 'ws-a',
			promptIdempotencyKey: 'provided-prompt',
			runAnalyze: async () => {
				analyzeCalls += 1;
				return { source: 'gemini' };
			},
			runPrompt: async () => ({ imagePrompt: 'x', source: 'gemini' }),
		}, gate);
		assert.equal(analyzeCalls, 0);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.beginCalls[0].feature, PROMPT_CREDIT_FEATURE);
		assert.equal(gate.wallets['ws-a'], 0);
	});
});

describe('CR-P0-4 wiring', () => {
	it('K. analyze response shape remains { analysis, credits }', () => {
		const handler = routeSource.slice(
			routeSource.indexOf("router.post('/analyze'"),
			routeSource.indexOf("router.post('/prompts'"),
		);
		assert.match(handler, /withPinTextFeatureCredits/);
		assert.match(handler, /analyzeArticleForPin/);
		assert.ok(handler.indexOf('withPinTextFeatureCredits') < handler.indexOf('analyzeArticleForPin('));
		assert.match(handler, /res\.json\(\{ analysis: mapUserHistoryAnalysis\(analysis\), credits \}\)/);
		assert.doesNotMatch(handler, /consumeBillableAiFeature/);
	});

	it('L. prompts response shape remains prompt fields + analysis + credits', () => {
		const handler = routeSource.slice(routeSource.indexOf("router.post('/prompts'"));
		assert.match(handler, /withAnalyzeAndPromptCredits/);
		assert.match(handler, /generateImagePromptForPin/);
		assert.ok(handler.indexOf('withAnalyzeAndPromptCredits') < handler.indexOf('generateImagePromptForPin('));
		assert.match(handler, /\.\.\.stripUserUnsafeAiMetadata\(promptResult \|\| \{\}\)/);
		assert.match(handler, /analysis: mapUserHistoryAnalysis\(resolvedAnalysis\)/);
		assert.match(handler, /credits,/);
		assert.doesNotMatch(handler, /consumeBillableAiFeature/);
	});

	it('does not change catalog costs or use owner/user-id wallet fallback', () => {
		assert.match(engineSource, /ai_analyze:\s*1/);
		assert.match(engineSource, /ai_prompt:\s*1/);
		assert.doesNotMatch(helperSource, /workspaceKeyForUser/);
		assert.doesNotMatch(helperSource, /PLAN_CREDITS/);
		assert.match(helperSource, /Never owner\/user id/);
		assert.match(analysisSource, /generateTextWithRegistry/);
		assert.match(studioSource, /\/ai-pins\/analyze/);
		assert.match(studioSource, /\/ai-pins\/prompts/);
	});
});
