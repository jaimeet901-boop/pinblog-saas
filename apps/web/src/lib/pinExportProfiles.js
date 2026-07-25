/**
 * Export profiles — canonical output sizes for social platforms.
 * Export engine only; no React / editor coupling.
 */

export const EXPORT_PROFILE_IDS = Object.freeze([
	'pinterest_standard',
	'pinterest_long',
	'instagram_square',
	'instagram_portrait',
	'facebook_post',
	'facebook_story',
	'custom',
]);

/** @type {Record<string, object>} */
export const EXPORT_PROFILES = Object.freeze({
	pinterest_standard: {
		id: 'pinterest_standard',
		label: 'Pinterest Standard',
		width: 1000,
		height: 1500,
		aspectRatio: '2:3',
		defaultFormat: 'png',
		defaultDpi: 72,
		supportsTransparency: true,
	},
	pinterest_long: {
		id: 'pinterest_long',
		label: 'Pinterest Long',
		width: 1000,
		height: 2100,
		aspectRatio: '10:21',
		defaultFormat: 'png',
		defaultDpi: 72,
		supportsTransparency: true,
	},
	instagram_square: {
		id: 'instagram_square',
		label: 'Instagram Square',
		width: 1080,
		height: 1080,
		aspectRatio: '1:1',
		defaultFormat: 'png',
		defaultDpi: 72,
		supportsTransparency: false,
	},
	instagram_portrait: {
		id: 'instagram_portrait',
		label: 'Instagram Portrait',
		width: 1080,
		height: 1350,
		aspectRatio: '4:5',
		defaultFormat: 'png',
		defaultDpi: 72,
		supportsTransparency: false,
	},
	facebook_post: {
		id: 'facebook_post',
		label: 'Facebook Post',
		width: 1200,
		height: 630,
		aspectRatio: '1.91:1',
		defaultFormat: 'png',
		defaultDpi: 72,
		supportsTransparency: false,
	},
	facebook_story: {
		id: 'facebook_story',
		label: 'Facebook Story',
		width: 1080,
		height: 1920,
		aspectRatio: '9:16',
		defaultFormat: 'png',
		defaultDpi: 72,
		supportsTransparency: false,
	},
	custom: {
		id: 'custom',
		label: 'Custom',
		width: 1000,
		height: 1500,
		aspectRatio: 'custom',
		defaultFormat: 'png',
		defaultDpi: 72,
		supportsTransparency: true,
	},
});

export function getExportProfile(profileId = 'pinterest_standard') {
	const id = String(profileId || 'pinterest_standard');
	return EXPORT_PROFILES[id] || EXPORT_PROFILES.pinterest_standard;
}

export function listExportProfiles() {
	return EXPORT_PROFILE_IDS.map((id) => ({ ...EXPORT_PROFILES[id] }));
}
