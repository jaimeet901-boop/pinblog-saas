/**
 * F6-2 — channel prompt pack resolver tests.
 * Run: node --test src/services/studio/prompt-packs.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { defaultPrompts, mergePromptSettings } from '../workspace-config-helpers.js';
import { FACEBOOK_PROMPT_PACK_DEFAULTS } from './channel-defaults.js';
import {
	mergePromptSettingsDeep,
	normalizeStudioPromptChannel,
	resolveChannelPromptPack,
	STUDIO_PROMPT_CHANNELS,
} from './prompt-packs.js';

describe('normalizeStudioPromptChannel', () => {
	it('defaults empty values to pinterest', () => {
		assert.equal(normalizeStudioPromptChannel(), 'pinterest');
		assert.equal(normalizeStudioPromptChannel(''), 'pinterest');
		assert.equal(normalizeStudioPromptChannel(undefined), 'pinterest');
	});

	it('accepts facebook and maps unknown channels to pinterest', () => {
		assert.equal(normalizeStudioPromptChannel('facebook'), 'facebook');
		assert.equal(normalizeStudioPromptChannel('FACEBOOK'), 'facebook');
		assert.equal(normalizeStudioPromptChannel('instagram'), 'pinterest');
	});

	it('exposes supported channels', () => {
		assert.deepEqual(STUDIO_PROMPT_CHANNELS, ['pinterest', 'facebook']);
	});
});

describe('mergePromptSettings', () => {
	it('merges nested facebook pack overrides without dropping legacy keys', () => {
		const merged = mergePromptSettings(defaultPrompts(), {
			pinSystem: 'Custom Pinterest system',
			packs: {
				facebook: {
					copySystem: 'Custom Facebook system',
					analyzeHints: { defaultCta: 'Shop now' },
				},
			},
		});

		assert.equal(merged.pinSystem, 'Custom Pinterest system');
		assert.equal(merged.packs.facebook.copySystem, 'Custom Facebook system');
		assert.equal(merged.packs.facebook.analyzeHints.defaultCta, 'Shop now');
		assert.equal(merged.packs.facebook.analyzeHints.network, 'Facebook');
		assert.equal(merged.packs.pinterest.analyzeHints.network, 'Pinterest');
	});
});

describe('resolveChannelPromptPack', () => {
	it('resolves pinterest through legacy flat keys unchanged', () => {
		const prompts = {
			pinSystem: 'Legacy pin system prompt',
			pinUser: 'Legacy pin user prompt',
			imageSystem: 'Legacy image system prompt',
		};
		const pack = resolveChannelPromptPack(prompts, 'pinterest');

		assert.equal(pack.channel, 'pinterest');
		assert.equal(pack.copySystem, 'Legacy pin system prompt');
		assert.equal(pack.copyUser, 'Legacy pin user prompt');
		assert.equal(pack.imageSystem, 'Legacy image system prompt');
		assert.equal(pack.analyzeSystem, 'You are a Pinterest SEO strategist. Reply with JSON only.');
		assert.equal(pack.analyzeHints.network, 'Pinterest');
		assert.equal(pack.analyzeHints.imageDimensions, '1000x1500');
	});

	it('resolves facebook defaults when pack is absent', () => {
		const pack = resolveChannelPromptPack({}, 'facebook');

		assert.equal(pack.channel, 'facebook');
		assert.equal(pack.copySystem, FACEBOOK_PROMPT_PACK_DEFAULTS.copySystem);
		assert.equal(pack.copyUser, FACEBOOK_PROMPT_PACK_DEFAULTS.copyUser);
		assert.equal(pack.imageSystem, FACEBOOK_PROMPT_PACK_DEFAULTS.imageSystem);
		assert.equal(pack.analyzeSystem, FACEBOOK_PROMPT_PACK_DEFAULTS.analyzeSystem);
		assert.equal(pack.analyzeHints.itemNoun, 'post');
		assert.equal(pack.analyzeHints.imageDimensions, '1200x630');
	});

	it('merges workspace facebook overrides', () => {
		const pack = resolveChannelPromptPack({
			packs: {
				facebook: {
					copySystem: 'Workspace FB copy',
					analyzeHints: { defaultCta: 'Read more' },
				},
			},
		}, 'facebook');

		assert.equal(pack.copySystem, 'Workspace FB copy');
		assert.equal(pack.analyzeHints.defaultCta, 'Read more');
		assert.equal(pack.analyzeHints.network, 'Facebook');
	});

	it('omitted channel resolves pinterest pack', () => {
		const pack = resolveChannelPromptPack(defaultPrompts());
		assert.equal(pack.channel, 'pinterest');
		assert.match(pack.copySystem, /Pinterest growth strategist/);
	});
});

describe('mergePromptSettingsDeep', () => {
	it('returns fully merged defaults when overrides are empty', () => {
		const merged = mergePromptSettingsDeep({});
		assert.ok(merged.packs.facebook);
		assert.ok(merged.packs.pinterest);
		assert.match(merged.pinSystem, /Pinterest growth strategist/);
	});
});
