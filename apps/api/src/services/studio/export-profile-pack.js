/**
 * Studio export profile resolution (F6-3) — pure, no I/O.
 */

export const STUDIO_EXPORT_CHANNELS = Object.freeze(['pinterest', 'facebook']);

export const STUDIO_DEFAULT_EXPORT_PROFILE_BY_CHANNEL = Object.freeze({
	pinterest: 'pinterest_standard',
	facebook: 'facebook_post',
});

export const STUDIO_EXPORT_PROFILE_DIMENSIONS = Object.freeze({
	pinterest_standard: { width: 1000, height: 1500 },
	facebook_post: { width: 1200, height: 630 },
	facebook_story: { width: 1080, height: 1920 },
});

export function normalizeStudioExportChannel(value) {
	const channel = String(value || 'pinterest').trim().toLowerCase();
	return channel === 'facebook' ? 'facebook' : 'pinterest';
}

export function resolveDefaultExportProfileIdForChannel(channel) {
	const normalized = normalizeStudioExportChannel(channel);
	return STUDIO_DEFAULT_EXPORT_PROFILE_BY_CHANNEL[normalized] || 'pinterest_standard';
}

/**
 * Resolve export profile id from channel + optional overrides.
 */
export function resolveStudioExportProfileId({
	channel,
	profileId,
	aspectExportProfileId,
} = {}) {
	const explicit = String(profileId || aspectExportProfileId || '').trim();
	if (explicit) return explicit;
	return resolveDefaultExportProfileIdForChannel(channel);
}

export function resolveStudioExportDimensions(profileId, profiles = STUDIO_EXPORT_PROFILE_DIMENSIONS) {
	const id = String(profileId || 'pinterest_standard');
	return profiles[id] || profiles.pinterest_standard;
}
