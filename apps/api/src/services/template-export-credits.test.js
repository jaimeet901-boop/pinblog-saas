/**
 * CR-P1-4 — template export worker credit gate.
 * Reservation happens in the claimed native worker before actual encode.
 * Run: node --test src/services/template-export-credits.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	TEMPLATE_EXPORT_CREDIT_FEATURE,
	TEMPLATE_EXPORT_CREDIT_UNITS,
	templateExportCreditIdempotencyKey,
	readTemplateExportWorkspaceKey,
	requireTemplateExportWorkspaceKey,
	withTemplateExportCredits,
	NATIVE_TEMPLATE_PIXEL_EXPORT_IMPLEMENTED,
	processClaimedTemplateExportJob,
} from './template-export-credits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.join(here, 'template-export-credits.js'), 'utf8');
const exportSource = readFileSync(path.join(here, 'template-export.js'), 'utf8');
const controlsSource = readFileSync(path.join(here, 'queue/controls.js'), 'utf8');
const engineSource = readFileSync(path.join(here, 'queue/engine.js'), 'utf8');
const typesSource = readFileSync(path.join(here, 'queue/types.js'), 'utf8');
const ownershipSource = readFileSync(path.join(here, 'queue/ownership.js'), 'utf8');
const creditsEngineSource = readFileSync(path.join(here, 'credits-engine.js'), 'utf8');

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
		id: 'job_export_1',
		owner: 'user_owner',
		workspace: 'ws_record_a',
		workspace_key: 'ws-a',
		type: 'export',
		attempt_count: 0,
		payload: { kind: 'template_pixel_export' },
		meta: { module: 'template_export' },
		...overrides,
	};
}

describe('templateExportCreditIdempotencyKey', () => {
	it('is unique per job and attempt so retries cannot reuse a reservation', () => {
		assert.equal(
			templateExportCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			'template-export:job1:attempt:0',
		);
		assert.equal(
			templateExportCreditIdempotencyKey({ id: 'job1', attempt_count: 1 }),
			'template-export:job1:attempt:1',
		);
		assert.notEqual(
			templateExportCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			templateExportCreditIdempotencyKey({ id: 'job2', attempt_count: 0 }),
		);
	});
});

describe('requireTemplateExportWorkspaceKey', () => {
	it('D. missing workspace key fails closed even when owner is present', async () => {
		await assert.rejects(
			() => requireTemplateExportWorkspaceKey({ id: 'job1', owner: 'user_owner', workspace: '' }),
			(error) => error.status === 422 && error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('does not use owner as the wallet key', async () => {
		assert.equal(readTemplateExportWorkspaceKey({ owner: 'user_owner', workspace_key: '' }), '');
		await assert.rejects(
			() => requireTemplateExportWorkspaceKey({ id: 'job1', owner: 'user_owner' }),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('accepts explicit workspace_key and expanded workspace.workspace_key', async () => {
		assert.equal(await requireTemplateExportWorkspaceKey({ workspace_key: 'ws-a' }), 'ws-a');
		assert.equal(await requireTemplateExportWorkspaceKey({
			workspace: { id: 'ws_record_a', workspace_key: 'ws-from-expand' },
		}), 'ws-from-expand');
	});

	it('resolves workspace.workspace_key and never owner from the workspace record', async () => {
		const key = await requireTemplateExportWorkspaceKey(
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
			() => requireTemplateExportWorkspaceKey(
				{ workspace: 'ws_record_a', owner: 'user_owner' },
				{ getWorkspace: async () => ({ id: 'ws_record_a', owner: 'user_owner' }) },
			),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});
});

describe('withTemplateExportCredits', () => {
	it('A. 0 credits → 0 actual export operations', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let encodeCalls = 0;
		await assert.rejects(
			() => withTemplateExportCredits(baseJob(), async () => {
				encodeCalls += 1;
				return { format: 'png', ok: true };
			}, gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
		assert.equal(encodeCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls.length, 0);
	});

	it('B. 1 credit → reservation + actual export + commit', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let encodeCalls = 0;
		const result = await withTemplateExportCredits(baseJob(), async () => {
			encodeCalls += 1;
			assert.equal(gate.wallets['ws-a'], 0, 'reservation holds the credit before encode');
			return { format: 'png', ok: true, status: 'completed' };
		}, gate);
		assert.equal(encodeCalls, 1);
		assert.equal(result.format, 'png');
		assert.equal(result.status, 'completed');
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.beginCalls[0].feature, TEMPLATE_EXPORT_CREDIT_FEATURE);
		assert.equal(gate.beginCalls[0].units, TEMPLATE_EXPORT_CREDIT_UNITS);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, true);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
	});

	it('C. export failure → reservation released', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let encodeCalls = 0;
		await assert.rejects(
			() => withTemplateExportCredits(baseJob(), async () => {
				encodeCalls += 1;
				throw new Error('encode failed');
			}, gate),
			/encode failed/,
		);
		assert.equal(encodeCalls, 1);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, false);
		assert.equal([...gate.reservationsById.values()][0].status, 'released');
	});

	it('D. missing workspace key → no reservation and no export', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 9 });
		let encodeCalls = 0;
		await assert.rejects(
			() => withTemplateExportCredits({ id: 'job1', owner: 'user_owner' }, async () => {
				encodeCalls += 1;
				return { ok: true };
			}, gate),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
		assert.equal(encodeCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.wallets['ws-a'], 9);
	});

	it('E. workspace A cannot spend workspace B', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0, 'ws-b': 10 });
		let encodeCalls = 0;
		await assert.rejects(
			() => withTemplateExportCredits(baseJob({ workspace_key: 'ws-a' }), async () => {
				encodeCalls += 1;
				return { ok: true };
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(encodeCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.wallets['ws-b'], 10);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.ok(gate.beginCalls.every((call) => call.workspaceKey !== 'ws-b'));
	});

	it('E. a workspace B job spends only workspace B', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 5, 'ws-b': 1 });
		await withTemplateExportCredits(
			baseJob({ workspace_key: 'ws-b', owner: 'owner-a' }),
			async () => ({ ok: true }),
			gate,
		);
		assert.equal(gate.wallets['ws-a'], 5);
		assert.equal(gate.wallets['ws-b'], 0);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-b');
	});

	it('F. retry uses a new reservation key', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		await assert.rejects(
			() => withTemplateExportCredits(baseJob({ attempt_count: 0 }), async () => {
				throw new Error('encode timeout');
			}, gate),
			/encode timeout/,
		);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.beginCalls[0].idempotencyKey, 'template-export:job_export_1:attempt:0');

		let retryEncodeCalls = 0;
		await withTemplateExportCredits(baseJob({ attempt_count: 1 }), async () => {
			retryEncodeCalls += 1;
			return { ok: true };
		}, gate);
		assert.equal(retryEncodeCalls, 1);
		assert.equal(gate.beginCalls[1].idempotencyKey, 'template-export:job_export_1:attempt:1');
		assert.notEqual(gate.beginCalls[0].idempotencyKey, gate.beginCalls[1].idempotencyKey);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls[1].success, true);
	});

	it('G. released reservation for the same attempt cannot encode again', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await assert.rejects(
			() => withTemplateExportCredits(job, async () => {
				throw new Error('encode down');
			}, gate),
		);
		let encodeCalls = 0;
		await assert.rejects(
			() => withTemplateExportCredits(job, async () => {
				encodeCalls += 1;
				return { ok: true };
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_INACTIVE',
		);
		assert.equal(encodeCalls, 0);
		assert.equal(gate.wallets['ws-a'], 1);
	});

	it('G. committed reservation for the same attempt cannot encode again', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await withTemplateExportCredits(job, async () => ({ ok: true }), gate);
		let encodeCalls = 0;
		await assert.rejects(
			() => withTemplateExportCredits(job, async () => {
				encodeCalls += 1;
				return { ok: true };
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_COMMITTED',
		);
		assert.equal(encodeCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
	});

	it('insufficient credits errors are not swallowed', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		await assert.rejects(
			() => withTemplateExportCredits(baseJob(), async () => ({ ok: true }), gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
	});
});

describe('processClaimedTemplateExportJob', () => {
	it('K. NOT_IMPLEMENTED export must not charge credits', async () => {
		assert.equal(NATIVE_TEMPLATE_PIXEL_EXPORT_IMPLEMENTED, false);
		const gate = createMemoryCreditGate({ 'ws-a': 5 });
		await assert.rejects(
			() => processClaimedTemplateExportJob(baseJob(), {
				...gate,
				encodeTemplateExport: undefined,
			}),
			(error) => error.errorCode === 'NOT_IMPLEMENTED',
		);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.wallets['ws-a'], 5);
	});

	it('K. NOT_IMPLEMENTED is thrown before reservation even with credits', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		await assert.rejects(
			() => processClaimedTemplateExportJob(baseJob(), gate),
			(error) => error.errorCode === 'NOT_IMPLEMENTED'
				&& /NOT_IMPLEMENTED: export worker is not configured/.test(error.message),
		);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.settleCalls.length, 0);
	});

	it('B. injected encoder reserves immediately before encode then commits', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let encodeCalls = 0;
		const result = await processClaimedTemplateExportJob(baseJob(), {
			...gate,
			encodeTemplateExport: async () => {
				encodeCalls += 1;
				assert.equal(gate.wallets['ws-a'], 0, 'credit is reserved before encode');
				return { format: 'png', ok: true };
			},
		});
		assert.equal(encodeCalls, 1);
		assert.equal(result.format, 'png');
		assert.equal(gate.settleCalls[0].success, true);
	});

	it('A. injected encoder with 0 credits never encodes', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let encodeCalls = 0;
		await assert.rejects(
			() => processClaimedTemplateExportJob(baseJob(), {
				...gate,
				encodeTemplateExport: async () => {
					encodeCalls += 1;
					return { ok: true };
				},
			}),
			(error) => error.status === 402,
		);
		assert.equal(encodeCalls, 0);
	});
});

describe('CR-P1-4 wiring — reservation location and enqueue shape', () => {
	it('H. enqueue response shape is unchanged', () => {
		const enqueueFn = exportSource.slice(
			exportSource.indexOf('export async function enqueueTemplateExportJob'),
			exportSource.indexOf('export async function planTemplateExportBatch'),
		);
		assert.match(enqueueFn, /ok: true/);
		assert.match(enqueueFn, /job: \{/);
		assert.match(enqueueFn, /id: job\.id/);
		assert.match(enqueueFn, /type: job\.type/);
		assert.match(enqueueFn, /status: job\.status/);
		assert.match(enqueueFn, /plan: planned\.plan/);
		assert.match(enqueueFn, /note: 'Queued for background worker/);
	});

	it('I. enqueue itself does NOT consume credits', () => {
		const enqueueFn = exportSource.slice(
			exportSource.indexOf('export async function enqueueTemplateExportJob'),
			exportSource.indexOf('export async function planTemplateExportBatch'),
		);
		assert.doesNotMatch(enqueueFn, /consumeFeatureCredits/);
		assert.doesNotMatch(enqueueFn, /beginFeatureReservation/);
		assert.doesNotMatch(enqueueFn, /withTemplateExportCredits/);
		assert.doesNotMatch(enqueueFn, /\.catch\(\(\) => null\)/);
		assert.doesNotMatch(exportSource, /consumeFeatureCredits/);
	});

	it('reservation wraps the actual encode, not enqueue', () => {
		const claimedFn = helperSource.slice(
			helperSource.indexOf('export async function processClaimedTemplateExportJob'),
		);
		assert.match(claimedFn, /withTemplateExportCredits\(job,/);
		assert.match(claimedFn, /executeTemplatePixelExport\(job, deps\)/);
		assert.ok(
			claimedFn.indexOf('encodeTemplateExport')
				< claimedFn.indexOf('withTemplateExportCredits(job,'),
			'NOT_IMPLEMENTED / missing encoder must exit before reservation',
		);
		assert.ok(
			claimedFn.indexOf('withTemplateExportCredits(job,')
				< claimedFn.indexOf('executeTemplatePixelExport(job, deps)'),
			'reservation wrapper must start before the actual encode',
		);
	});

	it('H. native worker still completes with existing output/status path', () => {
		const processFn = controlsSource.slice(
			controlsSource.indexOf('export async function processNativeJob'),
			controlsSource.indexOf('export async function recoverStuckRunningJobs'),
		);
		const exportCase = processFn.slice(processFn.indexOf("case 'export'"));
		assert.match(exportCase, /processClaimedTemplateExportJob\(job,/);
		assert.match(exportCase, /completeNativeJob\(job, result\)/);
		assert.match(exportCase, /updateQueueJob\(job\.id, \{ progress: 90, outputs: result \}\)/);
		assert.ok(
			exportCase.indexOf('processClaimedTemplateExportJob(job,')
				< exportCase.indexOf('completeNativeJob(job, result)'),
		);
	});

	it('J. scheduled/background native engine claims export then processes it', () => {
		assert.match(typesSource, /'export'/);
		assert.match(typesSource, /'template_rendering'/);
		assert.match(ownershipSource, /'export'/);
		assert.match(ownershipSource, /'template_rendering'/);
		assert.match(engineSource, /'export'/);
		assert.match(engineSource, /'template_rendering'/);
		assert.match(engineSource, /claimNativeJob\(candidate\.id, WORKER_ID\)/);
		assert.match(engineSource, /processNativeJob\(claimed\)/);
		assert.ok(
			engineSource.indexOf('claimNativeJob(candidate.id, WORKER_ID)')
				< engineSource.indexOf('processNativeJob(claimed)'),
			'claim must happen before processNativeJob',
		);
		const tickFn = engineSource.slice(
			engineSource.indexOf('async function tick()'),
		);
		assert.match(tickFn, /loadClaimableNativeJobs/);
		assert.match(tickFn, /processNativeJob\(claimed\)/);
		assert.doesNotMatch(tickFn, /processClaimedTemplateExportJob/);
	});

	it('native processNativeJob still resolves trusted ownership before export work', () => {
		const processFn = controlsSource.slice(
			controlsSource.indexOf('export async function processNativeJob'),
			controlsSource.indexOf('export async function recoverStuckRunningJobs'),
		);
		assert.match(processFn, /resolveTrustedNativeJobOwnership/);
		assert.ok(
			processFn.indexOf('const trusted = await resolveTrustedNativeJobOwnership(job)')
				< processFn.indexOf("case 'export'"),
		);
		assert.ok(
			processFn.indexOf("case 'export'")
				< processFn.indexOf('processClaimedTemplateExportJob(job,'),
		);
		assert.match(processFn, /NOT_IMPLEMENTED: \$\{job\.type\} worker is not configured/);
	});

	it('helper never falls back to owner/user id for the wallet', () => {
		assert.doesNotMatch(helperSource, /workspaceKeyForUser/);
		assert.doesNotMatch(helperSource, /workspaceKey \|\| userId/);
		assert.doesNotMatch(helperSource, /consumeFeatureCredits/);
		assert.match(helperSource, /Never uses owner \/ user id as the wallet key/);
		assert.match(helperSource, /TEMPLATE_EXPORT_CREDIT_FEATURE = 'template_export'/);
		assert.match(helperSource, /TEMPLATE_EXPORT_CREDIT_UNITS = 1/);
	});

	it('credits-engine template_export cost remains 1 and is not redefined here', () => {
		assert.match(creditsEngineSource, /template_export:\s*1/);
		assert.doesNotMatch(helperSource, /planCreditCosts/);
		assert.doesNotMatch(exportSource, /planCreditCosts/);
		assert.doesNotMatch(helperSource, /DEFAULT_CREDIT_COSTS/);
		assert.doesNotMatch(exportSource, /DEFAULT_CREDIT_COSTS/);
	});

	it('credit errors are not swallowed on the export path', () => {
		assert.doesNotMatch(helperSource, /consumeFeatureCredits/);
		assert.doesNotMatch(exportSource, /consumeFeatureCredits/);
		assert.doesNotMatch(exportSource, /beginFeatureReservation[\s\S]*\.catch\(\(\) => null\)/);
		assert.match(helperSource, /await settle\(reservationId, \{[\s\S]*success: false[\s\S]*\}\)\.catch\(\(\) => null\)/);
		assert.match(helperSource, /throw error;/);
	});
});
