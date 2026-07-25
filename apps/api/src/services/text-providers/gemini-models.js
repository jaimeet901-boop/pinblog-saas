/**
 * Gemini model policy for the Generative Language API.
 * Admin AI Models remain the source of truth; these values only cover
 * retirement filtering and last-resort fallback when no Admin model is usable.
 *
 * Override fallbacks without code changes:
 *   GEMINI_STABLE_FALLBACK_MODEL
 *   GEMINI_STABLE_IMAGE_FALLBACK_MODEL
 */

/** Current recommended stable Flash model for new Gemini API keys. */
export const GEMINI_STABLE_FALLBACK_MODEL = String(
	process.env.GEMINI_STABLE_FALLBACK_MODEL || 'gemini-3.5-flash',
).trim();

/**
 * Configurable stable Gemini image fallback (resolver layer only — never the adapter).
 * Used by resolveImageModelIdForProvider when Admin AI Models has no usable image model.
 */
export const GEMINI_STABLE_IMAGE_FALLBACK_MODEL = String(
	process.env.GEMINI_STABLE_IMAGE_FALLBACK_MODEL || 'gemini-2.5-flash-image',
).trim();

/** Model IDs that must not be selected for new text traffic. */
export const GEMINI_RETIRED_MODEL_IDS = new Set([
	'gemini-1.5-pro',
	'gemini-1.5-flash',
	'gemini-1.5-flash-8b',
	'gemini-2.0-flash',
	'gemini-2.0-flash-001',
	'gemini-2.0-flash-exp',
	'gemini-2.0-flash-lite',
	'gemini-2.5-flash',
	'gemini-2.5-pro',
	'gemini-2.5-flash-lite',
]);

export function normalizeGeminiModelId(modelId) {
	return String(modelId || '')
		.trim()
		.replace(/^models\//i, '');
}

export function isRetiredGeminiModel(modelId) {
	const normalized = normalizeGeminiModelId(modelId).toLowerCase();
	if (!normalized) return false;
	if (GEMINI_RETIRED_MODEL_IDS.has(normalized)) return true;
	// Versioned aliases of retired text models (e.g. gemini-2.5-flash-001).
	// Do NOT treat image variants (gemini-2.5-flash-image) as retired.
	for (const retired of GEMINI_RETIRED_MODEL_IDS) {
		if (!normalized.startsWith(`${retired}-`)) continue;
		const suffix = normalized.slice(retired.length + 1);
		if (/^(\d+|exp|preview|lite)(-|$)/.test(suffix)) return true;
	}
	return false;
}
