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

export function matchPreferredProvider(providers, preferred) {
	const needle = String(preferred || '').trim().toLowerCase();
	if (!needle) return null;
	const list = Array.isArray(providers) ? providers : [];
	return list.find((item) => {
		const code = String(item?.code || '').toLowerCase();
		const name = String(item?.name || '').toLowerCase();
		return code === needle
			|| name === needle
			|| (needle.length >= 3 && (name.includes(needle) || needle.includes(code)));
	}) || null;
}
