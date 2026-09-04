/**
 * Writer article-images service (M3-A / M3-B0) — unit tests with mocked planner/resolver.
 * Run: node --test src/services/writer-article-images.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	emptyWriterImagesResult,
	enrichAssetsWithPlannerPlacement,
	isPlannerReadyArticle,
	normalizeHeadingFingerprint,
	normalizeWriterImageCount,
	runWriterArticleImages,
} from './writer-article-images.js';

const SAMPLE_ARTICLE = {
	seo_title: 'Easy Chicken Alfredo Pasta Recipe',
	introduction: '<p>Creamy pasta.</p>',
	sections: [
		{ heading: 'Cooking the chicken', level: 'h2', content: '<p>Sear.</p>' },
		{ heading: 'Making the Alfredo sauce', level: 'h2', content: '<p>Simmer.</p>' },
	],
	faq: [],
	conclusion: '<p>Enjoy.</p>',
};

const RECIPE_ARTICLE = {
	seo_title: 'Easy Chicken Alfredo Pasta Recipe',
	introduction: '<p>A creamy weeknight pasta with tender chicken.</p>',
	sections: [
		{ heading: 'Ingredients', level: 'h2', content: '<p>Chicken, pasta, cream.</p>' },
		{ heading: 'Cooking the chicken', level: 'h2', content: '<p>Season and sear.</p>' },
		{ heading: 'Making the Alfredo sauce', level: 'h2', content: '<p>Simmer cream.</p>' },
		{ heading: 'Combining pasta, chicken and sauce', level: 'h2', content: '<p>Toss.</p>' },
		{ heading: 'Serving the finished dish', level: 'h2', content: '<p>Plate.</p>' },
	],
	faq: [{ question: 'Can I freeze it?', answer: 'Yes.' }],
	conclusion: '<p>Enjoy.</p>',
	featured_image: 'https://cdn.example/manual-featured.jpg',
	gallery_images: ['https://cdn.example/g1.jpg'],
};

describe('writer-article-images service', () => {
	it('normalizeWriterImageCount bounds 0–5', () => {
		assert.equal(normalizeWriterImageCount(0), 0);
		assert.equal(normalizeWriterImageCount(3), 3);
		assert.equal(normalizeWriterImageCount(9), 5);
		assert.equal(normalizeWriterImageCount(-2), 0);
		assert.equal(normalizeWriterImageCount('2'), 2);
		assert.equal(normalizeWriterImageCount('x'), 0);
	});

	it('isPlannerReadyArticle soft gate', () => {
		assert.equal(isPlannerReadyArticle(null), false);
		assert.equal(isPlannerReadyArticle({}), false);
		assert.equal(isPlannerReadyArticle(SAMPLE_ARTICLE), true);
		assert.equal(isPlannerReadyArticle({ seo_title: 'Only title' }), true);
	});

	it('A. imageCount=0 → skip, no planner/resolver', async () => {
		let planned = 0;
		let resolved = 0;
		const result = await runWriterArticleImages(
			{ article: SAMPLE_ARTICLE, imageCount: 0, workspaceKey: 'ws-1', requestId: 'r1' },
			{
				planArticleImages: () => {
					planned += 1;
					return { imageSlots: [] };
				},
				resolveArticleImages: async () => {
					resolved += 1;
					return { assets: [] };
				},
			},
		);
		assert.equal(result.skipped, true);
		assert.equal(result.images, null);
		assert.equal(planned, 0);
		assert.equal(resolved, 0);
	});

	it('B. imageCount=1 → plan + resolve with workspaceKey', async () => {
		let planArg = null;
		let resolveCtx = null;
		const result = await runWriterArticleImages(
			{
				article: SAMPLE_ARTICLE,
				imageCount: 1,
				workspaceKey: 'ws-secure',
				requestId: 'ai-writer:abc',
			},
			{
				planArticleImages: (article, opts) => {
					planArg = { article, opts };
					return {
						requestedCount: 1,
						plannedCount: 1,
						imageSlots: [{
							id: 'slot-featured',
							type: 'featured',
							sectionIndex: null,
							after: 'hero',
							query: 'chicken alfredo plated',
							concept: 'finished plated dish',
						}],
					};
				},
				resolveArticleImages: async (plan, ctx) => {
					resolveCtx = { plan, ctx };
					return {
						plannedCount: 1,
						resolvedCount: 1,
						failedCount: 0,
						skippedCount: 0,
						falAttempts: 0,
						pexelsAttempts: 1,
						assets: [{
							status: 'resolved',
							source: 'stock_pexels',
							slotId: 'slot-featured',
							url: 'https://images.pexels.com/photos/1/large.jpeg',
						}],
					};
				},
			},
		);
		assert.equal(result.skipped, false);
		assert.equal(planArg.opts.imageCount, 1);
		assert.equal(planArg.article.seo_title, SAMPLE_ARTICLE.seo_title);
		assert.equal(resolveCtx.ctx.workspaceKey, 'ws-secure');
		assert.equal(resolveCtx.ctx.requestId, 'ai-writer:abc');
		assert.equal(resolveCtx.ctx.allowFal, true);
		assert.equal(result.images.requestedCount, 1);
		assert.equal(result.images.resolvedCount, 1);
		assert.equal(result.images.assets[0].source, 'stock_pexels');
		assert.equal(result.images.assets[0].type, 'featured');
		assert.equal(result.images.assets[0].sectionIndex, null);
		assert.equal(result.images.assets[0].after, 'hero');
	});

	it('C. imageCount=5 accepted and capped in normalize', async () => {
		const result = await runWriterArticleImages(
			{ article: SAMPLE_ARTICLE, imageCount: 5, workspaceKey: 'ws-1', requestId: 'r5' },
			{
				planArticleImages: (_a, opts) => {
					assert.equal(opts.imageCount, 5);
					return { plannedCount: 5, imageSlots: [1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, query: `q${i}` })) };
				},
				resolveArticleImages: async () => ({
					plannedCount: 5,
					resolvedCount: 2,
					failedCount: 0,
					skippedCount: 3,
					falAttempts: 0,
					pexelsAttempts: 5,
					assets: [],
				}),
			},
		);
		assert.equal(result.images.requestedCount, 5);
		assert.equal(result.images.plannedCount, 5);
	});

	it('imageCount>5 normalized before plan', async () => {
		let seen = null;
		await runWriterArticleImages(
			{ article: SAMPLE_ARTICLE, imageCount: 99, workspaceKey: 'ws-1', requestId: 'r' },
			{
				planArticleImages: (_a, opts) => {
					seen = opts.imageCount;
					return { imageSlots: [] };
				},
				resolveArticleImages: async () => emptyWriterImagesResult(5),
			},
		);
		assert.equal(seen, 5);
	});

	it('missing workspaceKey throws', async () => {
		await assert.rejects(
			() => runWriterArticleImages({ article: SAMPLE_ARTICLE, imageCount: 1, requestId: 'r' }),
			(err) => err.errorCode === 'WORKSPACE_KEY_REQUIRED',
		);
	});

	it('malformed article → empty images, no throw', async () => {
		let resolved = 0;
		const result = await runWriterArticleImages(
			{ article: { nonsense: true }, imageCount: 2, workspaceKey: 'ws-1', requestId: 'r' },
			{
				planArticleImages: () => {
					throw new Error('should not plan');
				},
				resolveArticleImages: async () => {
					resolved += 1;
					return {};
				},
			},
		);
		assert.equal(resolved, 0);
		assert.equal(result.images.requestedCount, 2);
		assert.equal(result.images.plannedCount, 0);
		assert.equal(result.reason, 'article_not_ready');
	});
});

describe('M3-B0 placement enrichment', () => {
	it('D. heading normalization', () => {
		assert.equal(
			normalizeHeadingFingerprint('  Cooking the   Chicken '),
			'cooking the chicken',
		);
		assert.equal(
			normalizeHeadingFingerprint('EASY CHICKEN ALFREDO'),
			'easy chicken alfredo',
		);
		assert.equal(normalizeHeadingFingerprint(''), null);
		assert.equal(normalizeHeadingFingerprint('   '), null);
		assert.equal(normalizeHeadingFingerprint(null), null);
	});

	it('E. missing heading → headingFingerprint null', () => {
		const enriched = enrichAssetsWithPlannerPlacement(
			[{ status: 'resolved', slotId: 'slot-1', url: 'https://images.pexels.com/x.jpg' }],
			{
				imageSlots: [{
					id: 'slot-1',
					type: 'inline',
					sectionIndex: 0,
					after: 'section:0',
				}],
			},
			{ sections: [{ heading: '', content: '<p>x</p>' }] },
		);
		assert.equal(enriched[0].headingFingerprint, null);
		assert.equal(enriched[0].type, 'inline');
		assert.equal(enriched[0].sectionIndex, 0);
	});

	it('A. Recipe plan + resolved assets get placement metadata', async () => {
		const plan = {
			requestedCount: 3,
			plannedCount: 3,
			imageSlots: [
				{
					id: 'slot-featured',
					type: 'featured',
					priority: 1,
					sectionIndex: null,
					after: 'hero',
					concept: 'plated chicken alfredo',
					query: 'chicken alfredo pasta plated',
					altHint: 'Plated chicken alfredo',
				},
				{
					id: 'slot-2-cand-section-1',
					type: 'inline',
					priority: 2,
					sectionIndex: 1,
					after: 'section:1',
					concept: 'searing chicken in skillet',
					query: 'chicken searing skillet',
					altHint: 'Cooking the chicken',
				},
				{
					id: 'slot-3-cand-section-3',
					type: 'inline',
					priority: 3,
					sectionIndex: 3,
					after: 'section:3',
					concept: 'tossing pasta with sauce',
					query: 'pasta tossed alfredo sauce',
					altHint: 'Combining pasta and sauce',
				},
			],
		};

		const result = await runWriterArticleImages(
			{
				article: RECIPE_ARTICLE,
				imageCount: 3,
				workspaceKey: 'ws-1',
				requestId: 'ai-writer:recipe',
			},
			{
				planArticleImages: () => plan,
				resolveArticleImages: async () => ({
					plannedCount: 3,
					resolvedCount: 3,
					failedCount: 0,
					skippedCount: 0,
					falAttempts: 0,
					pexelsAttempts: 3,
					assets: [
						{
							status: 'resolved',
							source: 'stock_pexels',
							slotId: 'slot-featured',
							url: 'https://images.pexels.com/photos/featured/large.jpeg',
							width: 1200,
							height: 800,
							alt: 'Plated chicken alfredo',
							attribution: 'Ada Lens / Pexels',
							license: 'pexels',
							confidence: 0.9,
							providerMeta: { photoId: '101', provider: 'pexels' },
						},
						{
							status: 'resolved',
							source: 'stock_pexels',
							slotId: 'slot-2-cand-section-1',
							url: 'https://images.pexels.com/photos/cook/large.jpeg',
							width: 1100,
							height: 800,
							alt: 'Cooking the chicken',
							attribution: 'Bob / Pexels',
							license: 'pexels',
							confidence: 0.8,
							providerMeta: { photoId: '202' },
						},
						{
							status: 'resolved',
							source: 'fal',
							slotId: 'slot-3-cand-section-3',
							url: 'data:image/png;base64,abc',
							width: 1200,
							height: 800,
							alt: 'Combining pasta and sauce',
							attribution: 'Generated with Fal.ai',
							license: 'generated',
							confidence: 1,
							providerMeta: { provider: 'fal', hasBytes: true },
						},
					],
				}),
			},
		);

		const [featured, cooking, combining] = result.images.assets;

		assert.equal(featured.type, 'featured');
		assert.equal(featured.sectionIndex, null);
		assert.equal(featured.after, 'hero');
		assert.equal(featured.headingFingerprint, null);

		assert.equal(cooking.type, 'inline');
		assert.equal(cooking.sectionIndex, 1);
		assert.equal(cooking.after, 'section:1');
		assert.equal(cooking.headingFingerprint, 'cooking the chicken');

		assert.equal(combining.type, 'inline');
		assert.equal(combining.sectionIndex, 3);
		assert.equal(combining.after, 'section:3');
		assert.equal(combining.headingFingerprint, 'combining pasta, chicken and sauce');
	});

	it('B. Exact slotId join — no substring parsing', () => {
		// Deliberately misleading id that contains "cand-section-9" but planner maps to section 1
		const plan = {
			imageSlots: [{
				id: 'slot-2-cand-section-9-trap',
				type: 'inline',
				sectionIndex: 1,
				after: 'section:1',
			}],
		};
		const assets = [{
			status: 'resolved',
			slotId: 'slot-2-cand-section-9-trap',
			url: 'https://images.pexels.com/photos/ok.jpg',
		}];
		const enriched = enrichAssetsWithPlannerPlacement(assets, plan, RECIPE_ARTICLE);
		assert.equal(enriched[0].sectionIndex, 1);
		assert.equal(enriched[0].after, 'section:1');
		assert.equal(enriched[0].headingFingerprint, 'cooking the chicken');
		assert.notEqual(enriched[0].sectionIndex, 9);
	});

	it('C. Missing planner slot → no invented placement, no throw', () => {
		const enriched = enrichAssetsWithPlannerPlacement(
			[{
				status: 'resolved',
				source: 'stock_pexels',
				slotId: 'orphan-slot',
				url: 'https://images.pexels.com/photos/orphan.jpg',
				alt: 'orphan',
			}],
			{ imageSlots: [{ id: 'slot-featured', type: 'featured', after: 'hero', sectionIndex: null }] },
			RECIPE_ARTICLE,
		);
		assert.equal(enriched[0].slotId, 'orphan-slot');
		assert.equal(enriched[0].url, 'https://images.pexels.com/photos/orphan.jpg');
		assert.equal('type' in enriched[0], false);
		assert.equal('sectionIndex' in enriched[0], false);
		assert.equal('after' in enriched[0], false);
		assert.equal('headingFingerprint' in enriched[0], false);
	});

	it('F. Existing resolver fields preserved', async () => {
		const providerMeta = { photoId: '77', provider: 'pexels', relevance: { score: 0.9 } };
		const result = await runWriterArticleImages(
			{ article: RECIPE_ARTICLE, imageCount: 1, workspaceKey: 'ws-1', requestId: 'r' },
			{
				planArticleImages: () => ({
					imageSlots: [{
						id: 'slot-featured',
						type: 'featured',
						sectionIndex: null,
						after: 'hero',
					}],
				}),
				resolveArticleImages: async () => ({
					plannedCount: 1,
					resolvedCount: 1,
					assets: [{
						status: 'resolved',
						source: 'stock_pexels',
						slotId: 'slot-featured',
						url: 'https://images.pexels.com/photos/77/large.jpeg',
						width: 1600,
						height: 1067,
						alt: 'Plated dish',
						attribution: 'Ada / Pexels',
						license: 'pexels',
						confidence: 0.91,
						providerMeta,
					}],
				}),
			},
		);
		const asset = result.images.assets[0];
		assert.equal(asset.url, 'https://images.pexels.com/photos/77/large.jpeg');
		assert.equal(asset.source, 'stock_pexels');
		assert.equal(asset.alt, 'Plated dish');
		assert.equal(asset.confidence, 0.91);
		assert.equal(asset.width, 1600);
		assert.equal(asset.height, 1067);
		assert.equal(asset.attribution, 'Ada / Pexels');
		assert.equal(asset.license, 'pexels');
		assert.deepEqual(asset.providerMeta, providerMeta);
		assert.equal(asset.type, 'featured');
	});

	it('G. Featured remains separate — no section placement; article media untouched', async () => {
		const article = { ...RECIPE_ARTICLE };
		const result = await runWriterArticleImages(
			{ article, imageCount: 1, workspaceKey: 'ws-1', requestId: 'r' },
			{
				planArticleImages: () => ({
					imageSlots: [{
						id: 'slot-featured',
						type: 'featured',
						sectionIndex: null,
						after: 'hero',
					}],
				}),
				resolveArticleImages: async () => ({
					assets: [{
						status: 'resolved',
						slotId: 'slot-featured',
						url: 'https://images.pexels.com/photos/f.jpg',
					}],
				}),
			},
		);
		const featured = result.images.assets[0];
		assert.equal(featured.type, 'featured');
		assert.equal(featured.sectionIndex, null);
		assert.equal(featured.after, 'hero');
		assert.equal(featured.headingFingerprint, null);
		assert.equal(article.featured_image, 'https://cdn.example/manual-featured.jpg');
		assert.deepEqual(article.gallery_images, ['https://cdn.example/g1.jpg']);
	});

	it('preserves introduction placement as-is', () => {
		const enriched = enrichAssetsWithPlannerPlacement(
			[{ status: 'resolved', slotId: 'slot-intro', url: 'https://images.pexels.com/i.jpg' }],
			{
				imageSlots: [{
					id: 'slot-intro',
					type: 'inline',
					sectionIndex: null,
					after: 'introduction',
				}],
			},
			RECIPE_ARTICLE,
		);
		assert.equal(enriched[0].type, 'inline');
		assert.equal(enriched[0].sectionIndex, null);
		assert.equal(enriched[0].after, 'introduction');
		assert.equal(enriched[0].headingFingerprint, null);
	});
});
