/**
 * P1 #3 — Article status sync on permanent WordPress publish failure / cancel.
 * Run: node --test src/services/wordpress-article-status-sync.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
	applyWordpressPublishFailureArticleSync,
	syncArticleToDraftOnPublishAbort,
} from './wordpress-article-status-sync.js';
import { createWordpressMutationAdapter } from './calendar/mutations/adapters/wordpress.js';
import { dispatchCalendarMutation } from './calendar/mutations/router.js';
import { normalizeWordpressPublishJob } from './publishing-history/normalize-wordpress.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function createArticleStore(initial = {}) {
	const articles = new Map(Object.entries(initial).map(([id, row]) => [id, { ...row }]));
	return {
		articles,
		updateArticle: async (id, payload) => {
			const current = articles.get(id);
			if (!current) throw new Error(`missing article ${id}`);
			articles.set(id, { ...current, ...payload, id });
			return { ...articles.get(id) };
		},
		get: (id) => articles.get(id),
	};
}

describe('wordpress article status sync (P1 #3)', () => {
	it('permanent publish failure with article_id sets article to draft', async () => {
		const store = createArticleStore({ art_1: { id: 'art_1', status: 'scheduled' } });
		const synced = await applyWordpressPublishFailureArticleSync(
			{ article_id: 'art_1' },
			{ retryable: false, updateArticle: store.updateArticle },
		);
		assert.equal(synced, true);
		assert.equal(store.get('art_1').status, 'draft');
	});

	it('retryable failure does not change article status', async () => {
		const store = createArticleStore({ art_1: { id: 'art_1', status: 'scheduled' } });
		const synced = await applyWordpressPublishFailureArticleSync(
			{ article_id: 'art_1' },
			{ retryable: true, updateArticle: store.updateArticle },
		);
		assert.equal(synced, false);
		assert.equal(store.get('art_1').status, 'scheduled');
	});

	it('failOrRetry only syncs article on permanent failure path (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		const failOrRetry = source.slice(
			source.indexOf('async function failOrRetry'),
			source.indexOf('async function recoverStuckJobs'),
		);
		const retryBranch = failOrRetry.slice(
			failOrRetry.indexOf('if (retryable)'),
			failOrRetry.indexOf("status: 'failed'"),
		);
		assert.doesNotMatch(retryBranch, /applyWordpressPublishFailureArticleSync|syncArticleToDraftOnPublishAbort/);
		assert.match(failOrRetry, /applyWordpressPublishFailureArticleSync\(job, \{ retryable: false \}\)/);
		assert.ok(
			failOrRetry.indexOf("status: 'failed'")
			< failOrRetry.indexOf('applyWordpressPublishFailureArticleSync'),
		);
	});

	it('cancelPublishJob syncs article to draft and keeps JOB_PUBLISHING guard (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		const block = source.slice(
			source.indexOf('export async function cancelPublishJob'),
			source.indexOf('export async function listPublishHistory'),
		);
		assert.match(block, /job\.status === 'publishing'/);
		assert.match(block, /httpError\(409, 'Job is already publishing and cannot be cancelled', 'JOB_PUBLISHING'\)/);
		assert.match(block, /syncArticleToDraftOnPublishAbort\(job\.article_id\)/);
		assert.ok(block.indexOf("status: 'cancelled'") < block.indexOf('syncArticleToDraftOnPublishAbort'));
	});

	it('API cancellation success path sets article to draft', async () => {
		const store = createArticleStore({ art_1: { id: 'art_1', status: 'scheduled' } });
		await syncArticleToDraftOnPublishAbort('art_1', { updateArticle: store.updateArticle });
		assert.equal(store.get('art_1').status, 'draft');
	});

	it('calendar cancellation success sets article to draft', async () => {
		const articleStore = createArticleStore({ art_1: { id: 'art_1', status: 'scheduled' } });
		const job = {
			id: 'job_1',
			owner: 'user_1',
			status: 'scheduled',
			article_id: 'art_1',
			scheduled_at: '2026-07-18T12:00:00.000Z',
			timezone: 'UTC',
			title: 'WP post',
		};
		const jobs = new Map([[job.id, { ...job }]]);
		const adapter = createWordpressMutationAdapter({
			getOwner: (req) => req.pocketbaseUserId,
			getJob: async (id) => (jobs.get(id) ? { ...jobs.get(id) } : null),
			updateJob: async (id, payload) => {
				const current = jobs.get(id);
				jobs.set(id, { ...current, ...payload, id });
				return { ...jobs.get(id) };
			},
			updateArticle: articleStore.updateArticle,
			sanitize: async ({ payload }) => payload,
			resolveScheduledAtUtc: ({ scheduledAt }) => new Date(scheduledAt).toISOString(),
		});

		await dispatchCalendarMutation(
			{ pocketbaseUserId: 'user_1' },
			{ eventId: 'wordpress:job_1', action: 'cancel', payload: {} },
			{ adapters: [adapter], assertCapability: () => {} },
		);

		assert.equal(jobs.get('job_1').status, 'cancelled');
		assert.equal(articleStore.get('art_1').status, 'draft');
	});

	it('calendar cancellation preserves publishing → 409 JOB_PUBLISHING without article sync', async () => {
		const articleStore = createArticleStore({ art_1: { id: 'art_1', status: 'scheduled' } });
		const job = {
			id: 'job_1',
			owner: 'user_1',
			status: 'publishing',
			article_id: 'art_1',
			title: 'WP post',
		};
		const jobs = new Map([[job.id, { ...job }]]);
		const adapter = createWordpressMutationAdapter({
			getOwner: (req) => req.pocketbaseUserId,
			getJob: async (id) => (jobs.get(id) ? { ...jobs.get(id) } : null),
			updateJob: async (id, payload) => {
				const current = jobs.get(id);
				jobs.set(id, { ...current, ...payload, id });
				return { ...jobs.get(id) };
			},
			updateArticle: articleStore.updateArticle,
			sanitize: async ({ payload }) => payload,
			resolveScheduledAtUtc: ({ scheduledAt }) => new Date(scheduledAt).toISOString(),
		});

		await assert.rejects(
			() => dispatchCalendarMutation(
				{ pocketbaseUserId: 'user_1' },
				{ eventId: 'wordpress:job_1', action: 'cancel', payload: {} },
				{ adapters: [adapter], assertCapability: () => {} },
			),
			(err) => err.status === 409 && err.errorCode === 'JOB_PUBLISHING',
		);
		assert.equal(jobs.get('job_1').status, 'publishing');
		assert.equal(articleStore.get('art_1').status, 'scheduled');
	});

	it('history: published + wp_status future displays as Scheduled on WordPress, not live Published', () => {
		const item = normalizeWordpressPublishJob({
			id: 'wp_future',
			site: 'site1',
			title: 'Later post',
			status: 'published',
			wp_status: 'future',
			wp_post_id: 99,
			wp_post_url: 'https://blog.example/later',
			scheduled_at: '2026-09-01T10:00:00.000Z',
			completed_at: '2026-08-01T12:00:00.000Z',
			created: '2026-08-01T11:00:00.000Z',
			updated: '2026-08-01T12:00:00.000Z',
		});

		assert.equal(item.nativeStatus, 'published');
		assert.equal(item.status, 'scheduled');
		assert.equal(item.channelPayload.wpStatus, 'future');
		assert.equal(item.actions.canCancel, false);
		assert.equal(item.actions.canPublishNow, false);
		assert.notEqual(item.status, 'published');
	});

	it('syncArticleToDraftOnPublishAbort no-ops without article_id', async () => {
		let called = false;
		const synced = await syncArticleToDraftOnPublishAbort('', {
			updateArticle: async () => { called = true; },
		});
		assert.equal(synced, false);
		assert.equal(called, false);
	});
});
