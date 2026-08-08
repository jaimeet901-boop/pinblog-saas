import { describe, it, expect } from 'vitest';

import {
	mergePromptSettings,
	normalizeStudioPromptChannel,
	resolveChannelPromptPack,
	resolvePromptPack,
} from '@/lib/studio/promptPacks';
import {
	buildFacebookPostPromptFromConfig,
	buildLegacyPinterestPinPromptFromConfig,
	buildPinPromptFromConfig,
} from '@/lib/aiPinsWorkspaceConfig';

const sampleArticle = {
	title: 'Best Chocolate Cake',
	metaDescription: 'Rich and gooey dessert',
	url: 'https://example.com/cake',
	category: 'Dessert',
	featuredImage: 'https://example.com/cake.jpg',
};

const samplePanel = {
	language: 'English',
	targetAudience: 'Home bakers',
	toneOfVoice: 'Warm',
	style: 'dessert',
	pinTitle: '',
	pinDescription: '',
	textOverlay: '',
};

const sampleConfig = {
	prompts: {
		pinSystem: 'Custom Pinterest system',
		pinUser: 'Custom Pinterest user',
		imageSystem: 'Custom Pinterest image',
		packs: {
			facebook: {
				copySystem: 'Custom Facebook system',
				copyUser: 'Custom Facebook user',
			},
		},
	},
};

describe('normalizeStudioPromptChannel', () => {
	it('defaults to pinterest', () => {
		expect(normalizeStudioPromptChannel()).toBe('pinterest');
		expect(normalizeStudioPromptChannel('')).toBe('pinterest');
	});

	it('accepts facebook', () => {
		expect(normalizeStudioPromptChannel('facebook')).toBe('facebook');
	});
});

describe('resolveChannelPromptPack', () => {
	it('resolves pinterest from legacy flat keys', () => {
		const pack = resolveChannelPromptPack(sampleConfig, 'pinterest');
		expect(pack.channel).toBe('pinterest');
		expect(pack.copySystem).toBe('Custom Pinterest system');
		expect(pack.analyzeHints.network).toBe('Pinterest');
	});

	it('resolves facebook pack with workspace overrides', () => {
		const pack = resolvePromptPack(sampleConfig, 'facebook');
		expect(pack.channel).toBe('facebook');
		expect(pack.copySystem).toBe('Custom Facebook system');
		expect(pack.copyUser).toBe('Custom Facebook user');
		expect(pack.analyzeHints.itemNoun).toBe('post');
	});
});

describe('mergePromptSettings', () => {
	it('deep-merges analyzeHints for facebook', () => {
		const merged = mergePromptSettings({}, {
			packs: {
				facebook: {
					analyzeHints: { defaultCta: 'Shop now' },
				},
			},
		});
		expect(merged.packs.facebook.analyzeHints.defaultCta).toBe('Shop now');
		expect(merged.packs.facebook.analyzeHints.network).toBe('Facebook');
	});
});

describe('buildPinPromptFromConfig', () => {
	it('preserves legacy pinterest prompt when channel omitted', () => {
		const legacy = buildLegacyPinterestPinPromptFromConfig({
			config: sampleConfig,
			article: sampleArticle,
			count: 3,
			panel: samplePanel,
		});
		const routed = buildPinPromptFromConfig({
			config: sampleConfig,
			article: sampleArticle,
			count: 3,
			panel: samplePanel,
		});

		expect(routed).toBe(legacy);
		expect(routed).toContain('Custom Pinterest system');
		expect(routed).toContain('Generate exactly 3 pins.');
		expect(routed).toContain('background photo prompt ONLY');
		expect(routed).not.toContain('Facebook Page');
	});

	it('builds facebook post prompt with pack strings', () => {
		const prompt = buildFacebookPostPromptFromConfig({
			config: sampleConfig,
			article: sampleArticle,
			count: 2,
			panel: samplePanel,
		});

		expect(prompt).toContain('Custom Facebook system');
		expect(prompt).toContain('Custom Facebook user');
		expect(prompt).toContain('Generate exactly 2 posts.');
		expect(prompt).toContain('1200x630');
		expect(prompt).toContain('landscape Facebook link-post');
		expect(prompt).not.toContain('Generate exactly 2 pins.');
	});

	it('routes facebook channel through facebook builder', () => {
		const prompt = buildPinPromptFromConfig({
			config: sampleConfig,
			article: sampleArticle,
			count: 1,
			panel: samplePanel,
			channel: 'facebook',
		});

		expect(prompt).toContain('Custom Facebook system');
		expect(prompt).toContain('Facebook Page art director');
	});
});
