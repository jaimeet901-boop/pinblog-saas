import { describe, expect, it, vi } from 'vitest';
import {
	PIN_COPY_SOURCE,
	PIN_IMAGE_SOURCE_KIND,
	buildPinGenerationMeta,
	resolveStudioPinCopy,
	toAnalyticsImageSource,
	withUpdatedImageSourceMeta,
} from '../aiPinsPinCopy.js';
import {
	TEXT_PROVIDER_ERROR_CATEGORY,
	classifyTextProviderError,
	isTemporaryTextProviderError,
} from '../textProviderErrors.js';

describe('classifyTextProviderError (provider-agnostic)', () => {
	it('treats 503 / 504 / 429 / timeout as temporary with normalized categories', () => {
		expect(classifyTextProviderError({ status: 503, message: 'busy' })).toEqual({
			temporary: true,
			category: TEXT_PROVIDER_ERROR_CATEGORY.HTTP_503,
			status: 503,
		});
		expect(classifyTextProviderError({ status: 504, message: 'gateway' }).category)
			.toBe(TEXT_PROVIDER_ERROR_CATEGORY.HTTP_504);
		expect(classifyTextProviderError({ status: 429, message: 'slow down' }).category)
			.toBe(TEXT_PROVIDER_ERROR_CATEGORY.RATE_LIMIT);
		expect(classifyTextProviderError(new Error('request timed out after 45000ms')).category)
			.toBe(TEXT_PROVIDER_ERROR_CATEGORY.TIMEOUT);
	});

	it('classifies capacity language without provider product names', () => {
		const classified = classifyTextProviderError({
			message: 'request failed (503): This model is currently experiencing high demand.',
		});
		expect(classified.temporary).toBe(true);
		expect(classified.category).toBe(TEXT_PROVIDER_ERROR_CATEGORY.HTTP_503);
		expect(String(classified.category)).not.toMatch(/gemini|openai|claude/i);
	});

	it('treats auth and invalid model as permanent', () => {
		expect(isTemporaryTextProviderError({ status: 401, message: 'Unauthorized' })).toBe(false);
		expect(classifyTextProviderError({ status: 401, message: 'Unauthorized' }).category)
			.toBe(TEXT_PROVIDER_ERROR_CATEGORY.AUTH);
		expect(classifyTextProviderError({ message: 'Invalid API key' }).temporary).toBe(false);
		expect(classifyTextProviderError({ message: 'invalid model id xyz' }).category)
			.toBe(TEXT_PROVIDER_ERROR_CATEGORY.INVALID_CONFIG);
		expect(classifyTextProviderError({ errorCode: 'AI_PROVIDER_NOT_CONFIGURED', message: 'No provider' }).temporary)
			.toBe(false);
	});
});

describe('resolveStudioPinCopy', () => {
	const article = {
		title: 'Easy Pasta Dinner',
		metaDescription: 'A weeknight pasta.',
		excerpt: 'Cook pasta fast.',
		category: 'dinner',
	};

	it('uses local featured path without calling generateText', async () => {
		const generateText = vi.fn();
		const result = await resolveStudioPinCopy({
			imageMode: 'use_featured',
			article,
			count: 2,
			panel: {},
			analysis: null,
			generateText,
			buildPrompt: () => 'unused',
			parsePins: () => [],
		});
		expect(generateText).not.toHaveBeenCalled();
		expect(result.copySource).toBe(PIN_COPY_SOURCE.LOCAL_FEATURED);
		expect(result.imageSource).toBe(PIN_IMAGE_SOURCE_KIND.FEATURED);
		expect(result.fallbackReason).toBeNull();
		expect(result.pins).toHaveLength(2);
		expect(result.meta).toEqual({
			copySource: PIN_COPY_SOURCE.LOCAL_FEATURED,
			imageSource: 'featured',
			fallbackReason: null,
		});
	});

	it('returns AI pins on success', async () => {
		const result = await resolveStudioPinCopy({
			imageMode: 'generate_ai',
			article,
			count: 1,
			panel: {},
			generateText: async () => ({ text: '{"pins":[{"title":"AI Title","description":"d","overlayText":"Go"}]}' }),
			buildPrompt: () => 'prompt',
			parsePins: (text) => JSON.parse(text).pins,
		});
		expect(result.copySource).toBe(PIN_COPY_SOURCE.AI);
		expect(result.pins[0].title).toBe('AI Title');
		expect(result.fallbackReason).toBeNull();
		expect(result.meta.imageSource).toBe('ai');
	});

	it('falls back to buildLocalPinsFromArticle on temporary provider error', async () => {
		const error = new Error('request failed (503): high demand');
		error.status = 503;
		const result = await resolveStudioPinCopy({
			imageMode: 'generate_ai',
			article,
			count: 1,
			panel: {},
			generateText: async () => {
				throw error;
			},
			buildPrompt: () => 'prompt',
			parsePins: () => [],
		});
		expect(result.copySource).toBe(PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK);
		expect(result.fallbackReason).toBe(TEXT_PROVIDER_ERROR_CATEGORY.HTTP_503);
		expect(result.imageSource).toBe('ai');
		expect(result.pins[0].title).toBeTruthy();
		expect(result.meta).toEqual({
			copySource: PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK,
			imageSource: 'ai',
			fallbackReason: 'http_503',
		});
	});

	it('rethrows permanent provider errors', async () => {
		const error = new Error('Invalid API key');
		error.status = 401;
		await expect(resolveStudioPinCopy({
			imageMode: 'generate_ai',
			article,
			count: 1,
			panel: {},
			generateText: async () => {
				throw error;
			},
			buildPrompt: () => 'prompt',
			parsePins: () => [],
		})).rejects.toThrow(/Invalid API key/);
	});

	it('uses local pins when AI returns empty parse', async () => {
		const result = await resolveStudioPinCopy({
			imageMode: 'generate_ai',
			article,
			count: 1,
			panel: {},
			generateText: async () => ({ text: 'not json' }),
			buildPrompt: () => 'prompt',
			parsePins: () => [],
		});
		expect(result.copySource).toBe(PIN_COPY_SOURCE.LOCAL_EMPTY_PARSE);
		expect(result.fallbackReason).toBe('empty_ai_response');
	});
});

describe('generation meta helpers', () => {
	it('maps operational image sources to ai|featured', () => {
		expect(toAnalyticsImageSource('ai_generated')).toBe('ai');
		expect(toAnalyticsImageSource('featured_fallback')).toBe('featured');
		expect(toAnalyticsImageSource('featured_composed')).toBe('featured');
	});

	it('updates only imageSource on meta after image pipeline', () => {
		const meta = buildPinGenerationMeta({
			copySource: PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK,
			imageSource: 'ai',
			fallbackReason: 'http_503',
		});
		const next = withUpdatedImageSourceMeta(meta, 'featured_fallback');
		expect(next).toEqual({
			copySource: PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK,
			imageSource: 'featured',
			fallbackReason: 'http_503',
		});
	});
});
