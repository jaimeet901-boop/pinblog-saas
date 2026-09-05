/**
 * Writer article-images client + WriterPage contract tests (M3-A).
 * Run: node --test src/lib/__tests__/writerArticleImages.test.js
 * (from apps/web with node available, or docker volume-mount)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	fetchWriterArticleImages,
	normalizeClientImageCount,
} from '../writerArticleImages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const writerPage = readFileSync(path.resolve(here, '../../pages/app/WriterPage.jsx'), 'utf8');

describe('normalizeClientImageCount', () => {
	it('bounds 0–5', () => {
		assert.equal(normalizeClientImageCount(0), 0);
		assert.equal(normalizeClientImageCount(5), 5);
		assert.equal(normalizeClientImageCount(9), 5);
		assert.equal(normalizeClientImageCount(-1), 0);
	});
});

describe('fetchWriterArticleImages', () => {
	it('A. imageCount=0 → no fetch', async () => {
		let calls = 0;
		const result = await fetchWriterArticleImages({
			article: { seo_title: 'x' },
			imageCount: 0,
			requestId: 'ai-writer:1',
			fetchFn: async () => {
				calls += 1;
				return { ok: true, json: async () => ({}) };
			},
		});
		assert.equal(calls, 0);
		assert.equal(result.skipped, true);
		assert.equal(result.images, null);
	});

	it('B. imageCount=1 → POST body without workspaceKey', async () => {
		let body = null;
		const result = await fetchWriterArticleImages({
			article: { seo_title: 'Pasta', sections: [] },
			imageCount: 1,
			requestId: 'ai-writer:abc',
			fetchFn: async (url, options) => {
				assert.equal(url, '/writer-article-images');
				body = JSON.parse(options.body);
				return {
					ok: true,
					json: async () => ({
						ok: true,
						images: {
							requestedCount: 1,
							plannedCount: 1,
							resolvedCount: 1,
							failedCount: 0,
							skippedCount: 0,
							falAttempts: 0,
							pexelsAttempts: 1,
							assets: [{ slotId: 'slot-featured', source: 'stock_pexels' }],
						},
					}),
				};
			},
		});
		assert.equal(body.imageCount, 1);
		assert.equal(body.requestId, 'ai-writer:abc');
		assert.equal(body.workspaceKey, undefined);
		assert.equal(result.ok, true);
		assert.equal(result.images.resolvedCount, 1);
	});

	it('E. HTTP failure → ok:false, no throw', async () => {
		const result = await fetchWriterArticleImages({
			article: { seo_title: 'x' },
			imageCount: 2,
			requestId: 'r',
			fetchFn: async () => ({
				ok: false,
				json: async () => ({ ok: false, message: 'unavailable' }),
			}),
		});
		assert.equal(result.ok, false);
		assert.equal(result.images, null);
	});

	it('network throw → ok:false', async () => {
		const result = await fetchWriterArticleImages({
			article: { seo_title: 'x' },
			imageCount: 1,
			requestId: 'r',
			fetchFn: async () => {
				throw new Error('offline');
			},
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /offline/);
	});
});

describe('WriterPage M3-A contracts', () => {
	it('G. imageCount not in buildPrompt / LLM path', () => {
		assert.match(writerPage, /imageCount:\s*0/);
		assert.match(writerPage, /fetchWriterArticleImages/);
		const buildPromptStart = writerPage.indexOf('const buildPrompt');
		const buildPromptEnd = writerPage.indexOf('const generate = async');
		const buildPrompt = writerPage.slice(buildPromptStart, buildPromptEnd);
		assert.doesNotMatch(buildPrompt, /imageCount/);
		assert.doesNotMatch(buildPrompt, /Article images/);
	});

	it('A/H. imageCount=0 skips API; regenerate reuses generate + idempotencyKey', () => {
		assert.match(writerPage, /normalizeClientImageCount\(form\.imageCount\)/);
		assert.match(writerPage, /if \(imageCount > 0\)/);
		assert.match(writerPage, /requestId:\s*idempotencyKey/);
		assert.match(writerPage, /ai-writer:/);
		assert.match(writerPage, /buildGenerationMediaPreserve/);
	});

	it('I. attaches hosted images additively; does not overwrite featured/gallery in image block', () => {
		assert.match(writerPage, /ensureWriterImagesHosted\(imageResult\.images/);
		const imageHook = writerPage.slice(
			writerPage.indexOf('let articleWithImages = next'),
			writerPage.indexOf('generationSnapshotRef.current = null'),
		);
		assert.doesNotMatch(imageHook, /featured_image\s*:/);
		assert.doesNotMatch(imageHook, /gallery_images\s*:/);
		assert.match(imageHook, /images:\s*hosted\.images/);
	});

	it('E. image failures caught so generate can succeed', () => {
		assert.match(writerPage, /Image side-channel must never fail article generation/);
	});

	it('does not import stream route or SystemPrompt', () => {
		assert.doesNotMatch(writerPage, /integrated-ai\.js/);
		assert.doesNotMatch(writerPage, /SystemPrompt/);
		assert.doesNotMatch(writerPage, /planArticleImages/);
	});
});
