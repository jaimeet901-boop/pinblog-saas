/**
 * Studio pin-copy resolver: AI-first text, with local article fallback on
 * temporary provider failures. Reuses buildLocalPinsFromArticle — no duplicate synthesizer.
 */

import { buildLocalPinsFromArticle } from '@/lib/featuredPinLocal';
import { classifyTextProviderError } from '@/lib/textProviderErrors';
import {
	extractSourceIngredientsFromArticle,
	resolvePinIngredients,
} from '@/lib/pinIngredients.js';

export const PIN_COPY_SOURCE = Object.freeze({
	AI: 'ai',
	LOCAL_FEATURED: 'local_featured',
	LOCAL_TEXT_FALLBACK: 'local_text_fallback',
	LOCAL_EMPTY_PARSE: 'local_empty_parse',
});

/** Analytics / support image category (distinct from operational imageSource persistence values). */
export const PIN_IMAGE_SOURCE_KIND = Object.freeze({
	AI: 'ai',
	FEATURED: 'featured',
});

/**
 * Map operational imageSource (draft/UI) → analytics imageSource kind.
 * @param {string} imageSource
 * @returns {'ai'|'featured'}
 */
export function toAnalyticsImageSource(imageSource) {
	const raw = String(imageSource || '').trim().toLowerCase();
	if (raw === 'ai' || raw === 'ai_generated') return PIN_IMAGE_SOURCE_KIND.AI;
	return PIN_IMAGE_SOURCE_KIND.FEATURED;
}

/**
 * Build the internal transparency record (not shown in normal UI).
 * @param {{ copySource: string, imageSource?: string, fallbackReason?: string|null }} input
 */
export function buildPinGenerationMeta({
	copySource,
	imageSource = PIN_IMAGE_SOURCE_KIND.AI,
	fallbackReason = null,
} = {}) {
	const kind = (imageSource === PIN_IMAGE_SOURCE_KIND.AI || imageSource === PIN_IMAGE_SOURCE_KIND.FEATURED)
		? imageSource
		: toAnalyticsImageSource(imageSource);
	return {
		copySource: String(copySource || ''),
		imageSource: kind,
		fallbackReason: fallbackReason ? String(fallbackReason) : null,
	};
}

function attachResolvedIngredients(pins, article) {
	const sourceIngredients = extractSourceIngredientsFromArticle(article);
	return (Array.isArray(pins) ? pins : []).map((pin) => ({
		...pin,
		ingredients: resolvePinIngredients({
			sourceIngredients,
			aiIngredients: pin?.ingredients,
		}),
	}));
}

/**
 * Resolve pin copy for one article.
 * Text-only: title, description, SEO, keywords, imagePrompt.
 * imageMode is ignored here — image decisions belong to the image pipeline.
 *
 * @param {object} args
 * @param {'generate_ai'|'use_featured'|string} [args.imageMode] — legacy; not used for copy routing
 * @param {object} args.article
 * @param {number} args.count
 * @param {object} [args.panel]
 * @param {object|null} [args.analysis]
 * @param {(prompt: string) => Promise<{ text: string }>} args.generateText
 * @param {() => string} args.buildPrompt
 * @param {(text: string) => any[]} args.parsePins
 * @returns {Promise<{
 *   pins: object[],
 *   copySource: string,
 *   imageSource: 'ai'|'featured',
 *   fallbackReason: string|null,
 *   meta: { copySource: string, imageSource: string, fallbackReason: string|null },
 * }>}
 */
export async function resolveStudioPinCopy({
	imageMode,
	article,
	count = 1,
	panel = {},
	analysis = null,
	generateText,
	buildPrompt,
	parsePins,
} = {}) {
	const n = Math.max(1, Number(count) || 1);

	const localPins = () => attachResolvedIngredients(buildLocalPinsFromArticle({
		article,
		count: n,
		panel,
		analysis,
	}), article);

	try {
		const prompt = typeof buildPrompt === 'function' ? buildPrompt() : '';
		const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
			? `ai-pin-copy:${crypto.randomUUID()}`
			: `ai-pin-copy:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		const { text } = await generateText(prompt, {
			creditFeature: 'ai_pin_copy',
			idempotencyKey,
		});
		const parsed = typeof parsePins === 'function' ? parsePins(text) : [];
		const list = Array.isArray(parsed) ? parsed.filter(Boolean) : [];

		if (list.length === 0) {
			const pins = localPins();
			const meta = buildPinGenerationMeta({
				copySource: PIN_COPY_SOURCE.LOCAL_EMPTY_PARSE,
				imageSource: PIN_IMAGE_SOURCE_KIND.AI,
				fallbackReason: 'empty_ai_response',
			});
			return {
				pins,
				copySource: meta.copySource,
				imageSource: meta.imageSource,
				fallbackReason: meta.fallbackReason,
				meta,
			};
		}

		const meta = buildPinGenerationMeta({
			copySource: PIN_COPY_SOURCE.AI,
			imageSource: PIN_IMAGE_SOURCE_KIND.AI,
			fallbackReason: null,
		});
		return {
			pins: attachResolvedIngredients(list.slice(0, n), article),
			copySource: meta.copySource,
			imageSource: meta.imageSource,
			fallbackReason: meta.fallbackReason,
			meta,
		};
	} catch (error) {
		const classified = classifyTextProviderError(error);
		if (!classified.temporary) {
			throw error;
		}

		const pins = localPins();
		const meta = buildPinGenerationMeta({
			copySource: PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK,
			imageSource: PIN_IMAGE_SOURCE_KIND.AI,
			fallbackReason: classified.category,
		});
		return {
			pins,
			copySource: meta.copySource,
			imageSource: meta.imageSource,
			fallbackReason: meta.fallbackReason,
			meta,
		};
	}
}

/**
 * After the image pipeline finishes, refresh analytics imageSource on meta
 * without changing copySource / fallbackReason.
 */
export function withUpdatedImageSourceMeta(meta, operationalImageSource) {
	const base = meta && typeof meta === 'object' ? meta : {};
	return buildPinGenerationMeta({
		copySource: base.copySource || '',
		imageSource: toAnalyticsImageSource(operationalImageSource),
		fallbackReason: base.fallbackReason ?? null,
	});
}
