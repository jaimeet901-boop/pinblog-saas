/**
 * Channel-keyed studio prompt packs (F6-2).
 * Pinterest resolves through legacy flat keys for backward compatibility.
 */

import { defaultPrompts, mergePromptSettings } from '../workspace-config-helpers.js';
import { FACEBOOK_PROMPT_PACK_DEFAULTS, PINTEREST_PROMPT_PACK_HINTS } from './channel-defaults.js';

export const STUDIO_PROMPT_CHANNELS = Object.freeze(['pinterest', 'facebook']);

export function normalizeStudioPromptChannel(value) {
	const channel = String(value || 'pinterest').trim().toLowerCase();
	return channel === 'facebook' ? 'facebook' : 'pinterest';
}

function legacyPinterestDefaults() {
	const prompts = defaultPrompts();
	return {
		copySystem: prompts.pinSystem,
		copyUser: prompts.pinUser,
		imageSystem: prompts.imageSystem,
		analyzeSystem: 'You are a Pinterest SEO strategist. Reply with JSON only.',
		analyzeHints: { ...PINTEREST_PROMPT_PACK_HINTS },
	};
}

function mergeAnalyzeHints(base, override) {
	if (!override || typeof override !== 'object') return { ...base };
	return { ...base, ...override };
}

function mergePackDefaults(base, override) {
	if (!override || typeof override !== 'object') return { ...base };
	return {
		...base,
		...override,
		analyzeHints: mergeAnalyzeHints(base.analyzeHints, override.analyzeHints),
	};
}

/**
 * Merge platform/workspace prompt settings including nested packs.
 */
export function mergePromptSettingsDeep(overrides = {}) {
	return mergePromptSettings(defaultPrompts(), overrides);
}

/**
 * Resolve effective prompt pack for a channel from merged prompt settings.
 *
 * @param {object|null|undefined} prompts
 * @param {string} channel
 */
export function resolveChannelPromptPack(prompts, channel) {
	const normalized = normalizeStudioPromptChannel(channel);
	const merged = mergePromptSettingsDeep(prompts && typeof prompts === 'object' ? prompts : {});
	const legacy = legacyPinterestDefaults();

	if (normalized === 'facebook') {
		const pack = mergePackDefaults(
			{
				copySystem: FACEBOOK_PROMPT_PACK_DEFAULTS.copySystem,
				copyUser: FACEBOOK_PROMPT_PACK_DEFAULTS.copyUser,
				imageSystem: FACEBOOK_PROMPT_PACK_DEFAULTS.imageSystem,
				analyzeSystem: FACEBOOK_PROMPT_PACK_DEFAULTS.analyzeSystem,
				analyzeHints: { ...FACEBOOK_PROMPT_PACK_DEFAULTS.analyzeHints },
			},
			merged.packs?.facebook,
		);
		return { channel: 'facebook', ...pack };
	}

	const pinterestPack = mergePackDefaults(
		{
			copySystem: merged.pinSystem || legacy.copySystem,
			copyUser: merged.pinUser || legacy.copyUser,
			imageSystem: merged.imageSystem || legacy.imageSystem,
			analyzeSystem: legacy.analyzeSystem,
			analyzeHints: { ...PINTEREST_PROMPT_PACK_HINTS },
		},
		merged.packs?.pinterest,
	);

	return { channel: 'pinterest', ...pinterestPack };
}

export async function loadMergedPromptSettings(getPlatformSettings) {
	try {
		const loader = getPlatformSettings || (await import('../platform-settings.js')).getPlatformSettings;
		const { settings } = await loader();
		return mergePromptSettingsDeep(settings?.prompts || {});
	} catch {
		return mergePromptSettingsDeep({});
	}
}

export async function resolvePromptPackForRequest({ channel, prompts } = {}) {
	const merged = prompts && typeof prompts === 'object'
		? mergePromptSettingsDeep(prompts)
		: await loadMergedPromptSettings();
	return resolveChannelPromptPack(merged, channel);
}
