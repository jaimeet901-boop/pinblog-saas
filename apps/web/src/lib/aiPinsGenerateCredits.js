/**
 * AI Pins Generate estimate and wallet guard.
 * Mirrors backend DEFAULT_CREDIT_COSTS (ai_pin_copy: 1, ai_image: 1).
 * Do not use images.estimateCreditsPerAiPin / creditHint as the Generate cost.
 */

export const AI_PIN_COPY_CREDIT_COST = 1;
export const AI_IMAGE_CREDIT_COST = 1;

export const INSUFFICIENT_CREDITS_TOAST = Object.freeze({
	title: 'Insufficient credits',
	description: 'Not enough workspace credits to generate these pins. Add credits or choose Featured / fewer pins.',
});

function positiveCount(value, fallback = 1) {
	const n = Number(value);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.floor(n);
}

export function isFeaturedGenerateMode(imageMode) {
	return String(imageMode || '').trim().toLowerCase() === 'use_featured';
}

/**
 * Generate cost = articles × ai_pin_copy + (AI-mode pins × ai_image).
 * Copy is per article, not per pin. Featured excludes ai_image.
 */
export function estimatePinCredits({
	imageMode,
	quality,
	pinCount,
	count,
	articleCount,
	articleFactor = 1,
} = {}) {
	const mode = imageMode || quality?.imageMode;
	const articles = positiveCount(articleCount ?? articleFactor, 1);
	const pinsPerArticle = positiveCount(pinCount ?? count, 1);
	const copyCredits = articles * AI_PIN_COPY_CREDIT_COST;
	const aiPins = isFeaturedGenerateMode(mode) ? 0 : articles * pinsPerArticle;
	const imageCredits = aiPins * AI_IMAGE_CREDIT_COST;
	return copyCredits + imageCredits;
}

export function canGenerateWithCredits(remaining, requiredCredits) {
	const have = Number(remaining);
	const need = Number(requiredCredits);
	if (!Number.isFinite(have) || !Number.isFinite(need)) return false;
	return have >= need;
}

export function isInsufficientCreditsError(error) {
	const status = Number(error?.status || error?.statusCode || 0);
	const code = String(error?.errorCode || '').toUpperCase();
	if (status === 402 || code === 'INSUFFICIENT_CREDITS') return true;
	return /\bINSUFFICIENT_CREDITS\b/i.test(String(error?.message || ''));
}
