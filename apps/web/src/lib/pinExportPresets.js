/**
 * Named export presets — reusable setting bundles on top of profiles.
 */

import { getExportProfile } from './pinExportProfiles.js';

/** @type {Map<string, object>} */
const customPresets = new Map();

const BUILTIN_PRESETS = Object.freeze({
	pinterest_png_hq: {
		id: 'pinterest_png_hq',
		label: 'Pinterest PNG (HQ)',
		profileId: 'pinterest_standard',
		format: 'png',
		settings: {
			quality: 1,
			dpi: 72,
			background: '#ffffff',
			transparent: false,
			compression: 6,
		},
		builtin: true,
	},
	pinterest_png_transparent: {
		id: 'pinterest_png_transparent',
		label: 'Pinterest PNG (Transparent)',
		profileId: 'pinterest_standard',
		format: 'png',
		settings: {
			quality: 1,
			dpi: 72,
			background: 'transparent',
			transparent: true,
			compression: 6,
		},
		builtin: true,
	},
	instagram_square_png: {
		id: 'instagram_square_png',
		label: 'Instagram Square PNG',
		profileId: 'instagram_square',
		format: 'png',
		settings: {
			quality: 0.92,
			dpi: 72,
			background: '#ffffff',
			transparent: false,
			compression: 6,
		},
		builtin: true,
	},
	story_png: {
		id: 'story_png',
		label: 'Story PNG',
		profileId: 'facebook_story',
		format: 'png',
		settings: {
			quality: 0.92,
			dpi: 72,
			background: '#000000',
			transparent: false,
			compression: 6,
		},
		builtin: true,
	},
});

export function listExportPresets() {
	return [
		...Object.values(BUILTIN_PRESETS),
		...customPresets.values(),
	];
}

export function getExportPreset(presetId) {
	if (!presetId) return null;
	return BUILTIN_PRESETS[presetId] || customPresets.get(presetId) || null;
}

/**
 * Register a user/workspace preset without modifying builtins.
 */
export function registerExportPreset(preset) {
	const id = String(preset?.id || '').trim();
	if (!id) throw new Error('preset.id required');
	if (BUILTIN_PRESETS[id]) throw new Error('Cannot overwrite builtin preset');
	const profile = getExportProfile(preset.profileId || 'custom');
	const entry = {
		id,
		label: preset.label || id,
		profileId: profile.id,
		format: preset.format || profile.defaultFormat || 'png',
		settings: { ...(preset.settings || {}) },
		builtin: false,
		source: preset.source || 'user',
	};
	customPresets.set(id, entry);
	return entry;
}

export function resetExportPresetsForTests() {
	customPresets.clear();
}

export function resolvePresetSettings(presetId, overrides = {}) {
	const preset = getExportPreset(presetId);
	const profile = getExportProfile(preset?.profileId || overrides.profileId || 'pinterest_standard');
	return {
		profile,
		preset,
		format: overrides.format || preset?.format || profile.defaultFormat || 'png',
		settings: {
			width: overrides.width ?? profile.width,
			height: overrides.height ?? profile.height,
			dpi: overrides.dpi ?? preset?.settings?.dpi ?? profile.defaultDpi ?? 72,
			quality: overrides.quality ?? preset?.settings?.quality ?? 0.92,
			background: overrides.background ?? preset?.settings?.background ?? '#ffffff',
			transparent: overrides.transparent ?? preset?.settings?.transparent ?? false,
			compression: overrides.compression ?? preset?.settings?.compression ?? 6,
			...((overrides.settings && typeof overrides.settings === 'object') ? overrides.settings : {}),
		},
	};
}
