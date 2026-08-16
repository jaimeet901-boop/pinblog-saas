/**
 * CR-P1-1 — Pinterest publish worker credit gate.
 * Reservation happens in the claimed worker before any Pinterest API call.
 * Run: node --test src/services/pinterest-publish-credits.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PIN_PUBLISH_CREDIT_FEATURE,
	PIN_PUBLISH_CREDIT_UNITS,
	pinterestPublishCreditIdempotencyKey,
	readPinterestPublishWorkspaceKey,
	requirePinterestPublishWorkspaceKey,
	withPinterestPublishCredits,
} from './pinterest-publish-credits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.join(here, 'pinterest-publish-credits.js'), 'utf8');
const queueSource = readFileSync(path.join(here, 'pinterest-publish-queue.js'), 'utf8');
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
		id: 'job_pin_1',
		owner: 'user_owner',
		workspace: 'ws_record_a',
		workspace_key: 'ws-a',
		attempt_count: 0,
		...overrides,
	};
}

describe('pinterestPublishCreditIdempotencyKey', () => {
	it('is unique per job and attempt so retries cannot reuse a reservation', () => {
		assert.equal(
			pinterestPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			'pin-publish:job1:attempt:0',
		);
		assert.equal(
			pinterestPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 1 }),
			'pin-publish:job1:attempt:1',
		);
		assert.notEqual(
			pinterestPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			pinterestPublishCreditIdempotencyKey({ id: 'job2', attempt_count: 0 }),
		);
	});
});

describe('requirePinterestPublishWorkspaceKey', () => {
	it('missing workspace key fails closed even when owner is present', async () => {
		await assert.rejects(
			() => requirePinterestPublishWorkspaceKey({ id: 'job1', owner: 'user_owner', workspace: '' }),
			(error) => error.status === 422 && error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('does not use owner as the wallet key', async () => {
		assert.equal(readPinterestPublishWorkspaceKey({ owner: 'user_owner', workspace_key: '' }), '');
		await assert.rejects(
			() => requirePinterestPublishWorkspaceKey({ id: 'job1', owner: 'user_owner' }),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('accepts explicit workspace_key and expanded workspace.workspace_key', async () => {
		assert.equal(await requirePinterestPublishWorkspaceKey({ workspace_key: 'ws-a' }), 'ws-a');
		assert.equal(await requirePinterestPublishWorkspaceKey({
			workspace: { id: 'ws_record_a', workspace_key: 'ws-from-expand' },
		}), 'ws-from-expand');
	});

	it('resolves workspace.workspace_key and never owner from the workspace record', async () => {
		const key = await requirePinterestPublishWorkspaceKey(
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
			() => requirePinterestPublishWorkspaceKey(
				{ workspace: 'ws_record_a', owner: 'user_owner' },
				{ getWorkspace: async () => ({ id: 'ws_record_a', owner: 'user_owner' }) },
			),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});
});

describe('withPinterestPublishCredits', () => {
	it('0 credits → 0 Pinterest API calls', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let providerCalls = 0;
		await assert.rejects(
			() => withPinterestPublishCredits(baseJob(), async () => {
				providerCalls += 1;
				return { id: 'pin_ext' };
			}, gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls.length, 0);
	});

	it('1 credit → one reservation, one successful publish, one commit', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		const result = await withPinterestPublishCredits(baseJob(), async () => {
			providerCalls += 1;
			assert.equal(gate.wallets['ws-a'], 0, 'reservation holds the credit before provider');
			return { id: 'pin_ext_1' };
		}, gate);
		assert.equal(providerCalls, 1);
		assert.equal(result.id, 'pin_ext_1');
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.beginCalls[0].feature, PIN_PUBLISH_CREDIT_FEATURE);
		assert.equal(gate.beginCalls[0].units, PIN_PUBLISH_CREDIT_UNITS);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, true);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
	});

	it('provider failure → reservation released', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		await assert.rejects(
			() => withPinterestPublishCredits(baseJob(), async () => {
				providerCalls += 1;
				throw new Error('pinterest 500');
			}, gate),
			/pinterest 500/,
		);
		assert.equal(providerCalls, 1);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, false);
		assert.equal([...gate.reservationsById.values()][0].status, 'released');
	});

	it('missing workspace key → no reservation and no provider', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 9 });
		let providerCalls = 0;
		await assert.rejects(
			() => withPinterestPublishCredits({ id: 'job1', owner: 'user_owner' }, async () => {
				providerCalls += 1;
				return { id: 'pin_ext' };
			}, gate),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(gate.wallets['ws-a'], 9);
	});

	it('workspace A cannot spend workspace B', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0, 'ws-b': 10 });
		let providerCalls = 0;
		await assert.rejects(
			() => withPinterestPublishCredits(baseJob({ workspace_key: 'ws-a' }), async () => {
				providerCalls += 1;
				return { id: 'pin_ext' };
			}, gate),
			(error) => error.status === 402,
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.wallets['ws-b'], 10);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.ok(gate.beginCalls.every((call) => call.workspaceKey !== 'ws-b'));
	});

	it('a workspace B job spends only workspace B', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 5, 'ws-b': 1 });
		await withPinterestPublishCredits(
			baseJob({ workspace_key: 'ws-b', owner: 'owner-a' }),
			async () => ({ id: 'pin_ext' }),
			gate,
		);
		assert.equal(gate.wallets['ws-a'], 5);
		assert.equal(gate.wallets['ws-b'], 0);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-b');
	});

	it('retry uses a new reservation key', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const firstJob = baseJob({ attempt_count: 0 });
		await assert.rejects(
			() => withPinterestPublishCredits(firstJob, async () => {
				throw new Error('pinterest timeout');
			}, gate),
			/pinterest timeout/,
		);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.beginCalls[0].idempotencyKey, 'pin-publish:job_pin_1:attempt:0');

		const retryJob = baseJob({ attempt_count: 1 });
		let retryProviderCalls = 0;
		await withPinterestPublishCredits(retryJob, async () => {
			retryProviderCalls += 1;
			return { id: 'pin_ext_retry' };
		}, gate);
		assert.equal(retryProviderCalls, 1);
		assert.equal(gate.beginCalls[1].idempotencyKey, 'pin-publish:job_pin_1:attempt:1');
		assert.notEqual(gate.beginCalls[0].idempotencyKey, gate.beginCalls[1].idempotencyKey);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls[1].success, true);
	});

	it('released reservation for the same attempt cannot call the provider', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await assert.rejects(
			() => withPinterestPublishCredits(job, async () => {
				throw new Error('provider down');
			}, gate),
		);
		let providerCalls = 0;
		await assert.rejects(
			() => withPinterestPublishCredits(job, async () => {
				providerCalls += 1;
				return { id: 'pin_ext' };
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_INACTIVE',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 1);
	});

	it('committed reservation for the same attempt cannot call the provider', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await withPinterestPublishCredits(job, async () => ({ id: 'pin_ext' }), gate);
		let providerCalls = 0;
		await assert.rejects(
			() => withPinterestPublishCredits(job, async () => {
				providerCalls += 1;
				return { id: 'pin_ext_dup' };
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_COMMITTED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
	});

	it('insufficient credits errors are not swallowed', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		await assert.rejects(
			() => withPinterestPublishCredits(baseJob(), async () => ({ id: 'x' }), gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
	});
});

describe('CR-P1-1 wiring — reservation location and existing success path', () => {
	it('claimed processJob reserves immediately before Pinterest API calls', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('async function processJob(job)'),
			queueSource.indexOf('function isRetryDue'),
		);
		assert.match(processFn, /withPinterestPublishCredits\(job,/);
		assert.match(processFn, /ensureValidPinterestAccessToken\(/);
		assert.match(processFn, /createPinterestPin\(/);
		assert.ok(
			processFn.indexOf('withPinterestPublishCredits(job,')
				< processFn.indexOf('ensureValidPinterestAccessToken('),
			'reservation wrapper must start before token refresh',
		);
		assert.ok(
			processFn.indexOf('withPinterestPublishCredits(job,')
				< processFn.indexOf('createPinterestPin('),
			'reservation wrapper must start before createPin',
		);
		assert.ok(
			processFn.indexOf('assertPinterestQueueWorkspaceIsolation')
				< processFn.indexOf('withPinterestPublishCredits(job,'),
			'workspace isolation must run before credit reservation',
		);
		assert.ok(
			processFn.indexOf('existingPinId') < processFn.indexOf('withPinterestPublishCredits(job,'),
			'idempotent already-published skip must exit before reservation',
		);
		assert.doesNotMatch(processFn, /consumeFeatureCredits/);
		assert.doesNotMatch(processFn, /workspaceKeyForUser/);
		assert.doesNotMatch(processFn, /consumeFeatureCredits[\s\S]*\.catch\(\(\) => null\)/);
	});

	it('queue claim still happens before processJob and aborts on token mismatch', () => {
		assert.match(queueSource, /claimScheduledJob/);
		assert.match(queueSource, /claim_token/);
		assert.match(queueSource, /processJob\(locked\)/);
		assert.ok(
			queueSource.indexOf('verified.claim_token !== claimToken')
				< queueSource.indexOf('processJob(locked)'),
			'claim token mismatch must abort before processJob',
		);
	});

	it('existing successful publish path remains intact after the credit gate', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('async function processJob(job)'),
			queueSource.indexOf('function isRetryDue'),
		);
		assert.match(processFn, /status: 'published'/);
		assert.match(processFn, /writePinterestPublishHistory/);
		assert.match(processFn, /writePinterestPublishQueueAudit/);
		assert.match(processFn, /pinterest_pin_id/);
		assert.match(processFn, /notifyWorkspaceUser/);
		assert.match(processFn, /createPinterestPin\(/);
		const firstPublished = processFn.indexOf("status: 'published'");
		const wrapperStart = processFn.indexOf('withPinterestPublishCredits(job,');
		assert.ok(firstPublished < wrapperStart, 'idempotent published skip still exists before reservation');
		const successPublished = processFn.indexOf("context: 'pinterest-queue:mark-published'");
		assert.ok(successPublished > wrapperStart, 'successful mark-published still follows the provider wrap');
	});

	it('401 createPin retry stays inside the same reservation', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('async function processJob(job)'),
			queueSource.indexOf('function isRetryDue'),
		);
		const wrapStart = processFn.indexOf('withPinterestPublishCredits(job,');
		const wrapEnd = processFn.indexOf('const pinterestPinId');
		const wrap = processFn.slice(wrapStart, wrapEnd);
		assert.equal((wrap.match(/createPinterestPin\(/g) || []).length, 2);
		assert.match(wrap, /forcing refresh then retry/);
	});

	it('helper never falls back to owner/user id for the wallet', () => {
		assert.doesNotMatch(helperSource, /workspaceKeyForUser/);
		assert.doesNotMatch(helperSource, /workspaceKey \|\| userId/);
		assert.doesNotMatch(helperSource, /job\.owner.*workspaceKey/);
		assert.match(helperSource, /Never uses owner \/ user id as the wallet key/);
		assert.match(helperSource, /PIN_PUBLISH_CREDIT_FEATURE = 'pin_publish'/);
		assert.match(helperSource, /PIN_PUBLISH_CREDIT_UNITS = 1/);
	});

	it('credits-engine pin_publish cost remains 1 and is not redefined here', () => {
		assert.match(engineSource, /pin_publish:\s*1/);
		assert.doesNotMatch(helperSource, /planCreditCosts/);
		assert.doesNotMatch(queueSource, /planCreditCosts/);
		assert.doesNotMatch(helperSource, /DEFAULT_CREDIT_COSTS/);
	});

	it('queue no longer swallows post-pay consume errors', () => {
		assert.doesNotMatch(queueSource, /consumeFeatureCredits/);
		assert.doesNotMatch(queueSource, /workspaceKeyForUser/);
		assert.match(queueSource, /withPinterestPublishCredits/);
	});
});
