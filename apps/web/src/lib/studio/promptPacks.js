/**
 * Channel-keyed studio prompt packs (F6-2) — web resolver.
 * Pinterest resolves through legacy flat keys for backward compatibility.
 */

import {
	DEFAULT_FLAT_PROMPTS,
	FACEBOOK_PROMPT_PACK_DEFAULTS,
	PINTEREST_PROMPT_PACK_HINTS,
} from './channelDefaults.js';

export const STUDIO_PROMPT_CHANNELS = Object.freeze(['pinterest', 'facebook']);

export function normalizeStudioPromptChannel(value) {
	const channel = String(value || 'pinterest').trim().toLowerCase();
	return channel === 'facebook' ? 'facebook' : 'pinterest';
}

function mergeAnalyzeHints(base, override) {
	if (!override || typeof override !== 'object') return { ...base };
	return { ...base, ...override };
}

function mergePromptPack(base, override) {
	if (!override || typeof override !== 'object') {
		return {
			...base,
			analyzeHints: { ...(base.analyzeHints || {}) },
		};
	}
	return {
		...base,
		...override,
		analyzeHints: mergeAnalyzeHints(base.analyzeHints, override.analyzeHints),
	};
}

export function mergePromptSettings(defaults, overrides = {}) {
	const base = defaults && typeof defaults === 'object' ? defaults : DEFAULT_FLAT_PROMPTS;
	const extra = overrides && typeof overrides === 'object' ? overrides : {};
	const merged = {
		...DEFAULT_FLAT_PROMPTS,
		...base,
		...extra,
	};
	merged.packs = {
		pinterest: mergePromptPack(
			base.packs?.pinterest || { analyzeHints: { ...PINTEREST_PROMPT_PACK_HINTS } },
			extra.packs?.pinterest,
		),
		facebook: mergePromptPack(
			base.packs?.facebook || {
				copySystem: FACEBOOK_PROMPT_PACK_DEFAULTS.copySystem,
				copyUser: FACEBOOK_PROMPT_PACK_DEFAULTS.copyUser,
				imageSystem: FACEBOOK_PROMPT_PACK_DEFAULTS.imageSystem,
				analyzeSystem: FACEBOOK_PROMPT_PACK_DEFAULTS.analyzeSystem,
				analyzeHints: { ...FACEBOOK_PROMPT_PACK_DEFAULTS.analyzeHints },
			},
			extra.packs?.facebook,
		),
	};
	return merged;
}

function legacyPinterestDefaults(prompts = {}) {
	return {
		copySystem: prompts.pinSystem || DEFAULT_FLAT_PROMPTS.pinSystem,
		copyUser: prompts.pinUser || DEFAULT_FLAT_PROMPTS.pinUser,
		imageSystem: prompts.imageSystem || DEFAULT_FLAT_PROMPTS.imageSystem,
		analyzeSystem: 'You are a Pinterest SEO strategist. Reply with JSON only.',
		analyzeHints: { ...PINTEREST_PROMPT_PACK_HINTS },
	};
}

/**
 * Resolve effective prompt pack for a channel from workspace config prompts.
 *
 * @param {object|null|undefined} configOrPrompts - workspace config or prompts object
 * @param {string} channel
 */
export function resolveChannelPromptPack(configOrPrompts, channel) {
	const normalized = normalizeStudioPromptChannel(channel);
	const rawPrompts = configOrPrompts?.prompts && typeof configOrPrompts.prompts === 'object'
		? configOrPrompts.prompts
		: (configOrPrompts && typeof configOrPrompts === 'object' ? configOrPrompts : {});
	const merged = mergePromptSettings(DEFAULT_FLAT_PROMPTS, rawPrompts);
	const legacy = legacyPinterestDefaults(merged);

	if (normalized === 'facebook') {
		const pack = mergePromptPack(
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

	const pinterestPack = mergePromptPack(
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

export function resolvePromptPack(config, channel) {
	return resolveChannelPromptPack(config, channel);
}
