/**
 * CR-P1-3 — WordPress publish worker credit gate.
 * Reservation happens in the claimed worker before the REST publish call.
 * Run: node --test src/services/wordpress-publish-credits.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	WORDPRESS_PUBLISH_CREDIT_FEATURE,
	WORDPRESS_PUBLISH_CREDIT_UNITS,
	wordpressPublishCreditIdempotencyKey,
	readWordpressPublishWorkspaceKey,
	requireWordpressPublishWorkspaceKey,
	withWordpressPublishCredits,
} from './wordpress-publish-credits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.join(here, 'wordpress-publish-credits.js'), 'utf8');
const queueSource = readFileSync(path.join(here, 'wordpress-publish-queue.js'), 'utf8');
const claimSource = readFileSync(path.join(here, 'wordpress-publish-claim.js'), 'utf8');
const pipelineSource = readFileSync(path.join(here, 'publish-pipeline.js'), 'utf8');
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
		id: 'job_wp_1',
		owner: 'user_owner',
		workspace: 'ws_record_a',
		workspace_key: 'ws-a',
		attempt_count: 0,
		...overrides,
	};
}

describe('wordpressPublishCreditIdempotencyKey', () => {
	it('is unique per job and attempt so retries cannot reuse a reservation', () => {
		assert.equal(
			wordpressPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			'wp-publish:job1:attempt:0',
		);
		assert.equal(
			wordpressPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 1 }),
			'wp-publish:job1:attempt:1',
		);
		assert.notEqual(
			wordpressPublishCreditIdempotencyKey({ id: 'job1', attempt_count: 0 }),
			wordpressPublishCreditIdempotencyKey({ id: 'job2', attempt_count: 0 }),
		);
	});
});

describe('requireWordpressPublishWorkspaceKey', () => {
	it('D. missing workspace key fails closed even when owner is present', async () => {
		await assert.rejects(
			() => requireWordpressPublishWorkspaceKey({ id: 'job1', owner: 'user_owner', workspace: '' }),
			(error) => error.status === 422 && error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('does not use owner as the wallet key', async () => {
		assert.equal(readWordpressPublishWorkspaceKey({ owner: 'user_owner', workspace_key: '' }), '');
		await assert.rejects(
			() => requireWordpressPublishWorkspaceKey({ id: 'job1', owner: 'user_owner' }),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('accepts explicit workspace_key and expanded workspace.workspace_key', async () => {
		assert.equal(await requireWordpressPublishWorkspaceKey({ workspace_key: 'ws-a' }), 'ws-a');
		assert.equal(await requireWordpressPublishWorkspaceKey({
			workspace: { id: 'ws_record_a', workspace_key: 'ws-from-expand' },
		}), 'ws-from-expand');
	});

	it('resolves workspace.workspace_key and never owner from the workspace record', async () => {
		const key = await requireWordpressPublishWorkspaceKey(
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
			() => requireWordpressPublishWorkspaceKey(
				{ workspace: 'ws_record_a', owner: 'user_owner' },
				{ getWorkspace: async () => ({ id: 'ws_record_a', owner: 'user_owner' }) },
			),
			(error) => error.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});
});

describe('withWordpressPublishCredits', () => {
	it('A. 0 credits → 0 WordPress REST publish calls', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		let providerCalls = 0;
		await assert.rejects(
			() => withWordpressPublishCredits(baseJob(), async () => {
				providerCalls += 1;
				return { id: 1, link: 'https://example.com/?p=1' };
			}, gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls.length, 0);
	});

	it('B. 1 credit → one reservation, one REST publish, one commit', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		const result = await withWordpressPublishCredits(baseJob(), async () => {
			providerCalls += 1;
			assert.equal(gate.wallets['ws-a'], 0, 'reservation holds the credit before REST');
			return { id: 99, link: 'https://example.com/?p=99', status: 'publish' };
		}, gate);
		assert.equal(providerCalls, 1);
		assert.equal(result.id, 99);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.beginCalls[0].feature, WORDPRESS_PUBLISH_CREDIT_FEATURE);
		assert.equal(gate.beginCalls[0].units, WORDPRESS_PUBLISH_CREDIT_UNITS);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-a');
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, true);
		assert.equal([...gate.reservationsById.values()][0].status, 'committed');
	});

	it('C. REST/provider failure → reservation released', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		let providerCalls = 0;
		await assert.rejects(
			() => withWordpressPublishCredits(baseJob(), async () => {
				providerCalls += 1;
				throw new Error('wp rest 500');
			}, gate),
			/wp rest 500/,
		);
		assert.equal(providerCalls, 1);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, false);
		assert.equal([...gate.reservationsById.values()][0].status, 'released');
	});

	it('D. missing workspace key → no reservation and no REST call', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 9 });
		let providerCalls = 0;
		await assert.rejects(
			() => withWordpressPublishCredits({ id: 'job1', owner: 'user_owner' }, async () => {
				providerCalls += 1;
				return { id: 1 };
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
			() => withWordpressPublishCredits(baseJob({ workspace_key: 'ws-a' }), async () => {
				providerCalls += 1;
				return { id: 1 };
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
		await withWordpressPublishCredits(
			baseJob({ workspace_key: 'ws-b', owner: 'owner-a' }),
			async () => ({ id: 1 }),
			gate,
		);
		assert.equal(gate.wallets['ws-a'], 5);
		assert.equal(gate.wallets['ws-b'], 0);
		assert.equal(gate.beginCalls[0].workspaceKey, 'ws-b');
	});

	it('F. retry uses a new reservation key', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		await assert.rejects(
			() => withWordpressPublishCredits(baseJob({ attempt_count: 0 }), async () => {
				throw new Error('wp timeout');
			}, gate),
			/wp timeout/,
		);
		assert.equal(gate.wallets['ws-a'], 1);
		assert.equal(gate.beginCalls[0].idempotencyKey, 'wp-publish:job_wp_1:attempt:0');

		let retryProviderCalls = 0;
		await withWordpressPublishCredits(baseJob({ attempt_count: 1 }), async () => {
			retryProviderCalls += 1;
			return { id: 2 };
		}, gate);
		assert.equal(retryProviderCalls, 1);
		assert.equal(gate.beginCalls[1].idempotencyKey, 'wp-publish:job_wp_1:attempt:1');
		assert.notEqual(gate.beginCalls[0].idempotencyKey, gate.beginCalls[1].idempotencyKey);
		assert.equal(gate.wallets['ws-a'], 0);
		assert.equal(gate.settleCalls[1].success, true);
	});

	it('G. released reservation for the same attempt cannot call REST', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await assert.rejects(
			() => withWordpressPublishCredits(job, async () => {
				throw new Error('provider down');
			}, gate),
		);
		let providerCalls = 0;
		await assert.rejects(
			() => withWordpressPublishCredits(job, async () => {
				providerCalls += 1;
				return { id: 1 };
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_INACTIVE',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 1);
	});

	it('G. committed reservation for the same attempt cannot call REST', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 1 });
		const job = baseJob();
		await withWordpressPublishCredits(job, async () => ({ id: 1 }), gate);
		let providerCalls = 0;
		await assert.rejects(
			() => withWordpressPublishCredits(job, async () => {
				providerCalls += 1;
				return { id: 2 };
			}, gate),
			(error) => error.errorCode === 'CREDIT_RESERVATION_COMMITTED',
		);
		assert.equal(providerCalls, 0);
		assert.equal(gate.wallets['ws-a'], 0);
	});

	it('insufficient credits errors are not swallowed', async () => {
		const gate = createMemoryCreditGate({ 'ws-a': 0 });
		await assert.rejects(
			() => withWordpressPublishCredits(baseJob(), async () => ({ id: 1 }), gate),
			(error) => error.status === 402 && error.errorCode === 'INSUFFICIENT_CREDITS',
		);
	});
});

describe('CR-P1-3 wiring — reservation location and existing success path', () => {
	it('H. claimed processJob reserves immediately before REST publish', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('async function processJob(job)'),
			queueSource.indexOf('async function failOrRetry'),
		);
		assert.match(processFn, /withWordpressPublishCredits\(job,/);
		assert.match(processFn, /createOrUpdateWordpressPost\(/);
		assert.ok(
			processFn.indexOf('withWordpressPublishCredits(job,')
				< processFn.indexOf('createOrUpdateWordpressPost('),
			'reservation wrapper must start before the REST publish call',
		);
		assert.ok(
			processFn.indexOf('Number(job.wp_post_id) > 0 && job.status === \'published\'')
				< processFn.indexOf('withWordpressPublishCredits(job,'),
			'already-published skip must exit before reservation',
		);
		assert.doesNotMatch(processFn, /consumeFeatureCredits/);
		assert.doesNotMatch(processFn, /workspaceKeyForUser/);
		assert.match(processFn, /status: 'published'/);
		assert.match(processFn, /persistWordpressPostIdentity/);
		assert.match(processFn, /writePublishHistory/);
		assert.match(processFn, /continueChefIaPublishWorkflow/);
	});

	it('H. existing successful publish path remains intact after the credit gate', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('async function processJob(job)'),
			queueSource.indexOf('async function failOrRetry'),
		);
		const wrapperStart = processFn.indexOf('withWordpressPublishCredits(job,');
		assert.ok(processFn.indexOf('persistWordpressPostIdentity') > wrapperStart);
		assert.ok(processFn.indexOf('writePublishHistory') > wrapperStart);
		assert.ok(processFn.indexOf('continueChefIaPublishWorkflow') > wrapperStart);
		assert.match(processFn, /resolveWordpressUpdatePostId/);
		assert.match(processFn, /wp_post_id: result\.id/);
	});

	it('I. already-published/idempotent jobs skip REST before reservation', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('async function processJob(job)'),
			queueSource.indexOf('async function failOrRetry'),
		);
		assert.match(processFn, /Number\(job\.wp_post_id\) > 0 && job\.status === 'published'/);
		assert.match(processFn, /Number\(job\.wp_post_id\) > 0 && job\.status === 'publishing'/);
		assert.ok(
			processFn.indexOf("job.status === 'publishing'")
				< processFn.indexOf('withWordpressPublishCredits(job,'),
		);
	});

	it('J. scheduled WordPress publishing follows the same gate', () => {
		assert.match(claimSource, /\['queued', 'scheduled'\]\.includes\(current\.status\)/);
		assert.match(queueSource, /status = "scheduled" && scheduled_at <= \{:now\}/);
		assert.match(queueSource, /processJob\(claimed\)/);
		assert.ok(
			queueSource.indexOf('claimJob(candidate.id)')
				< queueSource.indexOf('processJob(claimed)'),
			'claim must happen before processJob',
		);
		const tickFn = queueSource.slice(
			queueSource.indexOf('async function tick()'),
			queueSource.indexOf('export function getWordpressQueueStats'),
		);
		assert.match(tickFn, /processJob\(claimed\)/);
		assert.doesNotMatch(tickFn, /createOrUpdateWordpressPost/);
	});

	it('queue claim still aborts on token mismatch before processJob', () => {
		assert.match(claimSource, /verified.claim_token !== claimToken/);
		assert.match(queueSource, /from '\.\/wordpress-publish-claim\.js'/);
		assert.ok(
			queueSource.indexOf('claimJob(candidate.id)')
				< queueSource.indexOf('processJob(claimed)'),
		);
	});

	it('helper never falls back to owner/user id for the wallet', () => {
		assert.doesNotMatch(helperSource, /workspaceKeyForUser/);
		assert.doesNotMatch(helperSource, /workspaceKey \|\| userId/);
		assert.doesNotMatch(helperSource, /consumeFeatureCredits/);
		assert.match(helperSource, /Never uses owner \/ user id as the wallet key/);
		assert.match(helperSource, /WORDPRESS_PUBLISH_CREDIT_FEATURE = 'wordpress_publish'/);
		assert.match(helperSource, /WORDPRESS_PUBLISH_CREDIT_UNITS = 1/);
	});

	it('credits-engine wordpress_publish cost remains 1 and is not redefined here', () => {
		assert.match(engineSource, /wordpress_publish:\s*1/);
		assert.doesNotMatch(helperSource, /planCreditCosts/);
		assert.doesNotMatch(queueSource, /planCreditCosts/);
		assert.doesNotMatch(helperSource, /DEFAULT_CREDIT_COSTS/);
	});

	it('pipeline no longer post-pays or swallows WordPress credit errors', () => {
		assert.doesNotMatch(pipelineSource, /consumeFeatureCredits/);
		assert.doesNotMatch(pipelineSource, /WordPress publish credit burn skipped/);
		assert.doesNotMatch(queueSource, /consumeFeatureCredits/);
		assert.doesNotMatch(queueSource, /workspaceKeyForUser/);
		assert.match(queueSource, /withWordpressPublishCredits/);
		assert.match(pipelineSource, /continueChefIaPublishWorkflow/);
	});
});
