import { describe, it, expect } from 'vitest';

import { AI_FACEBOOK_PAGES_PRODUCT, AI_PINS_PRODUCT } from '@/lib/studio/products';
import { resolveStudioAssets } from '@/lib/studio/resolveStudioAssets';

describe('resolveStudioAssets', () => {
	it('resolves pinterest assets with legacy defaults', () => {
		const assets = resolveStudioAssets(AI_PINS_PRODUCT, {
			prompts: { pinSystem: 'Pin system' },
			pinterest: { imageRatio: '2/3' },
		});

		expect(assets.channel).toBe('pinterest');
		expect(assets.defaultExportProfileId).toBe('pinterest_standard');
		expect(assets.defaultAspectRatioId).toBe('pinterest');
		expect(assets.resolveExportProfileIdForAspect('pinterest')).toBe('pinterest_standard');
		expect(assets.resolveExportProfile('pinterest_standard').width).toBe(1000);
		expect(assets.resolveExportProfile('pinterest_standard').height).toBe(1500);
		expect(assets.promptPack.copySystem).toBe('Pin system');
	});

	it('resolves facebook assets with facebook_post default', () => {
		const assets = resolveStudioAssets(AI_FACEBOOK_PAGES_PRODUCT, {});

		expect(assets.channel).toBe('facebook');
		expect(assets.defaultExportProfileId).toBe('facebook_post');
		expect(assets.defaultAspectRatioId).toBe('link_post');
		expect(assets.aspectRatios.map((item) => item.id)).toEqual(['link_post', 'story']);
		expect(assets.resolveExportProfileIdForAspect('link_post')).toBe('facebook_post');
		expect(assets.resolveExportProfile('facebook_post').width).toBe(1200);
		expect(assets.resolveExportProfile('facebook_post').height).toBe(630);
		expect(assets.resolvePreviewAspectClass('story')).toBe('aspect-[9/16]');
	});
});
