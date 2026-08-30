/**
 * P0 — WordPress publish worker claim/cancel re-check before REST publish.
 * Run: node --test src/services/wordpress-publish-queue.cancel-guard.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const queueSource = readFileSync(path.join(here, 'wordpress-publish-queue.js'), 'utf8');

function processJobSource() {
	return queueSource.slice(
		queueSource.indexOf('async function processJob(job)'),
		queueSource.indexOf('async function failOrRetry'),
	);
}

function claimHelperSource() {
	return queueSource.slice(
		queueSource.indexOf('async function assertWordpressPublishClaimStillActive'),
		queueSource.indexOf('async function processJob(job)'),
	);
}

describe('wordpress publish queue cancel/claim guard (P0)', () => {
	it('defines assertWordpressPublishClaimStillActive with status and claim checks', () => {
		const helper = claimHelperSource();
		assert.match(helper, /async function assertWordpressPublishClaimStillActive\(job\)/);
		assert.match(helper, /collection\('publish_jobs'\)\.getOne/);
		assert.match(helper, /fresh\.status === 'cancelled'/);
		assert.match(helper, /fresh\.status !== 'publishing'/);
		assert.match(helper, /claim_token/);
		assert.match(helper, /claim_version/);
		assert.match(helper, /return true/);
		assert.match(helper, /return false/);
	});

	it('processJob re-checks claim immediately before credits/WordPress publish', () => {
		const processFn = processJobSource();
		const recheckIdx = processFn.indexOf('assertWordpressPublishClaimStillActive(job)');
		const creditsIdx = processFn.indexOf('withWordpressPublishCredits(job,');
		const createIdx = processFn.indexOf('createOrUpdateWordpressPost(');

		assert.ok(recheckIdx >= 0, 'claim re-check must be called in processJob');
		assert.ok(creditsIdx > recheckIdx, 'claim re-check must run before withWordpressPublishCredits');
		assert.ok(createIdx > recheckIdx, 'claim re-check must run before createOrUpdateWordpressPost');
		assert.match(processFn, /const claimStillActive = await assertWordpressPublishClaimStillActive\(job\);/);
		assert.match(processFn, /if \(!claimStillActive\) \{\s*return;\s*\}/);
	});

	it('abort path returns without failOrRetry or status mutation near the re-check', () => {
		const processFn = processJobSource();
		const recheckIdx = processFn.indexOf('assertWordpressPublishClaimStillActive(job)');
		const abortBlock = processFn.slice(recheckIdx, processFn.indexOf('withWordpressPublishCredits(job,'));

		assert.match(abortBlock, /if \(!claimStillActive\) \{\s*return;\s*\}/);
		assert.doesNotMatch(abortBlock, /failOrRetry/);
		assert.doesNotMatch(abortBlock, /status:\s*'published'/);
		assert.doesNotMatch(abortBlock, /status:\s*'failed'/);
		assert.doesNotMatch(abortBlock, /status:\s*'queued'/);
		assert.doesNotMatch(abortBlock, /\.update\(/);

		const helper = claimHelperSource();
		assert.doesNotMatch(helper, /\.update\(/);
		assert.doesNotMatch(helper, /failOrRetry/);
	});
});
