import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const queueSource = readFileSync(path.join(here, 'ai-pin-image-queue.js'), 'utf8');

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Local copy of the queue pool helper — avoids importing pocketbaseClient. */
async function runWithConcurrency(items, concurrency, workerFn) {
	const list = Array.isArray(items) ? items : [];
	if (list.length === 0) {
		return;
	}
	let cursor = 0;
	const workerCount = Math.min(Math.max(1, concurrency), list.length);

	async function worker() {
		while (cursor < list.length) {
			const index = cursor;
			cursor += 1;
			await workerFn(list[index], index);
		}
	}

	await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

describe('ai-pin-image-queue concurrency', () => {
	it('runWithConcurrency limits active workers to 3', async () => {
		const delays = [80, 80, 80, 80, 80];
		let active = 0;
		let maxActive = 0;

		await runWithConcurrency(delays, 3, async (delay) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await sleep(delay);
			active -= 1;
		});

		assert.equal(maxActive, 3);
	});

	it('uses claim-first then bounded pool in processDueJobs', () => {
		const processFn = queueSource.slice(
			queueSource.indexOf('async function processDueJobs()'),
			queueSource.indexOf('async function recoverStuckProcessingJobs'),
		);
		assert.match(processFn, /const claimedJobs = \[\]/);
		assert.match(processFn, /await claimImageJob\(job\.id\)/);
		assert.match(processFn, /await runWithConcurrency\(claimedJobs, IMAGE_QUEUE_CONCURRENCY/);
		assert.match(processFn, /await executeClaimedImageJob\(fullJob\)/);
		assert.doesNotMatch(processFn, /for \(const job of dueJobs[\s\S]*await withTimeout\(processJob/);
	});

	it('exposes IMAGE_QUEUE_CONCURRENCY default of 3', () => {
		assert.match(queueSource, /AI_IMAGE_QUEUE_CONCURRENCY \|\| '3'/);
		assert.match(queueSource, /concurrency: IMAGE_QUEUE_CONCURRENCY/);
	});

	it('preserves CAS claim verification before execute', () => {
		assert.match(queueSource, /resolveClaimedImageJob/);
		assert.match(queueSource, /claim_token/);
		assert.match(queueSource, /claimJobByCas/);
	});
});
