/**
 * WP create-retry idempotency via exact slug recovery.
 * Run: node --test src/services/wordpress-slug-recovery.test.js
 *
 * Pure helpers are duplicated here (same pattern as retry-idempotency.test.js)
 * so this suite does not import wordpress-client.js (PB side effects).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const WORDPRESS_SLUG_RECOVERY_STATUSES = 'publish,future,draft,pending,private';

function pickExactWordpressSlugMatch(items, slug) {
	const wanted = String(slug || '').trim();
	if (!wanted) return null;
	const matches = (Array.isArray(items) ? items : []).filter((item) => (
		String(item?.slug || '').trim() === wanted
		&& Number(item?.id) > 0
	));
	if (matches.length !== 1) return null;
	return matches[0];
}

function resolveWordpressUpdatePostId(job) {
	return job.payload?.updatePostId || job.wp_post_id || null;
}

function wordpressCreatePath(postId, resource = 'posts') {
	return postId
		? `/wp-json/wp/v2/${resource}/${postId}`
		: `/wp-json/wp/v2/${resource}`;
}

async function resolvePublishPostId(job, { findBySlug } = {}) {
	let updatePostId = resolveWordpressUpdatePostId(job);
	const contentType = job.payload?.contentType === 'page' ? 'page' : 'post';
	if (!updatePostId && String(job.slug || '').trim()) {
		const recovered = await findBySlug({
			slug: job.slug,
			contentType,
		}).catch(() => null);
		const recoveredId = Number(recovered?.id) || 0;
		if (recoveredId > 0) {
			updatePostId = recoveredId;
		}
	}
	return { updatePostId, path: wordpressCreatePath(updatePostId, contentType === 'page' ? 'pages' : 'posts') };
}

describe('wordpress slug recovery (create idempotency)', () => {
	it('includes future among recovery statuses', () => {
		assert.match(WORDPRESS_SLUG_RECOVERY_STATUSES, /future/);
		assert.match(WORDPRESS_SLUG_RECOVERY_STATUSES, /publish/);
		assert.match(WORDPRESS_SLUG_RECOVERY_STATUSES, /draft/);
	});

	it('no wp_post_id + exact existing slug → update, not create', async () => {
		const { updatePostId, path } = await resolvePublishPostId(
			{ slug: 'tomato-soup', payload: {} },
			{
				findBySlug: async () => ({ id: 441, slug: 'tomato-soup', status: 'future' }),
			},
		);
		assert.equal(updatePostId, 441);
		assert.equal(path, '/wp-json/wp/v2/posts/441');
	});

	it('no wp_post_id + no slug → create unchanged', async () => {
		let lookupCalls = 0;
		const { updatePostId, path } = await resolvePublishPostId(
			{ slug: '', payload: {} },
			{
				findBySlug: async () => {
					lookupCalls += 1;
					return { id: 99, slug: 'x' };
				},
			},
		);
		assert.equal(lookupCalls, 0);
		assert.equal(updatePostId, null);
		assert.equal(path, '/wp-json/wp/v2/posts');
	});

	it('no wp_post_id + no slug match → create unchanged', async () => {
		const { updatePostId, path } = await resolvePublishPostId(
			{ slug: 'brand-new', payload: {} },
			{ findBySlug: async () => null },
		);
		assert.equal(updatePostId, null);
		assert.equal(path, '/wp-json/wp/v2/posts');
	});

	it('multiple slug matches → do not arbitrarily select one', () => {
		const picked = pickExactWordpressSlugMatch([
			{ id: 1, slug: 'dup' },
			{ id: 2, slug: 'dup' },
		], 'dup');
		assert.equal(picked, null);
	});

	it('future post is eligible for recovery', () => {
		const picked = pickExactWordpressSlugMatch([
			{ id: 77, slug: 'later', status: 'future' },
		], 'later');
		assert.equal(picked.id, 77);
		assert.match(WORDPRESS_SLUG_RECOVERY_STATUSES, /(^|,)future(,|$)/);
	});

	it('existing wp_post_id / updatePostId path is unchanged', async () => {
		let lookupCalls = 0;
		const byWpId = await resolvePublishPostId(
			{ wp_post_id: 42, slug: 'tomato-soup', payload: {} },
			{
				findBySlug: async () => {
					lookupCalls += 1;
					return { id: 999, slug: 'tomato-soup' };
				},
			},
		);
		assert.equal(lookupCalls, 0);
		assert.equal(byWpId.updatePostId, 42);
		assert.equal(byWpId.path, '/wp-json/wp/v2/posts/42');

		const byUpdate = await resolvePublishPostId(
			{ wp_post_id: 42, slug: 'tomato-soup', payload: { updatePostId: 99 } },
			{
				findBySlug: async () => {
					lookupCalls += 1;
					return { id: 999, slug: 'tomato-soup' };
				},
			},
		);
		assert.equal(lookupCalls, 0);
		assert.equal(byUpdate.updatePostId, 99);
		assert.equal(byUpdate.path, '/wp-json/wp/v2/posts/99');
	});

	it('lookup failure does not break normal create behavior', async () => {
		const { updatePostId, path } = await resolvePublishPostId(
			{ slug: 'ok-create', payload: {} },
			{
				findBySlug: async () => {
					throw new Error('WP timeout');
				},
			},
		);
		assert.equal(updatePostId, null);
		assert.equal(path, '/wp-json/wp/v2/posts');
	});

	it('crash/retry scenario is protected by slug recovery', async () => {
		const retriedJob = { slug: 'crash-recover', wp_post_id: 0, payload: {}, status: 'queued' };
		const { updatePostId, path } = await resolvePublishPostId(retriedJob, {
			findBySlug: async ({ slug }) => {
				assert.equal(slug, 'crash-recover');
				return { id: 501, slug: 'crash-recover', status: 'future' };
			},
		});
		assert.equal(updatePostId, 501);
		assert.equal(path, '/wp-json/wp/v2/posts/501');
	});

	it('pickExactWordpressSlugMatch ignores near-miss slugs', () => {
		assert.equal(pickExactWordpressSlugMatch([{ id: 3, slug: 'soup-2' }], 'soup'), null);
		assert.equal(pickExactWordpressSlugMatch([{ id: 3, slug: 'soup' }], 'soup').id, 3);
	});

	it('queue wires slug recovery before createOrUpdateWordpressPost (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		const claimIdx = source.indexOf('assertWordpressPublishClaimStillActive(job)');
		const recoverIdx = source.indexOf('findWordpressContentByExactSlug({');
		const createIdx = source.indexOf('createOrUpdateWordpressPost({');
		assert.ok(claimIdx >= 0);
		assert.ok(recoverIdx > claimIdx);
		assert.ok(createIdx > recoverIdx);
		assert.match(source, /if \(!updatePostId && String\(job\.slug/);
	});

	it('client helper queries slug + recovery statuses including future (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		assert.match(source, /export async function findWordpressContentByExactSlug/);
		assert.match(source, /export function pickExactWordpressSlugMatch/);
		assert.match(source, /slug=\$\{encodeURIComponent\(wanted\)\}/);
		assert.match(source, /publish,future,draft,pending,private/);
		assert.match(source, /catch \{\s*return null;\s*\}/);
	});
});
