/**
 * Gemini model policy for the Generative Language API.
 * Admin AI Models remain the source of truth; these constants only cover
 * retirement filtering and last-resort fallback when no Admin model is usable.
 */

/** Current recommended stable Flash model for new Gemini API keys. */
export const GEMINI_STABLE_FALLBACK_MODEL = 'gemini-3.5-flash';

/** Model IDs that must not be selected for new traffic. */
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
	// Catch versioned retired ids like gemini-2.5-flash-001
	return [...GEMINI_RETIRED_MODEL_IDS].some((retired) => (
		normalized === retired || normalized.startsWith(`${retired}-`)
	));
}
