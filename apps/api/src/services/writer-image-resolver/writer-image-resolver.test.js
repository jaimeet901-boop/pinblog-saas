/**
 * Writer Image Resolver (M2-A/B) — unit tests (no network).
 * Run: node --test src/services/writer-image-resolver/writer-image-resolver.test.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	resolveArticleImages,
	writerImageCreditIdempotencyKey,
	buildFalPromptFromSlot,
	normalizeFalGeneratedAsset,
	buildPexelsSearchQuery,
	pickBestPexelsCandidate,
	scoreStockRelevance,
	WRITER_BLOG_GENERATION_TARGET,
	ASSET_STATUS,
	ASSET_SOURCE,
} from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

function samplePlan(slots) {
	return {
		requestedCount: slots.length,
		plannedCount: slots.length,
		articleType: 'recipe',
		imageSlots: slots,
	};
}

function slot(id, overrides = {}) {
	return {
		id,
		type: id === 'slot-featured' ? 'featured' : 'inline',
		priority: 1,
		sectionIndex: null,
		after: 'hero',
		concept: 'finished plated dish',
		query: 'chicken alfredo pasta plated finished dish',
		altHint: 'Plated chicken alfredo',
		...overrides,
	};
}

function tinyPngBytes() {
	return Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64',
	);
}

function createCreditGate({ beginStatus = 'reserved', beginId = 'res-1', failBegin = false } = {}) {
	const beginCalls = [];
	const settleCalls = [];
	return {
		beginCalls,
		settleCalls,
		beginFeatureReservation: async (payload) => {
			beginCalls.push(payload);
			if (failBegin) {
				const error = new Error('Insufficient credits');
				error.errorCode = 'INSUFFICIENT_CREDITS';
				error.status = 402;
				throw error;
			}
			return {
				id: beginId,
				status: beginStatus,
				noop: beginStatus === 'noop',
			};
		},
		settleFeatureReservation: async (id, payload) => {
			settleCalls.push({ id, ...payload });
			return { settled: payload.success ? 'committed' : 'released' };
		},
	};
}

function pexelsPhoto(id, { alt, width = 2000, height = 1333 } = {}) {
	return {
		id,
		width,
		height,
		url: `https://www.pexels.com/photo/${id}/`,
		photographer: 'Ada Lens',
		photographer_url: 'https://www.pexels.com/@ada',
		alt: alt || '',
		src: {
			large2x: `https://images.pexels.com/photos/${id}/large2x.jpeg`,
			large: `https://images.pexels.com/photos/${id}/large.jpeg`,
			medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
		},
	};
}

function mockPexelsFetch(handler) {
	return async (url, init) => {
		assert.ok(init?.headers?.Authorization, 'Authorization header required');
		assert.equal(typeof init.headers.Authorization, 'string');
		// Never assert/log the raw key value in failure messages beyond presence
		const parsed = new URL(String(url));
		assert.equal(parsed.origin, 'https://api.pexels.com');
		return handler(parsed, init);
	};
}

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => JSON.stringify(body),
	};
}

const falOnlyDeps = (gate, generateWithFal) => ({
	beginFeatureReservation: gate.beginFeatureReservation,
	settleFeatureReservation: gate.settleFeatureReservation,
	generateWithFal,
});

describe('writer-image-resolver M2-A', () => {
	it('A. zero slots → no providers / no credits', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		let pexelsCalls = 0;
		const result = await resolveArticleImages(
			{ imageSlots: [] },
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				pexelsApiKey: 'pexels-secret',
				maxFalImages: 3,
				deps: {
					...falOnlyDeps(gate, async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png', provider: 'fal' }];
					}),
					allowStock: true,
					pexelsFetchFn: async () => {
						pexelsCalls += 1;
						return jsonResponse({ photos: [] });
					},
				},
			},
		);
		assert.equal(result.plannedCount, 0);
		assert.equal(result.assets.length, 0);
		assert.equal(result.falAttempts, 0);
		assert.equal(result.pexelsAttempts, 0);
		assert.equal(falCalls, 0);
		assert.equal(pexelsCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
	});

	it('B. allowFal=false → Fal not called', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: false,
				allowStock: false,
				maxFalImages: 3,
				deps: falOnlyDeps(gate, async () => {
					falCalls += 1;
					return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
				}),
			},
		);
		assert.equal(falCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(result.falAttempts, 0);
		assert.equal(result.assets[0].status, ASSET_STATUS.SKIPPED);
		assert.equal(result.assets[0].errorCode, 'FAL_DISABLED');
	});

	it('C. Fal success → asset + one credit commit', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				allowStock: false,
				maxFalImages: 3,
				requestId: 'req-c',
				falApiKey: 'test-key',
				deps: falOnlyDeps(gate, async (params) => {
					falCalls += 1;
					assert.ok(params.prompt);
					assert.equal(params.generationTarget.falImageSize.width, WRITER_BLOG_GENERATION_TARGET.falImageSize.width);
					return [{ bytes: tinyPngBytes(), contentType: 'image/png', provider: 'fal' }];
				}),
			},
		);
		assert.equal(falCalls, 1);
		assert.equal(result.falAttempts, 1);
		assert.equal(result.resolvedCount, 1);
		assert.equal(result.assets[0].status, ASSET_STATUS.RESOLVED);
		assert.equal(result.assets[0].source, ASSET_SOURCE.FAL);
		assert.equal(result.assets[0].slotId, 'slot-featured');
		assert.match(result.assets[0].url, /^data:image\/png;base64,/);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.beginCalls[0].feature, 'ai_image');
		assert.equal(gate.beginCalls[0].idempotencyKey, 'writer-image:req-c:slot:slot-featured');
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, true);
	});

	it('D. Fal failure → reservation released, no retry', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				allowStock: false,
				requestId: 'req-d',
				falApiKey: 'test-key',
				deps: falOnlyDeps(gate, async () => {
					falCalls += 1;
					throw new Error('Fal upstream failed');
				}),
			},
		);
		assert.equal(falCalls, 1);
		assert.equal(result.assets[0].status, ASSET_STATUS.FAILED);
		assert.equal(gate.settleCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, false);
		assert.equal(result.falAttempts, 1);
	});

	it('E. maxFalImages caps Fal calls', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([
				slot('slot-featured'),
				slot('slot-2-a', { id: 'slot-2-a', query: 'cooking chicken' }),
				slot('slot-3-b', { id: 'slot-3-b', query: 'sauce pan' }),
			]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				allowStock: false,
				maxFalImages: 1,
				requestId: 'req-e',
				falApiKey: 'key',
				deps: falOnlyDeps(gate, async () => {
					falCalls += 1;
					return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
				}),
			},
		);
		assert.equal(falCalls, 1);
		assert.equal(result.falAttempts, 1);
		assert.equal(result.resolvedCount, 1);
		assert.equal(result.skippedCount, 2);
		assert.ok(result.assets.some((a) => a.errorCode === 'FAL_BUDGET'));
	});

	it('F. multiple slots → one Fal attempt each, slotIds preserved', async () => {
		const gate = createCreditGate();
		const prompts = [];
		const result = await resolveArticleImages(
			samplePlan([
				slot('slot-featured'),
				slot('slot-2', { id: 'slot-2', query: 'chicken cooking skillet', concept: 'cooking chicken' }),
			]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				allowStock: false,
				maxFalImages: 5,
				requestId: 'req-f',
				falApiKey: 'key',
				deps: falOnlyDeps(gate, async ({ prompt }) => {
					prompts.push(prompt);
					return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
				}),
			},
		);
		assert.equal(result.falAttempts, 2);
		assert.equal(result.resolvedCount, 2);
		assert.deepEqual(result.assets.map((a) => a.slotId), ['slot-featured', 'slot-2']);
		assert.equal(gate.beginCalls.length, 2);
		assert.equal(prompts.length, 2);
	});

	it('G. credit reservation failure → Fal not called', async () => {
		const gate = createCreditGate({ failBegin: true });
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				allowStock: false,
				falApiKey: 'key',
				deps: falOnlyDeps(gate, async () => {
					falCalls += 1;
					return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
				}),
			},
		);
		assert.equal(falCalls, 0);
		assert.equal(result.falAttempts, 0);
		assert.equal(result.assets[0].status, ASSET_STATUS.FAILED);
		assert.equal(gate.settleCalls.length, 0);
	});

	it('H. invalid Fal response → failed, credit released', async () => {
		const gate = createCreditGate();
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				allowStock: false,
				requestId: 'req-h',
				falApiKey: 'key',
				deps: falOnlyDeps(gate, async () => [{ bytes: null, contentType: 'image/png' }]),
			},
		);
		assert.equal(result.assets[0].status, ASSET_STATUS.FAILED);
		assert.equal(gate.settleCalls[0].success, false);
	});

	it('I. invalid input → graceful, no throw', async () => {
		const result = await resolveArticleImages(null, { allowFal: true, allowStock: false });
		assert.equal(result.plannedCount, 0);
		assert.ok(Array.isArray(result.assets));

		const result2 = await resolveArticleImages(
			{ imageSlots: [{ concept: 'x' }] },
			{ workspaceKey: 'ws', allowFal: true, allowStock: false },
		);
		assert.equal(result2.plannedCount, 0);
	});

	it('J. provider isolation — no Writer/WP/Pins/prompt imports', () => {
		const files = [
			'index.js',
			'types.js',
			'acceptability.js',
			'fallback.js',
			'credits.js',
			'providers/index.js',
			'providers/fal-adapter.js',
			'providers/stock-pexels.js',
		];
		for (const name of files) {
			const src = readFileSync(join(here, name), 'utf8');
			assert.doesNotMatch(src, /ai-pin-image-queue/);
			assert.doesNotMatch(src, /integrated-ai/);
			assert.doesNotMatch(src, /SystemPrompt/);
			assert.doesNotMatch(src, /composeHtml/);
			assert.doesNotMatch(src, /from ['"].*wordpress|require\(['"].*wordpress/i);
			assert.doesNotMatch(src, /WriterPage/);
			assert.doesNotMatch(src, /from ['"].*unsplash|require\(['"].*unsplash/i);
		}
		const falSrc = readFileSync(join(here, 'providers/fal-adapter.js'), 'utf8');
		assert.match(falSrc, /image-providers\/fal\.js/);
	});

	it('helpers: prompt + normalize + idempotency key', () => {
		const prompt = buildFalPromptFromSlot(slot('s1'));
		assert.match(prompt, /chicken alfredo/i);
		assert.doesNotMatch(prompt, /pinterest/i);

		const asset = normalizeFalGeneratedAsset(
			slot('s1'),
			{ bytes: tinyPngBytes(), contentType: 'image/png', provider: 'fal' },
			{ prompt },
		);
		assert.equal(asset.status, ASSET_STATUS.RESOLVED);
		assert.equal(asset.width, 1200);
		assert.equal(asset.height, 800);

		assert.equal(
			writerImageCreditIdempotencyKey({ requestId: 'r1', slotId: 'slot-a' }),
			'writer-image:r1:slot:slot-a',
		);
	});

	it('missing workspaceKey with allowFal → fail without Fal', async () => {
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				allowFal: true,
				allowStock: false,
				falApiKey: 'key',
				deps: {
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
				},
			},
		);
		assert.equal(falCalls, 0);
		assert.equal(result.assets[0].errorCode, 'WORKSPACE_KEY_REQUIRED');
	});
});

describe('writer-image-resolver M2-B Pexels', () => {
	it('A. Pexels success → stock_pexels, no Fal, no credits', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		let pexelsCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-cook', {
				id: 'slot-cook',
				query: 'chicken cooking in skillet pan',
				concept: 'cooking chicken',
			})]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				allowStock: true,
				pexelsApiKey: 'pexels-test-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async (parsed) => {
						pexelsCalls += 1;
						assert.equal(parsed.searchParams.get('query'), 'chicken cooking in skillet pan');
						return jsonResponse({
							photos: [
								pexelsPhoto(101, { alt: 'chicken cooking in skillet pan on stove' }),
							],
						});
					}),
				},
			},
		);
		assert.equal(pexelsCalls, 1);
		assert.equal(falCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
		assert.equal(result.falAttempts, 0);
		assert.equal(result.pexelsAttempts, 1);
		assert.equal(result.assets[0].source, ASSET_SOURCE.STOCK_PEXELS);
		assert.equal(result.assets[0].status, ASSET_STATUS.RESOLVED);
		assert.match(result.assets[0].url, /^https:\/\/images\.pexels\.com\//);
		assert.equal(result.assets[0].providerMeta.photoId, '101');
		assert.match(result.assets[0].attribution, /Ada Lens/);
	});

	it('B. several candidates → best acceptable selected', async () => {
		const s = slot('slot-x', {
			id: 'slot-x',
			query: 'avocado toast with eggs',
			concept: 'list item: avocado toast with eggs',
		});
		const photos = [
			pexelsPhoto(1, { alt: 'city skyline at night' }),
			pexelsPhoto(2, { alt: 'avocado toast with eggs on plate breakfast' }),
			pexelsPhoto(3, { alt: 'random desk laptop' }),
		];
		const picked = pickBestPexelsCandidate(s, photos);
		assert.ok(picked.asset);
		assert.equal(picked.asset.providerMeta.photoId, '2');
		assert.ok(picked.asset.confidence >= 0.35);
	});

	it('C. irrelevant candidates → Fal fallback', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-cook', {
				id: 'slot-cook',
				query: 'chicken cooking in skillet pan',
				concept: 'cooking chicken',
			})]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				allowStock: true,
				pexelsApiKey: 'pexels-key',
				falApiKey: 'fal-key',
				requestId: 'req-irrel',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async () => jsonResponse({
						photos: [
							pexelsPhoto(9, { alt: 'mountain hiking trail sunrise' }),
							pexelsPhoto(10, { alt: 'office meeting whiteboard' }),
						],
					})),
				},
			},
		);
		assert.equal(falCalls, 1);
		assert.equal(result.assets[0].source, ASSET_SOURCE.FAL);
		assert.equal(gate.beginCalls.length, 1);
		assert.equal(gate.settleCalls[0].success, true);
	});

	it('D. Pexels HTTP error → Fal fallback', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				pexelsApiKey: 'pexels-key',
				falApiKey: 'fal-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async () => ({
						ok: false,
						status: 500,
						text: async () => 'error',
					})),
				},
			},
		);
		assert.equal(falCalls, 1);
		assert.equal(result.assets[0].source, ASSET_SOURCE.FAL);
	});

	it('E. Pexels malformed → Fal fallback', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				pexelsApiKey: 'pexels-key',
				falApiKey: 'fal-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async () => jsonResponse({ results: [] })),
				},
			},
		);
		assert.equal(falCalls, 1);
		assert.equal(result.assets[0].source, ASSET_SOURCE.FAL);
	});

	it('F. duplicate photo in candidates → another selected', async () => {
		const s = slot('slot-a', {
			id: 'slot-a',
			query: 'veggie omelette breakfast',
			concept: 'list item: veggie omelette',
		});
		const photos = [
			pexelsPhoto(50, { alt: 'veggie omelette breakfast skillet' }),
			pexelsPhoto(51, { alt: 'veggie omelette with peppers' }),
		];
		const usedPhotoIds = new Set(['50']);
		const picked = pickBestPexelsCandidate(s, photos, { usedPhotoIds });
		assert.equal(picked.asset.providerMeta.photoId, '51');
	});

	it('G. two slots cannot select same Pexels photo', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([
				slot('slot-1', {
					id: 'slot-1',
					query: 'overnight oats with berries',
					concept: 'list item: overnight oats with berries',
				}),
				slot('slot-2', {
					id: 'slot-2',
					query: 'overnight oats with berries',
					concept: 'list item: overnight oats with berries',
				}),
			]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				pexelsApiKey: 'pexels-key',
				falApiKey: 'fal-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async () => jsonResponse({
						photos: [
							pexelsPhoto(77, { alt: 'overnight oats with berries breakfast bowl' }),
						],
					})),
				},
			},
		);
		assert.equal(result.assets[0].source, ASSET_SOURCE.STOCK_PEXELS);
		assert.equal(result.assets[0].providerMeta.photoId, '77');
		// Second slot: only duplicate available → Fal
		assert.equal(result.assets[1].source, ASSET_SOURCE.FAL);
		assert.equal(falCalls, 1);
	});

	it('H. allowFal=false → Pexels may resolve; failed stock skips Fal', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const ok = await resolveArticleImages(
			samplePlan([slot('slot-ok', {
				id: 'slot-ok',
				query: 'cast iron pan oil seasoning with cloth',
				concept: 'drying and seasoning cast iron pan',
			})]),
			{
				allowFal: false,
				pexelsApiKey: 'pexels-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async () => jsonResponse({
						photos: [
							pexelsPhoto(88, { alt: 'cast iron pan oil seasoning with cloth' }),
						],
					})),
				},
			},
		);
		assert.equal(ok.assets[0].source, ASSET_SOURCE.STOCK_PEXELS);
		assert.equal(falCalls, 0);

		const fail = await resolveArticleImages(
			samplePlan([slot('slot-bad', {
				id: 'slot-bad',
				query: 'cast iron pan oil seasoning with cloth',
				concept: 'seasoning',
			})]),
			{
				allowFal: false,
				pexelsApiKey: 'pexels-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async () => jsonResponse({
						photos: [pexelsPhoto(1, { alt: 'beach volleyball tournament' })],
					})),
				},
			},
		);
		assert.equal(fail.assets[0].status, ASSET_STATUS.SKIPPED);
		assert.equal(fail.assets[0].errorCode, 'FAL_DISABLED');
		assert.equal(falCalls, 0);
		assert.equal(gate.beginCalls.length, 0);
	});

	it('I. Fal fallback commits credit only on success', async () => {
		const gate = createCreditGate();
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				pexelsApiKey: 'pexels-key',
				falApiKey: 'fal-key',
				requestId: 'req-i',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => [{ bytes: tinyPngBytes(), contentType: 'image/png' }],
					pexelsFetchFn: mockPexelsFetch(async () => ({
						ok: false,
						status: 429,
						text: async () => 'rate',
					})),
				},
			},
		);
		assert.equal(result.falAttempts, 1);
		assert.equal(result.assets[0].source, ASSET_SOURCE.FAL);
		assert.equal(gate.settleCalls[0].success, true);
	});

	it('J. Fal credit reservation failure after stock miss → Fal not called', async () => {
		const gate = createCreditGate({ failBegin: true });
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([slot('slot-featured')]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				pexelsApiKey: 'pexels-key',
				falApiKey: 'fal-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async () => jsonResponse({
						photos: [pexelsPhoto(1, { alt: 'unrelated aquarium fish tank' })],
					})),
				},
			},
		);
		assert.equal(falCalls, 0);
		assert.equal(result.falAttempts, 0);
		assert.equal(result.assets[0].status, ASSET_STATUS.FAILED);
	});

	it('K. maxFalImages never exceeded with stock misses', async () => {
		const gate = createCreditGate();
		let falCalls = 0;
		const result = await resolveArticleImages(
			samplePlan([
				slot('a', { id: 'a', query: 'alpha cooking skillet', concept: 'cooking' }),
				slot('b', { id: 'b', query: 'beta cooking skillet', concept: 'cooking' }),
				slot('c', { id: 'c', query: 'gamma cooking skillet', concept: 'cooking' }),
			]),
			{
				workspaceKey: 'ws-1',
				allowFal: true,
				maxFalImages: 2,
				pexelsApiKey: 'pexels-key',
				falApiKey: 'fal-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: mockPexelsFetch(async () => jsonResponse({
						photos: [pexelsPhoto(1, { alt: 'desert cactus landscape' })],
					})),
				},
			},
		);
		assert.equal(falCalls, 2);
		assert.equal(result.falAttempts, 2);
		assert.equal(result.skippedCount, 1);
	});

	it('L. zero slots → no Pexels / Fal / credits', async () => {
		let pexelsCalls = 0;
		let falCalls = 0;
		const gate = createCreditGate();
		const result = await resolveArticleImages(
			{ imageSlots: [] },
			{
				allowFal: true,
				pexelsApiKey: 'pexels-key',
				deps: {
					beginFeatureReservation: gate.beginFeatureReservation,
					settleFeatureReservation: gate.settleFeatureReservation,
					generateWithFal: async () => {
						falCalls += 1;
						return [{ bytes: tinyPngBytes(), contentType: 'image/png' }];
					},
					pexelsFetchFn: async () => {
						pexelsCalls += 1;
						return jsonResponse({ photos: [] });
					},
				},
			},
		);
		assert.equal(result.pexelsAttempts, 0);
		assert.equal(pexelsCalls, 0);
		assert.equal(falCalls, 0);
	});

	it('search query uses planner query, not SEO title fluff', () => {
		assert.equal(
			buildPexelsSearchQuery({
				query: 'chicken cooking in skillet pan',
				concept: 'cooking chicken',
			}),
			'chicken cooking in skillet pan',
		);
		assert.doesNotMatch(
			buildPexelsSearchQuery({ query: 'pasta being tossed with creamy sauce in skillet' }),
			/easy chicken alfredo pasta recipe/i,
		);
	});

	it('relevance scoring rewards overlap and penalizes empty alt', () => {
		const good = scoreStockRelevance({
			query: 'chicken cooking in skillet pan',
			concept: 'cooking chicken',
			alt: 'chicken cooking in skillet pan',
		});
		const bad = scoreStockRelevance({
			query: 'chicken cooking in skillet pan',
			concept: 'cooking chicken',
			alt: '',
		});
		const unrelated = scoreStockRelevance({
			query: 'chicken cooking in skillet pan',
			concept: 'cooking chicken',
			alt: 'snowy mountain ski resort',
		});
		assert.ok(good.score >= 0.35);
		assert.ok(bad.score < good.score);
		assert.ok(unrelated.score < 0.35);
	});
});

describe('writer-image-resolver M2-B quality scenarios (mocked)', () => {
	it('Recipe / How-to / Listicle planner queries pick process-oriented Pexels winners', async () => {
		const scenarios = [
			{
				label: 'recipe-cook',
				slot: slot('slot-cook', {
					id: 'slot-cook',
					query: 'chicken cooking in skillet pan',
					concept: 'cooking chicken',
				}),
				photos: [
					pexelsPhoto(1, { alt: 'easy chicken alfredo pasta recipe text graphic' }),
					pexelsPhoto(2, { alt: 'chicken cooking in skillet pan browning' }),
					pexelsPhoto(3, { alt: 'office keyboard coffee' }),
				],
				winnerId: '2',
			},
			{
				label: 'recipe-combine',
				slot: slot('slot-combine', {
					id: 'slot-combine',
					query: 'pasta being tossed with creamy sauce in skillet',
					concept: 'combining pasta with sauce',
				}),
				photos: [
					pexelsPhoto(4, { alt: 'pasta being tossed with creamy sauce in skillet' }),
					pexelsPhoto(5, { alt: 'red sports car garage' }),
				],
				winnerId: '4',
			},
			{
				label: 'howto-residue',
				slot: slot('slot-res', {
					id: 'slot-res',
					query: 'cast iron pan food residue being scraped cleaned',
					concept: 'removing residue from cast iron pan',
				}),
				photos: [
					pexelsPhoto(6, { alt: 'cast iron pan food residue being scraped cleaned' }),
					pexelsPhoto(7, { alt: 'how to clean a cast iron pan blog header' }),
				],
				winnerId: '6',
			},
			{
				label: 'howto-season',
				slot: slot('slot-season', {
					id: 'slot-season',
					query: 'cast iron pan oil seasoning with cloth',
					concept: 'drying and seasoning cast iron pan',
				}),
				photos: [
					pexelsPhoto(8, { alt: 'cast iron pan oil seasoning with cloth' }),
					pexelsPhoto(9, { alt: 'beach sunset palm trees' }),
				],
				winnerId: '8',
			},
			{
				label: 'list-oats',
				slot: slot('slot-oats', {
					id: 'slot-oats',
					query: 'overnight oats with berries',
					concept: 'list item: overnight oats with berries',
				}),
				photos: [
					pexelsPhoto(10, { alt: 'overnight oats with berries in glass jar' }),
					pexelsPhoto(11, { alt: '10 healthy breakfast ideas collage' }),
				],
				winnerId: '10',
			},
			{
				label: 'list-toast',
				slot: slot('slot-toast', {
					id: 'slot-toast',
					query: 'avocado toast with eggs',
					concept: 'list item: avocado toast with eggs',
				}),
				photos: [
					pexelsPhoto(12, { alt: 'avocado toast with eggs on sourdough' }),
					pexelsPhoto(13, { alt: 'library books shelf' }),
				],
				winnerId: '12',
			},
			{
				label: 'list-omelette',
				slot: slot('slot-egg', {
					id: 'slot-egg',
					query: 'veggie omelette',
					concept: 'list item: veggie omelette',
				}),
				photos: [
					pexelsPhoto(14, { alt: 'veggie omelette with spinach peppers' }),
					pexelsPhoto(15, { alt: 'traffic highway night' }),
				],
				winnerId: '14',
			},
		];

		for (const scenario of scenarios) {
			const searchQ = buildPexelsSearchQuery(scenario.slot);
			assert.equal(searchQ, scenario.slot.query);
			assert.doesNotMatch(searchQ, /easy chicken alfredo pasta recipe/i);
			assert.doesNotMatch(searchQ, /^how to clean/i);
			assert.doesNotMatch(searchQ, /10 healthy breakfast/i);

			const picked = pickBestPexelsCandidate(scenario.slot, scenario.photos);
			assert.ok(picked.asset, `${scenario.label} should pick a winner`);
			assert.equal(
				picked.asset.providerMeta.photoId,
				scenario.winnerId,
				`${scenario.label} wrong winner`,
			);
		}
	});
});
