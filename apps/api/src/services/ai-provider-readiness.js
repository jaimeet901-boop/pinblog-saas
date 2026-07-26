/** Pure readiness helpers for Admin AI providers (no PocketBase I/O). */

export function providerHasCredentials(dto) {
	return Boolean(dto?.config?.hasApiKey || dto?.config?.hasSecretKey);
}

/** Usable for workspace modules: explicitly enabled + credentials present. */
export function isProviderConfigured(dto) {
	return Boolean(dto?.enabled) && providerHasCredentials(dto);
}

/** Image-oriented catalog codes (not used for text/pin copy generation). */
export function isImageOrientedProvider(code) {
	const normalized = String(code || '').trim().toLowerCase();
	return normalized === 'fal' || normalized === 'flux' || normalized === 'replicate';
}

export function isTextOrientedProvider(code) {
	return !isImageOrientedProvider(code);
}

export const SUPPORTED_IMAGE_PROVIDER_CODES = new Set(['openai', 'fal', 'flux', 'gemini']);

/** Alias normalization only — never maps gemini↔fal. */
export function normalizeImageProviderAlias(code) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!normalized) return '';
	if (normalized === 'flux' || normalized === 'fal.ai' || normalized === 'falai') return 'fal';
	if (
		normalized === 'google'
		|| normalized === 'google gemini'
		|| normalized === 'gemini.ai'
	) return 'gemini';
	return normalized;
}

export function isSupportedImageProviderCode(code) {
	const normalized = normalizeImageProviderAlias(code);
	return Boolean(normalized) && (
		SUPPORTED_IMAGE_PROVIDER_CODES.has(normalized)
		|| SUPPORTED_IMAGE_PROVIDER_CODES.has(String(code || '').trim().toLowerCase())
	);
}

/**
 * Exact/alias match only for platform default labels.
 * Prefer exact code or exact name; never cross-map gemini to fal via loose includes().
 */
export function matchPreferredProvider(providers, preferred) {
	const needle = String(preferred || '').trim().toLowerCase();
	if (!needle) return null;
	const list = Array.isArray(providers) ? providers : [];

	const exactCode = list.find((item) => String(item?.code || '').toLowerCase() === needle);
	if (exactCode) return exactCode;

	const exactName = list.find((item) => String(item?.name || '').toLowerCase() === needle);
	if (exactName) return exactName;

	const alias = normalizeImageProviderAlias(needle);
	if (alias && alias !== needle) {
		const aliased = list.find((item) => String(item?.code || '').toLowerCase() === alias);
		if (aliased) return aliased;
	}

	// Soft match: name starts with / equals preferred token (e.g. "Fal" → "Fal.ai")
	return list.find((item) => {
		const name = String(item?.name || '').toLowerCase();
		const code = String(item?.code || '').toLowerCase();
		if (needle.length < 3) return false;
		return name.startsWith(needle) || needle.startsWith(name.split('.')[0]) || needle === code;
	}) || null;
}
