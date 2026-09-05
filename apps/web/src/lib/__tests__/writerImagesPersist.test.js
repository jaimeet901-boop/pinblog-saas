/**
 * Writer image persistence helper tests (Option D).
 * Run: node --test src/lib/__tests__/writerImagesPersist.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	composeArticleHtml,
	selectPlaceableInlineAssetsBySection,
} from '../writerComposeHtml.js';
import {
	dataImageUrlToBlob,
	ensureWriterImagesHosted,
	isAllowedWriterDataImageUrl,
	isAllowedWriterHttpsImageUrl,
	sanitizeWriterImagesForPersist,
} from '../writerImagesPersist.js';
import { buildArticlePersistPayload } from '../writer-article-persist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const writerPage = readFileSync(path.resolve(here, '../../pages/app/WriterPage.jsx'), 'utf8');
const persistSrc = readFileSync(path.resolve(here, '../writerImagesPersist.js'), 'utf8');

/** 1×1 PNG */
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** Oversized fake Fal payload (~1.5MB base64 body) for size budget checks */
const LARGE_FAL_DATA_URL = `data:image/png;base64,${'A'.repeat(1_500_000)}`;

const PEXELS_URL = 'https://images.pexels.com/photos/101/large.jpeg';
const HOSTED_URL = 'https://cdn.example.com/files/writer-slot-inline.png';

function sampleImages({ falUrl = TINY_PNG_DATA_URL, pexelsUrl = PEXELS_URL } = {}) {
	return {
		requestedCount: 2,
		plannedCount: 2,
		resolvedCount: 2,
		failedCount: 0,
		skippedCount: 0,
		falAttempts: 1,
		pexelsAttempts: 1,
		assets: [
			{
				status: 'resolved',
				source: 'fal',
				slotId: 'slot-featured',
				type: 'featured',
				sectionIndex: null,
				after: 'hero',
				headingFingerprint: null,
				url: falUrl,
				alt: 'Featured dish',
				width: 1200,
				height: 800,
				providerMeta: { provider: 'fal' },
			},
			{
				status: 'resolved',
				source: 'stock_pexels',
				slotId: 'slot-inline-0',
				type: 'inline',
				sectionIndex: 0,
				after: 'heading',
				headingFingerprint: 'how to cook pasta',
				url: pexelsUrl,
				alt: 'Pasta in pan',
				width: 2000,
				height: 1333,
				providerMeta: { provider: 'pexels', photoId: '101' },
			},
		],
	};
}

describe('writerImagesPersist URL helpers', () => {
	it('accepts HTTPS and allowlisted data:image', () => {
		assert.equal(isAllowedWriterHttpsImageUrl(PEXELS_URL), true);
		assert.equal(isAllowedWriterHttpsImageUrl('http://insecure.example/a.png'), false);
		assert.equal(isAllowedWriterDataImageUrl(TINY_PNG_DATA_URL), true);
		assert.equal(isAllowedWriterDataImageUrl('data:text/plain;base64,YQ=='), false);
	});

	it('dataImageUrlToBlob decodes PNG', () => {
		const blob = dataImageUrlToBlob(TINY_PNG_DATA_URL);
		assert.ok(blob);
		assert.equal(blob.type, 'image/png');
		assert.ok(blob.size > 0);
	});
});

describe('ensureWriterImagesHosted', () => {
	it('converts Fal data URL to hosted HTTPS and passes Pexels through', async () => {
		let uploadCalls = 0;
		const input = sampleImages();
		const { images, stats } = await ensureWriterImagesHosted(input, {
			uploadImageBlob: async (blob, meta) => {
				uploadCalls += 1;
				assert.ok(blob instanceof Blob);
				assert.match(String(meta?.fileName || ''), /writer-/);
				return { imageUrl: HOSTED_URL };
			},
		});

		assert.equal(uploadCalls, 1);
		assert.equal(stats.hosted, 1);
		assert.equal(stats.passthrough, 1);
		assert.equal(stats.failed, 0);
		assert.equal(images.assets[0].url, HOSTED_URL);
		assert.equal(images.assets[1].url, PEXELS_URL);
		// Original input not mutated
		assert.equal(input.assets[0].url, TINY_PNG_DATA_URL);
	});

	it('preserves placement metadata through hosting', async () => {
		const { images } = await ensureWriterImagesHosted(sampleImages(), {
			uploadImageBlob: async () => ({ imageUrl: HOSTED_URL }),
		});
		const featured = images.assets.find((a) => a.slotId === 'slot-featured');
		const inline = images.assets.find((a) => a.slotId === 'slot-inline-0');
		assert.equal(featured.type, 'featured');
		assert.equal(featured.after, 'hero');
		assert.equal(featured.alt, 'Featured dish');
		assert.equal(featured.providerMeta.provider, 'fal');
		assert.equal(inline.sectionIndex, 0);
		assert.equal(inline.headingFingerprint, 'how to cook pasta');
		assert.equal(inline.type, 'inline');
	});

	it('does not re-upload already-hosted HTTPS URLs', async () => {
		let uploadCalls = 0;
		const imagesIn = {
			requestedCount: 1,
			resolvedCount: 1,
			assets: [{
				status: 'resolved',
				slotId: 'a',
				type: 'inline',
				sectionIndex: 0,
				headingFingerprint: 'x',
				url: HOSTED_URL,
			}],
		};
		await ensureWriterImagesHosted(imagesIn, {
			uploadImageBlob: async () => {
				uploadCalls += 1;
				return { imageUrl: HOSTED_URL };
			},
		});
		assert.equal(uploadCalls, 0);
	});

	it('omits asset on upload failure without throwing', async () => {
		const { images, stats } = await ensureWriterImagesHosted(sampleImages(), {
			uploadImageBlob: async () => {
				throw new Error('upload failed');
			},
		});
		assert.equal(stats.failed, 1);
		assert.equal(stats.passthrough, 1);
		assert.equal(images.assets.length, 1);
		assert.equal(images.assets[0].url, PEXELS_URL);
		assert.doesNotMatch(JSON.stringify(images), /data:image/);
	});

	it('omits unsupported / unsafe URLs', async () => {
		const { images, stats } = await ensureWriterImagesHosted({
			assets: [
				{ status: 'resolved', slotId: 'bad', type: 'inline', url: 'data:text/html;base64,YQ==' },
				{ status: 'resolved', slotId: 'http', type: 'inline', url: 'http://example.com/a.png' },
			],
		}, {
			uploadImageBlob: async () => ({ imageUrl: HOSTED_URL }),
		});
		assert.equal(images, null);
		assert.ok(stats.failed >= 1);
	});

	it('does not import Fal or credit APIs', () => {
		assert.doesNotMatch(persistSrc, /fal-adapter|generateWithFal|beginFeatureReservation|settleFeatureReservation/);
		assert.doesNotMatch(persistSrc, /from ['"].*credits/);
		assert.match(persistSrc, /uploadImageBlob/);
	});
});

describe('sanitizeWriterImagesForPersist', () => {
	it('strips all data:image URLs from persist payload', () => {
		const sanitized = sanitizeWriterImagesForPersist(sampleImages({ falUrl: LARGE_FAL_DATA_URL }));
		assert.ok(sanitized);
		assert.equal(sanitized.assets.length, 1);
		assert.equal(sanitized.assets[0].url, PEXELS_URL);
		assert.doesNotMatch(JSON.stringify(sanitized), /data:image/);
	});

	it('keeps draft body well under 2 MB for large Fal case', () => {
		const raw = sampleImages({ falUrl: LARGE_FAL_DATA_URL });
		assert.ok(JSON.stringify(raw).length > 1_000_000);

		const sanitized = sanitizeWriterImagesForPersist(raw);
		const persistBody = {
			seo_title: 'Pasta Guide',
			introduction: 'Intro',
			sections: [{ heading: 'How to cook pasta', content: '<p>Boil water.</p>' }],
			faq: [],
			images: sanitized,
			featured_image: '',
			gallery_images: [],
		};
		const payload = buildArticlePersistPayload({
			form: { keyword: 'pasta', language: 'en', country: 'US', tone: 'friendly' },
			article: persistBody,
			persistBody,
			status: 'draft',
		});
		const size = JSON.stringify(payload).length;
		assert.ok(size < 50_000, `persist payload too large: ${size}`);
		assert.ok(size < 2_000_000);
		assert.doesNotMatch(JSON.stringify(payload), /data:image/);
	});
});

describe('reload + compose placement', () => {
	it('reloaded hosted images keep placement for composeArticleHtml', async () => {
		const { images } = await ensureWriterImagesHosted(sampleImages({
			falUrl: TINY_PNG_DATA_URL,
			pexelsUrl: 'https://images.pexels.com/photos/101/inline.jpeg',
		}), {
			uploadImageBlob: async () => ({ imageUrl: 'https://cdn.example.com/hosted-featured.png' }),
		});

		// Simulate Save Draft → openDraft (...body)
		const persisted = sanitizeWriterImagesForPersist(images);
		const reloaded = {
			seo_title: 'Pasta',
			introduction: '<p>Hi</p>',
			sections: [
				{ heading: 'How to cook pasta', content: '<p>Boil.</p>', level: 'h2' },
			],
			faq: [],
			images: persisted,
		};

		const bySection = selectPlaceableInlineAssetsBySection(reloaded);
		assert.equal(bySection.size, 1);
		assert.equal(bySection.get(0).headingFingerprint, 'how to cook pasta');
		assert.equal(bySection.get(0).url, 'https://images.pexels.com/photos/101/inline.jpeg');

		const html = composeArticleHtml(reloaded);
		assert.match(html, /seodeva-article-image/);
		assert.match(html, /images\.pexels\.com\/photos\/101\/inline\.jpeg/);
		assert.doesNotMatch(html, /data:image/);
	});
});

describe('WriterPage wiring contracts', () => {
	it('hosts images after fetchWriterArticleImages and guards persist body', () => {
		assert.match(writerPage, /ensureWriterImagesHosted/);
		assert.match(writerPage, /sanitizeWriterImagesForPersist/);
		assert.match(writerPage, /buildPersistableBody/);
		const imageHook = writerPage.slice(
			writerPage.indexOf('let articleWithImages = next'),
			writerPage.indexOf('generationSnapshotRef.current = null'),
		);
		assert.match(imageHook, /ensureWriterImagesHosted\(imageResult\.images/);
		assert.match(writerPage, /ensureWriterImagesHosted\(article\.images/);
	});
});
