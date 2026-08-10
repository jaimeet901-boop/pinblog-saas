/**
 * P1-12 — WordPress publish analytics must not double-count terminal failures.
 * Run: node --test src/services/wordpress-publish.analytics.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rollupWordpressPublishAnalytics } from './wordpress-publish-analytics-rollup.js';

describe('rollupWordpressPublishAnalytics (P1-12)', () => {
	it('A. counts a single terminal failure once when history and failed job overlap', () => {
		const rollup = rollupWordpressPublishAnalytics(
			[{ job: 'J1', result: 'failed' }],
			[{ id: 'J1', status: 'failed' }],
		);

		assert.equal(rollup.failed, 1);
		assert.equal(rollup.attempts, 1);
		assert.equal(rollup.successRate, 0);
	});

	it('B. counts orphan failed jobs without history rows', () => {
		const rollup = rollupWordpressPublishAnalytics(
			[],
			[{ id: 'J2', status: 'failed' }],
		);

		assert.equal(rollup.failed, 1);
		assert.equal(rollup.published, 0);
		assert.equal(rollup.attempts, 1);
	});

	it('C. dedupes overlapping failures and still counts orphan failed jobs', () => {
		const rollup = rollupWordpressPublishAnalytics(
			[
				{ job: 'J1', result: 'failed' },
				{ job: 'J2', result: 'failed' },
			],
			[
				{ id: 'J1', status: 'failed' },
				{ id: 'J2', status: 'failed' },
				{ id: 'J3', status: 'failed' },
			],
		);

		assert.equal(rollup.failed, 3);
		assert.equal(rollup.attempts, 3);
	});

	it('D. keeps published, draft, and scheduled counts history-based without duplication', () => {
		const rollup = rollupWordpressPublishAnalytics(
			[
				{ job: 'P1', result: 'published' },
				{ job: 'P2', result: 'published' },
				{ job: 'D1', result: 'draft' },
				{ job: 'S1', result: 'scheduled' },
				{ job: 'F1', result: 'failed' },
			],
			[
				{ id: 'P1', status: 'published' },
				{ id: 'P2', status: 'published' },
				{ id: 'D1', status: 'published' },
				{ id: 'S1', status: 'published' },
				{ id: 'F1', status: 'failed' },
			],
		);

		assert.equal(rollup.published, 2);
		assert.equal(rollup.drafts, 1);
		assert.equal(rollup.scheduled, 1);
		assert.equal(rollup.failed, 1);
		assert.equal(rollup.attempts, 5);
	});

	it('E. derives attempts and successRate from deduplicated terminal outcomes', () => {
		const rollup = rollupWordpressPublishAnalytics(
			[
				{ job: 'P1', result: 'published' },
				{ job: 'P2', result: 'published' },
				{ job: 'P3', result: 'published' },
				{ job: 'F1', result: 'failed' },
			],
			[{ id: 'F1', status: 'failed' }],
		);

		assert.equal(rollup.attempts, 4);
		assert.equal(rollup.successRate, 75);
		assert.equal(rollup.published + rollup.failed, rollup.attempts);
	});

	it('F. returns zero counters for empty input', () => {
		const rollup = rollupWordpressPublishAnalytics([], []);

		assert.deepEqual(rollup, {
			published: 0,
			drafts: 0,
			scheduled: 0,
			failed: 0,
			attempts: 0,
			successRate: 0,
		});
	});
});
