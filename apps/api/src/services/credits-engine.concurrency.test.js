/**
 * Critical #1 — credit concurrency / non-negative balance regressions.
 * Run: node --test src/services/credits-engine.concurrency.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	withWorkspaceCreditLock,
	__resetWorkspaceCreditLocksForTests,
} from './credit-workspace-lock.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('withWorkspaceCreditLock serializes critical sections for one workspace', async () => {
	__resetWorkspaceCreditLocksForTests();
	const order = [];
	const a = withWorkspaceCreditLock('ws-a', async () => {
		order.push('a-start');
		await new Promise((r) => setTimeout(r, 25));
		order.push('a-end');
		return 'a';
	});
	const b = withWorkspaceCreditLock('ws-a', async () => {
		order.push('b-start');
		order.push('b-end');
		return 'b';
	});
	const results = await Promise.all([a, b]);
	assert.deepEqual(results, ['a', 'b']);
	assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});

test('independent workspaces do not block each other', async () => {
	__resetWorkspaceCreditLocksForTests();
	let concurrent = 0;
	let maxConcurrent = 0;
	const run = (key) => withWorkspaceCreditLock(key, async () => {
		concurrent += 1;
		maxConcurrent = Math.max(maxConcurrent, concurrent);
		await new Promise((r) => setTimeout(r, 20));
		concurrent -= 1;
	});
	await Promise.all([run('ws-1'), run('ws-2'), run('ws-3')]);
	assert.ok(maxConcurrent >= 2, `expected overlap across workspaces, got ${maxConcurrent}`);
});

test('unlocked concurrent debits can overspend (documents the race)', async () => {
	let balance = 5;
	const amount = 2;
	// Classic TOCTOU: check a snapshot, then mutate live balance without re-checking.
	const debitUnlocked = async () => {
		const current = balance;
		if (current < amount) throw Object.assign(new Error('INSUFFICIENT'), { code: 'INSUFFICIENT_CREDITS' });
		await new Promise((r) => setTimeout(r, 15));
		balance -= amount;
		return balance;
	};

	const outcomes = await Promise.allSettled(
		Array.from({ length: 10 }, () => debitUnlocked()),
	);
	const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
	assert.ok(fulfilled.length > 2, 'race should allow more than 2 successes without a lock');
	assert.ok(balance < 0, 'unlocked race should drive balance negative');
});

test('locked concurrent debits never overspend and never go negative', async () => {
	__resetWorkspaceCreditLocksForTests();
	let balance = 5;
	const amount = 2;
	const workspaceKey = 'ws-atomic';

	const debitLocked = () => withWorkspaceCreditLock(workspaceKey, async () => {
		await Promise.resolve();
		const current = balance;
		await Promise.resolve();
		if (current < amount) {
			throw Object.assign(new Error(`Insufficient credits. Remaining: ${current}`), {
				code: 'INSUFFICIENT_CREDITS',
				remaining: current,
			});
		}
		const next = current - amount;
		assert.ok(next >= 0);
		await Promise.resolve();
		balance = next;
		return next;
	});

	const outcomes = await Promise.allSettled(
		Array.from({ length: 20 }, () => debitLocked()),
	);
	const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
	const rejected = outcomes.filter((o) => o.status === 'rejected');

	assert.equal(fulfilled.length, 2);
	assert.equal(rejected.length, 18);
	assert.equal(balance, 1);
	assert.ok(balance >= 0);
	for (const r of rejected) {
		assert.match(String(r.reason?.message || r.reason), /Insufficient credits/i);
	}
});

test('locked release restores reserved credits exactly once', async () => {
	__resetWorkspaceCreditLocksForTests();
	let balance = 10;
	const workspaceKey = 'ws-release';
	const reservation = { id: 'res1', amount: 3, status: 'reserved' };

	const reserve = () => withWorkspaceCreditLock(workspaceKey, async () => {
		if (balance < reservation.amount) throw new Error('INSUFFICIENT');
		balance -= reservation.amount;
		reservation.status = 'reserved';
	});

	const release = () => withWorkspaceCreditLock(workspaceKey, async () => {
		if (reservation.status !== 'reserved') return { idempotent: true, balance };
		reservation.status = 'released';
		balance += reservation.amount;
		return { idempotent: false, balance };
	});

	await reserve();
	assert.equal(balance, 7);
	const first = await release();
	const second = await release();
	assert.equal(first.idempotent, false);
	assert.equal(second.idempotent, true);
	assert.equal(balance, 10);
	assert.ok(balance >= 0);
});

test('credits-engine wires workspace lock on mutate paths', () => {
	const source = readFileSync(path.join(here, 'credits-engine.js'), 'utf8');
	assert.match(source, /withWorkspaceCreditLock/);
	assert.match(source, /applyBalanceDeltaLocked/);
	for (const name of [
		'export async function consumeWorkspaceCredits',
		'export async function reserveCredits',
		'export async function commitReservation',
		'export async function releaseReservation',
		'export async function refundCredits',
		'export async function resetMonthlyCredits',
	]) {
		assert.match(source, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	}
	// Each mutator body must enter the lock (string presence near names).
	assert.match(source, /consumeWorkspaceCredits[\s\S]*?withWorkspaceCreditLock\(workspaceKey/);
	assert.match(source, /reserveCredits[\s\S]*?withWorkspaceCreditLock\(workspaceKey/);
	assert.match(source, /releaseReservation[\s\S]*?withWorkspaceCreditLock\(reservation\.workspace_key/);
	assert.match(source, /refundCredits[\s\S]*?withWorkspaceCreditLock\(workspaceKey/);
});

test('credits-engine rolls back debit when reservation create would fail pattern exists', () => {
	const source = readFileSync(path.join(here, 'credits-engine.js'), 'utf8');
	assert.match(source, /applyBalanceDeltaLocked\(workspaceKey, reserveAmount, \{ allowNegative: true \}\)/);
	assert.match(source, /applyBalanceDeltaLocked\(workspaceKey, burnAmount, \{[\s\S]*?allowNegative: true/);
});
