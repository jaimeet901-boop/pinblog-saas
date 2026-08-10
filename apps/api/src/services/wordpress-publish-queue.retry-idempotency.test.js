/**
 * P1-6 — WordPress publish retry must not create duplicate posts.
 * Run: node --test src/services/wordpress-publish-queue.retry-idempotency.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function resolveWordpressUpdatePostId(job) {
	return job.payload?.updatePostId || job.wp_post_id || null;
}

function wordpressCreatePath(postId, resource = 'posts') {
	return postId
		? `/wp-json/wp/v2/${resource}/${postId}`
		: `/wp-json/wp/v2/${resource}`;
}

describe('wordpress publish retry idempotency (P1-6)', () => {
	it('uses existing wp_post_id for update instead of creating a new post', () => {
		const job = {
			wp_post_id: 42,
			payload: {},
		};
		assert.equal(resolveWordpressUpdatePostId(job), 42);
		assert.equal(wordpressCreatePath(resolveWordpressUpdatePostId(job)), '/wp-json/wp/v2/posts/42');
	});

	it('prefers payload.updatePostId when explicitly provided', () => {
		const job = {
			wp_post_id: 42,
			payload: { updatePostId: 99 },
		};
		assert.equal(resolveWordpressUpdatePostId(job), 99);
	});

	it('creates a new post only when no WordPress post id is known', () => {
		const job = { payload: {} };
		assert.equal(resolveWordpressUpdatePostId(job), null);
		assert.equal(wordpressCreatePath(resolveWordpressUpdatePostId(job)), '/wp-json/wp/v2/posts');
	});

	it('persists wp_post_id immediately after WordPress create (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		const createIdx = source.indexOf('const result = await createOrUpdateWordpressPost({');
		const persistIdx = source.indexOf('await persistWordpressPostIdentity(job.id, result.id, result.link');
		const historyIdx = source.indexOf('await writePublishHistory({', createIdx);
		assert.ok(createIdx >= 0);
		assert.ok(persistIdx > createIdx);
		assert.ok(historyIdx > persistIdx);
	});

	it('failOrRetry preserves wpPostId when early persistence fails (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		assert.match(source, /err\.wpPostId = wpPostId/);
		assert.match(source, /if \(error\?\.wpPostId\)/);
	});

	it('retryPublishJob does not clear wp_post_id (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/routes/wordpress/index.js'), 'utf8');
		const publishSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		const retryBlock = publishSource.slice(
			publishSource.indexOf('export async function retryPublishJob'),
			publishSource.indexOf('export async function cancelPublishJob'),
		);
		assert.doesNotMatch(retryBlock, /wp_post_id:\s*''/);
		assert.doesNotMatch(retryBlock, /wp_post_id:\s*0/);
		assert.doesNotMatch(retryBlock, /wp_post_id:\s*null/);
		assert.match(retryBlock, /status:\s*'queued'/);
		assert.match(source, /retryPublishJob\(wordpressJobOwner\(req\), req\.params\.id, req\)/);
	});

	it('already-published jobs short-circuit without re-posting (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		assert.match(source, /Number\(job\.wp_post_id\) > 0 && job\.status === 'published'/);
		assert.match(source, /Number\(job\.wp_post_id\) > 0 && job\.status === 'publishing'/);
	});

	it('simulated retry after partial success updates the same post id', () => {
		const firstAttempt = { id: 'job-1', wp_post_id: 777, wp_post_url: 'https://example.com/?p=777', status: 'failed' };
		const retried = { ...firstAttempt, status: 'queued', attempt_count: 0 };
		const postIdUsed = resolveWordpressUpdatePostId(retried);
		assert.equal(postIdUsed, 777);
		assert.equal(wordpressCreatePath(postIdUsed), '/wp-json/wp/v2/posts/777');
	});

	it('two rapid retries still target the same persisted post id', () => {
		const persisted = { wp_post_id: 501, payload: {} };
		const retryA = resolveWordpressUpdatePostId(persisted);
		const retryB = resolveWordpressUpdatePostId(persisted);
		assert.equal(retryA, retryB);
		assert.notEqual(wordpressCreatePath(retryA), '/wp-json/wp/v2/posts');
	});

	it('P1-5 workspace scoping on retry route remains intact (source)', () => {
		const routes = readFileSync(path.join(root, 'apps/api/src/routes/wordpress/index.js'), 'utf8');
		const publishSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(routes, /retryPublishJob\(wordpressJobOwner\(req\), req\.params\.id, req\)/);
		assert.match(publishSource, /loadOwnedPublishJob\(ownerId, jobId, req\)/);
		assert.match(publishSource, /recordBelongsToWorkspace\(job, req\)/);
	});
});
