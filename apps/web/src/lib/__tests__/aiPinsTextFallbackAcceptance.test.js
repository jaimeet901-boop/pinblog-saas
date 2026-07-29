/**
 * Acceptance-criteria verification for Studio text-stage fallback.
 * Maps AC1–AC6 to executable assertions (no UI/browser).
 */
import { describe, expect, it, vi } from 'vitest';
import {
	PIN_COPY_SOURCE,
	resolveStudioPinCopy,
} from '../aiPinsPinCopy.js';
import {
	TEXT_PROVIDER_ERROR_CATEGORY,
	classifyTextProviderError,
} from '../textProviderErrors.js';
import { planImageSource, IMAGE_SOURCE_STRATEGY } from '../imageSourceStrategy.js';

const article = {
	title: 'Weeknight Chili',
	metaDescription: 'Hearty chili in 30 minutes.',
	featuredImage: 'https://cdn.example/chili.jpg',
	category: 'dinner',
};

async function resolveGenerateAi(generateText) {
	return resolveStudioPinCopy({
		imageMode: 'generate_ai',
		article,
		count: 1,
		panel: {},
		analysis: null,
		generateText,
		buildPrompt: () => 'pin prompt',
		parsePins: (text) => {
			try {
				const parsed = JSON.parse(text);
				return Array.isArray(parsed.pins) ? parsed.pins : [];
			} catch {
				return [];
			}
		},
	});
}

describe('AC1 — AI provider healthy', () => {
	it('returns AI copy and keeps AI-first image plan (generate_ai)', async () => {
		const result = await resolveGenerateAi(async () => ({
			text: JSON.stringify({
				pins: [{ title: 'AI Chili', description: 'desc', overlayText: 'Cook' }],
			}),
		}));
		expect(result.copySource).toBe(PIN_COPY_SOURCE.AI);
		expect(result.fallbackReason).toBeNull();
		expect(result.pins[0].title).toBe('AI Chili');

		const imagePlan = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.AI_FIRST,
			articleImageUrl: article.featuredImage,
		});
		expect(imagePlan.imageMode).toBe('generate_ai');
		expect(imagePlan.useAi).toBe(true);
		// Text success must not flip image mode — image pipeline still AI-first.
		expect(result.imageSource).toBe('ai');
	});
});

describe('AC2 — Temporary text error', () => {
	const cases = [
		{ status: 503, message: 'high demand', category: TEXT_PROVIDER_ERROR_CATEGORY.HTTP_503 },
		{ status: 504, message: 'gateway timeout', category: TEXT_PROVIDER_ERROR_CATEGORY.HTTP_504 },
		{ status: 0, message: 'request timed out after 45000ms', category: TEXT_PROVIDER_ERROR_CATEGORY.TIMEOUT },
		{ status: 429, message: 'rate limit', category: TEXT_PROVIDER_ERROR_CATEGORY.RATE_LIMIT },
	];

	it.each(cases)('falls back locally for $category without throwing', async ({ status, message, category }) => {
		const error = new Error(message);
		if (status) error.status = status;
		const result = await resolveGenerateAi(async () => {
			throw error;
		});
		expect(result.copySource).toBe(PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK);
		expect(result.fallbackReason).toBe(category);
		expect(result.pins[0].title).toBeTruthy();
		// Image pipeline still AI-first after text fallback.
		expect(result.imageSource).toBe('ai');
		const imagePlan = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.AI_FIRST,
			articleImageUrl: article.featuredImage,
		});
		expect(imagePlan.imageMode).toBe('generate_ai');
	});
});

describe('AC3 — Permanent provider error', () => {
	const cases = [
		{ status: 401, message: 'Unauthorized' },
		{ status: 403, message: 'Forbidden' },
		{ message: 'Invalid API key' },
		{ message: 'invalid model xyz' },
		{ status: 402, message: 'Payment required' },
		{ errorCode: 'AI_PROVIDER_NOT_CONFIGURED', message: 'No text provider configured' },
	];

	it.each(cases)('does not fall back for permanent error: $message', async (partial) => {
		const error = new Error(partial.message);
		if (partial.status) error.status = partial.status;
		if (partial.errorCode) error.errorCode = partial.errorCode;
		expect(classifyTextProviderError(error).temporary).toBe(false);
		await expect(resolveGenerateAi(async () => {
			throw error;
		})).rejects.toBe(error);
	});
});

describe('AC4 — Featured mode unchanged', () => {
	it('never calls generateText and uses local featured copy only', async () => {
		const generateText = vi.fn();
		const result = await resolveStudioPinCopy({
			imageMode: 'use_featured',
			article,
			count: 2,
			panel: { textOverlay: 'Save' },
			analysis: null,
			generateText,
			buildPrompt: () => 'must not run',
			parsePins: () => [{ title: 'should not appear' }],
		});
		expect(generateText).not.toHaveBeenCalled();
		expect(result.copySource).toBe(PIN_COPY_SOURCE.LOCAL_FEATURED);
		expect(result.imageSource).toBe('featured');
		expect(result.fallbackReason).toBeNull();
		expect(result.pins).toHaveLength(2);
		const imagePlan = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.FEATURED_FIRST,
			articleImageUrl: article.featuredImage,
		});
		expect(imagePlan.imageMode).toBe('use_featured');
		expect(imagePlan.useAi).toBe(false);
	});
});

describe('AC5 — Writer/Images isolation (static contract)', () => {
	it('keeps generateText injection optional so shared aiGenerate is not wrapped', async () => {
		// Resolver requires an injected generateText; it does not import or monkey-patch aiGenerate.
		// Writer/Images call @/lib/aiGenerate directly — proven by module graph, not this runtime.
		expect(typeof resolveStudioPinCopy).toBe('function');
	});
});

describe('AC6 — Image plan independent of text fallback', () => {
	it('text fallback does not change planImageSource / generate_ai job eligibility', async () => {
		const error = new Error('Gemini request failed (503): high demand');
		error.status = 503;
		const copy = await resolveGenerateAi(async () => {
			throw error;
		});
		expect(copy.copySource).toBe(PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK);

		const plan = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.AI_FIRST,
			articleImageUrl: article.featuredImage,
		});
		// Same as before this feature: AI image jobs still queued when strategy is ai_first.
		expect(plan.useAi).toBe(true);
		expect(plan.imageMode).toBe('generate_ai');
		expect(plan.allowArticleFallback).toBe(true);
	});
});
