import { describe, expect, it, vi } from 'vitest';
import {
	PIN_COPY_SOURCE,
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

	it('still generates AI copy when imageMode is use_featured (legacy param ignored)', async () => {
		const generateText = vi.fn(async () => ({
			text: '{"pins":[{"title":"AI Title","description":"d","overlayText":"Go","imagePrompt":"prompt"}]}',
		}));
		const result = await resolveStudioPinCopy({
			imageMode: 'use_featured',
			article,
			count: 1,
			panel: {},
			analysis: null,
			generateText,
			buildPrompt: () => 'prompt',
			parsePins: (text) => JSON.parse(text).pins,
		});
		expect(generateText).toHaveBeenCalled();
		expect(result.copySource).toBe(PIN_COPY_SOURCE.AI);
		expect(result.imageSource).toBe('ai');
		expect(result.fallbackReason).toBeNull();
		expect(result.pins).toHaveLength(1);
		expect(result.pins[0].imagePrompt).toBe('prompt');
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
		expect(result.pins[0].ingredients).toBe('');
	});

	it('validates AI ingredients against source in the same generateText call (no second request)', async () => {
		const generateText = vi.fn(async () => ({
			text: JSON.stringify({
				pins: [{
					title: 'Pizza Bowl',
					description: 'High protein',
					overlayText: 'Save',
					ingredients: ['Cottage cheese', 'Marinara sauce', 'Invented truffle oil'],
				}],
			}),
		}));
		const withSource = {
			...article,
			sourceIngredients: [
				'1 cup cottage cheese (full-fat or low-fat; small-curd works best)',
				'¼ cup pizza or marinara sauce',
				'½ cup shredded mozzarella cheese, divided',
			],
		};
		const result = await resolveStudioPinCopy({
			imageMode: 'generate_ai',
			article: withSource,
			count: 1,
			panel: {},
			generateText,
			buildPrompt: () => 'prompt',
			parsePins: (text) => JSON.parse(text).pins,
		});
		expect(generateText).toHaveBeenCalledTimes(1);
		expect(result.pins[0].ingredients).toContain('cottage cheese');
		expect(result.pins[0].ingredients.toLowerCase()).not.toContain('truffle');
	});

	it('keeps validated condensed ingredients from the single AI response', async () => {
		const generateText = vi.fn(async () => ({
			text: JSON.stringify({
				pins: [{
					title: 'Pizza Bowl',
					description: 'High protein',
					overlayText: 'Save',
					ingredients: ['Cottage cheese', 'Marinara sauce', 'Mozzarella'],
				}],
			}),
		}));
		const withSource = {
			...article,
			sourceIngredients: [
				'1 cup cottage cheese (full-fat or low-fat; small-curd works best)',
				'¼ cup pizza or marinara sauce',
				'½ cup shredded mozzarella cheese, divided',
			],
		};
		const result = await resolveStudioPinCopy({
			article: withSource,
			count: 1,
			generateText,
			buildPrompt: () => 'prompt',
			parsePins: (text) => JSON.parse(text).pins,
		});
		expect(generateText).toHaveBeenCalledTimes(1);
		expect(result.pins[0].ingredients.split('\n')).toEqual([
			'Cottage cheese',
			'Marinara sauce',
			'Mozzarella',
		]);
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
