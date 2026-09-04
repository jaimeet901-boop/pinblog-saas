/**
 * M3-C Writer → WordPress media helpers (mocked; no live WP/Pexels/Fal).
 * Run: node --test src/services/wordpress-writer-media.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	WP_WRITER_MEDIA_MAX_BYTES,
	buildWpWriterMediaFilename,
	decodeWpWriterDataImageUrl,
	detectWpWriterImageMagic,
	isAllowedWpWriterRemoteImageUrl,
	isWpWriterDataImageUrl,
	loadImageBytesForWordpressUpload,
	readWriterMediaMap,
	removeSeodevaFiguresBySrc,
	rewriteSeodevaArticleImageSrc,
	sanitizeWriterImagesSnapshot,
	selectWriterAssetsForUpload,
	writeWriterMediaMap,
} from './wordpress-writer-media.js';

const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);
const TINY_PNG_DATA = `data:image/png;base64,${TINY_PNG.toString('base64')}`;

// Minimal JPEG (1x1)
const TINY_JPEG = Buffer.from(
	'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
	'base64',
);
const TINY_JPEG_DATA = `data:image/jpeg;base64,${TINY_JPEG.toString('base64')}`;

const here = path.dirname(fileURLToPath(import.meta.url));

describe('M3-C wordpress-writer-media input', () => {
	it('B/C. valid Fal PNG and JPEG data URLs', () => {
		const png = decodeWpWriterDataImageUrl(TINY_PNG_DATA);
		assert.equal(png.contentType, 'image/png');
		assert.ok(png.buffer.length > 0);
		const jpeg = decodeWpWriterDataImageUrl(TINY_JPEG_DATA);
		assert.equal(jpeg.contentType, 'image/jpeg');
	});

	it('D. invalid data MIME rejected', () => {
		assert.throws(
			() => decodeWpWriterDataImageUrl('data:text/html;base64,PGgxPg=='),
			(err) => err.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('E. malformed data URL rejected', () => {
		assert.throws(
			() => decodeWpWriterDataImageUrl('data:image/png;base64'),
			(err) => err.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('F. oversized data URL rejected', () => {
		const huge = `data:image/png;base64,${'A'.repeat(WP_WRITER_MEDIA_MAX_BYTES * 2)}`;
		assert.throws(
			() => decodeWpWriterDataImageUrl(huge),
			(err) => err.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('G. invalid base64 / non-image rejected', () => {
		assert.throws(
			() => decodeWpWriterDataImageUrl('data:image/png;base64,not-valid-png-bytes!!!'),
			(err) => err.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('H. SVG rejected', () => {
		assert.throws(
			() => decodeWpWriterDataImageUrl('data:image/svg+xml;base64,PHN2Zy4uLjwv'),
			(err) => err.errorCode === 'VALIDATION_ERROR',
		);
		assert.equal(detectWpWriterImageMagic(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
	});

	it('I/J/K. remote URL allow policy', () => {
		assert.equal(isAllowedWpWriterRemoteImageUrl('http://images.pexels.com/x.jpg'), false);
		assert.equal(isAllowedWpWriterRemoteImageUrl('https://images.pexels.com/x.jpg'), true);
		assert.equal(isAllowedWpWriterRemoteImageUrl('javascript:alert(1)'), false);
		assert.equal(isWpWriterDataImageUrl(TINY_PNG_DATA), true);
	});
});

describe('M3-C remote download security (mocked)', () => {
	it('L/M/N/O. localhost/private rejected via safeFetch errors', async () => {
		await assert.rejects(
			() => loadImageBytesForWordpressUpload('https://127.0.0.1/x.jpg', {
				safeFetchFn: async () => {
					const err = new Error('Host resolves to a private IP');
					err.status = 422;
					err.errorCode = 'SSRF_BLOCKED';
					throw err;
				},
			}),
			(err) => err.errorCode === 'SSRF_BLOCKED' || err.status === 422,
		);
	});

	it('P. oversized response rejected', async () => {
		const big = Buffer.alloc(64, 1);
		// Pretend PNG magic so size check (not magic) is the failure mode
		big[0] = 0x89; big[1] = 0x50; big[2] = 0x4e; big[3] = 0x47;
		await assert.rejects(
			() => loadImageBytesForWordpressUpload('https://cdn.example/big.jpg', {
				maxBytes: 16,
				safeFetchFn: async () => ({
					response: {
						ok: true,
						status: 200,
						headers: { get: (k) => (k === 'content-type' ? 'image/png' : null) },
						arrayBuffer: async () => big,
					},
				}),
			}),
			(err) => err.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('Q/R. invalid MIME / magic rejected', async () => {
		await assert.rejects(
			() => loadImageBytesForWordpressUpload('https://cdn.example/x.html', {
				safeFetchFn: async () => ({
					response: {
						ok: true,
						status: 200,
						headers: { get: (k) => (k === 'content-type' ? 'text/html' : null) },
						arrayBuffer: async () => Buffer.from('<html></html>'),
					},
				}),
			}),
			(err) => err.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('S. download timeout handled', async () => {
		await assert.rejects(
			() => loadImageBytesForWordpressUpload('https://cdn.example/slow.jpg', {
				timeoutMs: 20,
				safeFetchFn: async (_url, opts) => {
					await new Promise((_, reject) => {
						opts.signal?.addEventListener('abort', () => {
							const err = new Error('aborted');
							err.name = 'AbortError';
							reject(err);
						});
					});
				},
			}),
			(err) => err.errorCode === 'WP_MEDIA_DOWNLOAD_FAILED' || err.name === 'AbortError',
		);
	});

	it('A. valid HTTPS image accepted (mocked)', async () => {
		const loaded = await loadImageBytesForWordpressUpload('https://images.pexels.com/photos/1.jpg', {
			safeFetchFn: async () => ({
				response: {
					ok: true,
					status: 200,
					headers: { get: (k) => (k === 'content-type' ? 'image/png' : null) },
					arrayBuffer: async () => TINY_PNG,
				},
			}),
		});
		assert.equal(loaded.contentType, 'image/png');
		assert.equal(loaded.buffer.length, TINY_PNG.length);
	});
});

describe('M3-C HTML rewrite / selection', () => {
	const figure = (src, alt = 'x', dims = ' width="1200" height="800"') => (
		`<figure class="seodeva-article-image">\n  <img src="${src}" alt="${alt}" loading="lazy"${dims} />\n</figure>`
	);

	it('Z/AA/AB/AC/AD. rewrite preserves attrs and order', () => {
		const html = [
			'<p>Intro</p>',
			'<h2>Cook</h2>',
			'<p>Sear.</p>',
			figure('https://images.pexels.com/a.jpg', 'Cook', ' width="1200" height="800"'),
			'<h2>Combine</h2>',
			'<p>Toss.</p>',
			figure('https://images.pexels.com/b.jpg', 'Combine', ''),
			'<p><a href="https://example.com/recipe">link</a></p>',
		].join('\n');
		const out = rewriteSeodevaArticleImageSrc(html, new Map([
			['https://images.pexels.com/a.jpg', 'https://wp.example/wp-content/uploads/a.jpg'],
			['https://images.pexels.com/b.jpg', 'https://wp.example/wp-content/uploads/b.jpg'],
		]));
		assert.match(out, /uploads\/a\.jpg/);
		assert.match(out, /uploads\/b\.jpg/);
		assert.match(out, /alt="Cook"/);
		assert.match(out, /width="1200" height="800"/);
		assert.match(out, /https:\/\/example\.com\/recipe/);
		assert.ok(out.indexOf('uploads/a.jpg') < out.indexOf('uploads/b.jpg'));
	});

	it('AJ. unrelated URLs untouched', () => {
		const html = `<p><img src="https://cdn.example/other.jpg" /></p>${figure('https://images.pexels.com/a.jpg')}`;
		const out = rewriteSeodevaArticleImageSrc(html, {
			'https://images.pexels.com/a.jpg': 'https://wp.example/a.jpg',
			'https://cdn.example/other.jpg': 'https://wp.example/SHOULD_NOT',
		});
		assert.match(out, /cdn\.example\/other\.jpg/);
		assert.doesNotMatch(out, /SHOULD_NOT/);
		assert.match(out, /wp\.example\/a\.jpg/);
	});

	it('AI. failed data URL figure removed', () => {
		const html = [
			figure(TINY_PNG_DATA, 'Fal'),
			figure('https://images.pexels.com/keep.jpg', 'Keep'),
		].join('\n');
		const out = removeSeodevaFiguresBySrc(html, [TINY_PNG_DATA]);
		assert.doesNotMatch(out, /data:image\/png/);
		assert.match(out, /keep\.jpg/);
	});

	it('AH. failed HTTPS keeps original via no rewrite', () => {
		const html = figure('https://images.pexels.com/keep.jpg');
		const out = rewriteSeodevaArticleImageSrc(html, new Map());
		assert.match(out, /images\.pexels\.com\/keep\.jpg/);
	});

	it('AE/AF. selectWriterAssetsForUpload first-wins slotId/URL', () => {
		const images = {
			assets: [
				{
					status: 'resolved', type: 'inline', slotId: 's1', sectionIndex: 0,
					headingFingerprint: 'a', url: 'https://images.pexels.com/1.jpg',
				},
				{
					status: 'resolved', type: 'inline', slotId: 's1', sectionIndex: 1,
					headingFingerprint: 'b', url: 'https://images.pexels.com/2.jpg',
				},
				{
					status: 'resolved', type: 'inline', slotId: 's2', sectionIndex: 1,
					headingFingerprint: 'b', url: 'https://images.pexels.com/1.jpg',
				},
			],
		};
		const selected = selectWriterAssetsForUpload(images, 'inline');
		assert.equal(selected.length, 1);
		assert.equal(selected[0].slotId, 's1');
		assert.equal(selected[0].url, 'https://images.pexels.com/1.jpg');
	});

	it('featured selection ignores inline', () => {
		const images = {
			assets: [
				{ status: 'resolved', type: 'featured', slotId: 'slot-featured', url: 'https://x/f.jpg', sectionIndex: null },
				{
					status: 'resolved', type: 'inline', slotId: 's1', sectionIndex: 0,
					headingFingerprint: 'a', url: 'https://x/i.jpg',
				},
			],
		};
		assert.equal(selectWriterAssetsForUpload(images, 'featured').length, 1);
		assert.equal(selectWriterAssetsForUpload(images, 'inline').length, 1);
	});
});

describe('M3-C snapshot / map / filename / credits contracts', () => {
	it('sanitizeWriterImagesSnapshot keeps compact resolved assets', () => {
		const snap = sanitizeWriterImagesSnapshot({
			assets: [
				{ status: 'resolved', type: 'inline', slotId: 's1', url: 'https://x/a.jpg', sectionIndex: 0, headingFingerprint: 'a', alt: 'A' },
				{ status: 'failed', type: 'inline', slotId: 's2', url: 'https://x/b.jpg' },
			],
		});
		assert.equal(snap.assets.length, 1);
		assert.equal(snap.assets[0].slotId, 's1');
	});

	it('AP. writerMediaMap read/write for retry reuse', () => {
		const map = writeWriterMediaMap(
			{ 'slot-1': { wpMediaId: 9, wpUrl: 'https://wp/a.jpg', sourceUrl: 'https://pexels/a.jpg' } },
			{ 'https://pexels/a.jpg': { wpMediaId: 9, wpUrl: 'https://wp/a.jpg', sourceUrl: 'https://pexels/a.jpg' } },
		);
		const job = { payload: { writerMediaMap: map } };
		const read = readWriterMediaMap(job);
		assert.equal(read.bySlotId['slot-1'].wpMediaId, 9);
		assert.equal(read.bySourceUrl['https://pexels/a.jpg'].wpUrl, 'https://wp/a.jpg');
	});

	it('filename is safe and deterministic', () => {
		const name = buildWpWriterMediaFilename({
			slotId: 'slot-2-cand-section-1',
			slug: '../evil script',
			contentType: 'image/png',
		});
		assert.match(name, /^writer-[a-z0-9_-]+\.png$/);
		assert.doesNotMatch(name, /\.\./);
		assert.doesNotMatch(name, / /);
	});

	it('AS/AT/AU. queue does not import ai_image credit helpers', () => {
		const queue = readFileSync(path.join(here, 'wordpress-publish-queue.js'), 'utf8');
		const writerMedia = readFileSync(path.join(here, 'wordpress-writer-media.js'), 'utf8');
		assert.doesNotMatch(queue, /withWriterFalCredits|CREDIT_FEATURE_AI_IMAGE/);
		assert.doesNotMatch(writerMedia, /withWriterFalCredits|CREDIT_FEATURE_AI_IMAGE/);
		assert.doesNotMatch(queue, /feature:\s*['"]ai_image['"]/);
		assert.doesNotMatch(writerMedia, /feature:\s*['"]ai_image['"]/);
		assert.match(queue, /withWordpressPublishCredits/);
		assert.match(queue, /writerImages|rewriteSeodevaArticleImageSrc|selectWriterAssetsForUpload/);
	});

	it('AR. enqueue stores writerImages only in payload; upload happens in processJob', () => {
		const publish = readFileSync(path.join(here, 'wordpress-publish.js'), 'utf8');
		const queue = readFileSync(path.join(here, 'wordpress-publish-queue.js'), 'utf8');
		assert.match(publish, /writerImagesSnapshot/);
		assert.doesNotMatch(publish, /uploadWordpressMedia/);
		assert.match(queue, /selectWriterAssetsForUpload\(writerImages, 'inline'\)/);
		assert.match(queue, /scheduled/);
	});

	it('AM/AN. manual featured wins over generated featured (source)', () => {
		const queue = readFileSync(path.join(here, 'wordpress-publish-queue.js'), 'utf8');
		assert.match(queue, /featured_image_url && !mediaId/);
		assert.match(queue, /!mediaId && !job\.featured_image_url/);
		assert.match(queue, /selectWriterAssetsForUpload\(writerImages, 'featured'\)/);
	});

	it('AV/AW/AX. zero-image path still uses existing featured upload only', () => {
		const queue = readFileSync(path.join(here, 'wordpress-publish-queue.js'), 'utf8');
		assert.match(queue, /inlineAssets\.length/);
		assert.match(queue, /contentHtml|job\.content/);
	});

	it('T/U. uploadWordpressMedia requires media id (source)', () => {
		const client = readFileSync(path.join(here, 'wordpress-client.js'), 'utf8');
		assert.match(client, /media response missing id/);
		assert.match(client, /alt_text/);
		assert.match(client, /loadImageBytesForWordpressUpload/);
	});
});
