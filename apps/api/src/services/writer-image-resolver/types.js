/**
 * Writer Image Resolver — shared types and constants.
 * Library-only; no Writer / WP / Pins queue coupling.
 */

/** Max Fal generations per resolveArticleImages call (hard ceiling). */
export const DEFAULT_MAX_FAL_IMAGES = 3;

/** Hard ceiling regardless of context.maxFalImages. */
export const ABSOLUTE_MAX_FAL_IMAGES = 5;

/** Max bytes accepted from Fal adapter output (post-download). */
export const MAX_FAL_IMAGE_BYTES = 12 * 1024 * 1024;

/** Outer timeout around a single Fal generate call (ms). */
export const DEFAULT_FAL_TIMEOUT_MS = 90_000;

/** Pexels search timeout (ms). */
export const DEFAULT_PEXELS_TIMEOUT_MS = 12_000;

/** Bounded Pexels page size. */
export const DEFAULT_PEXELS_PER_PAGE = 8;

/** Minimum long-edge pixels for acceptable stock images. */
export const MIN_STOCK_LONG_EDGE = 800;

/** Minimum deterministic relevance score for stock acceptance. */
export const STOCK_MIN_CONFIDENCE = 0.35;

export const ASSET_STATUS = Object.freeze({
	RESOLVED: 'resolved',
	FAILED: 'failed',
	SKIPPED: 'skipped',
});

export const ASSET_SOURCE = Object.freeze({
	FAL: 'fal',
	NONE: 'none',
	STOCK_PEXELS: 'stock_pexels',
	/** Reserved — not implemented in M2-B */
	STOCK_UNSPLASH: 'stock_unsplash',
});

/**
 * Blog-oriented Fal size for Writer (local to resolver — does not mutate Pins targets).
 * generateWithFal only reads generationTarget.falImageSize.
 */
export const WRITER_BLOG_GENERATION_TARGET = Object.freeze({
	channel: 'writer',
	exportProfileId: 'writer_blog',
	targetWidth: 1200,
	targetHeight: 800,
	aspectRatio: '3:2',
	orientation: 'landscape',
	promptOrientation: 'landscape 3:2 aspect ratio for blog article imagery',
	falImageSize: Object.freeze({ width: 1200, height: 800 }),
});

export const CREDIT_FEATURE_AI_IMAGE = 'ai_image';
export const CREDIT_UNITS_AI_IMAGE = 1;

/**
 * @typedef {{
 *   status: 'resolved'|'failed'|'skipped',
 *   source: string,
 *   slotId: string,
 *   url: string,
 *   width: number|null,
 *   height: number|null,
 *   alt: string,
 *   attribution: string,
 *   license: string,
 *   confidence: number|null,
 *   providerMeta: object,
 *   errorCode?: string,
 *   errorMessage?: string,
 * }} ResolverAsset
 */

/**
 * @param {Partial<ResolverAsset> & { slotId: string }} partial
 * @returns {ResolverAsset}
 */
export function emptyAsset(partial = {}) {
	return {
		status: ASSET_STATUS.SKIPPED,
		source: ASSET_SOURCE.NONE,
		slotId: String(partial.slotId || ''),
		url: '',
		width: null,
		height: null,
		alt: '',
		attribution: '',
		license: '',
		confidence: null,
		providerMeta: {},
		...partial,
	};
}
