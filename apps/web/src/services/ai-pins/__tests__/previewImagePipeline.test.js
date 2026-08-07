import { describe, expect, it, vi } from 'vitest';
import {
	buildComposeInputsFromJobs,
	resolvePinBackgroundFromJob,
	resolvePreviewImageProvider,
} from '../previewImagePipeline.js';

describe('previewImagePipeline', () => {
	it('resolvePreviewImageProvider prefers override then panel then config', () => {
		expect(resolvePreviewImageProvider({
			imageProviderOverride: 'flux',
			panelImageProvider: 'openai',
			config: { images: { defaultProvider: 'gemini' } },
		})).toBe('flux');

		expect(resolvePreviewImageProvider({
			panelImageProvider: 'openai',
			config: { images: { defaultProvider: 'gemini' } },
		})).toBe('openai');
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
});
