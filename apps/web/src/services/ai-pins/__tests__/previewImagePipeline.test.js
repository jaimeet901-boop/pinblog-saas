import { describe, expect, it, vi } from 'vitest';
import {
	buildComposeInputsFromJobs,
	queuePreviewImageJobs,
	resolvePinBackgroundFromJob,
	resolvePreviewImageProvider,
} from '../previewImagePipeline.js';

describe('previewImagePipeline', () => {
	it('resolvePreviewImageProvider never exposes a client-selectable provider', () => {
		expect(resolvePreviewImageProvider({
			imageProviderOverride: 'flux',
			panelImageProvider: 'openai',
			config: { images: { defaultProvider: 'gemini' } },
		})).toBe('');
	});

	it('resolvePinBackgroundFromJob uses AI URL on completed jobs', () => {
		const pin = {
			featuredImage: 'https://cdn.example/article.jpg',
			sourceImageUrl: 'https://cdn.example/article.jpg',
		};
		const resolved = resolvePinBackgroundFromJob({
			pin,
			job: { status: 'completed', imageUrl: 'https://cdn.example/ai.png' },
		});
		expect(resolved.background).toBe('https://cdn.example/ai.png');
		expect(resolved.usedArticleFallback).toBe(false);
	});

	it('resolvePinBackgroundFromJob uses article image only on fallback/failure', () => {
		const pin = {
			featuredImage: 'https://cdn.example/article.jpg',
			sourceImageUrl: 'https://cdn.example/article.jpg',
		};
		const failed = resolvePinBackgroundFromJob({
			pin,
			job: { status: 'failed', lastError: 'quota exceeded' },
		});
		expect(failed.background).toBe('https://cdn.example/article.jpg');
		expect(failed.usedArticleFallback).toBe(true);

		const timedOut = resolvePinBackgroundFromJob({
			pin,
			job: { status: 'processing' },
			pollTimedOut: true,
		});
		expect(timedOut.background).toBe('https://cdn.example/article.jpg');
		expect(timedOut.usedArticleFallback).toBe(true);
	});

	it('buildComposeInputsFromJobs never prefers article image when AI succeeded', () => {
		const pins = [{
			tempId: 't1',
			featuredImage: 'https://cdn.example/article.jpg',
			sourceImageUrl: 'https://cdn.example/article.jpg',
		}];
		const inputs = buildComposeInputsFromJobs({
			pins,
			queuedJobs: [{ clientToken: 't1', id: 'job-1', status: 'completed', imageUrl: 'https://cdn.example/ai.png' }],
			finishedJobs: [{ clientToken: 't1', id: 'job-1', status: 'completed', imageUrl: 'https://cdn.example/ai.png' }],
		});
		expect(inputs[0].featuredImage).toBe('https://cdn.example/ai.png');
		expect(inputs[0]._usedArticleFallback).toBe(false);
	});

	it('queuePreviewImageJobs forwards channel and exportProfileId', async () => {
		const fetchFn = vi.fn(async () => ({
			ok: true,
			json: async () => ({ items: [] }),
		}));

		await queuePreviewImageJobs({
			fetchFn,
			pins: [{
				tempId: 't1',
				articleId: 'art-1',
				title: 'Test',
				description: '',
				overlayText: '',
				suggestedKeywords: [],
				imagePrompt: 'prompt',
				category: 'food',
			}],
			channel: 'facebook',
			exportProfileId: 'facebook_post',
		});

		const body = JSON.parse(fetchFn.mock.calls[0][1].body);
		expect(body.items[0].channel).toBe('facebook');
		expect(body.items[0].exportProfileId).toBe('facebook_post');
		expect(body.items[0].imageMode).toBe('generate_ai');
		expect(body.items[0]).not.toHaveProperty('provider');
	});

	it('queuePreviewImageJobs does not POST jobs for Featured / use_featured pins', async () => {
		const fetchFn = vi.fn(async () => ({
			ok: true,
			json: async () => ({ items: [{ id: 'should-not-exist' }] }),
		}));

		const queued = await queuePreviewImageJobs({
			fetchFn,
			pins: [{
				tempId: 't-featured',
				articleId: 'art-1',
				title: 'Featured pin',
				featuredImage: 'https://cdn.example/article.jpg',
				imageMode: 'use_featured',
				imagePlan: { imageMode: 'use_featured', useAi: false },
			}],
		});

		expect(queued).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
