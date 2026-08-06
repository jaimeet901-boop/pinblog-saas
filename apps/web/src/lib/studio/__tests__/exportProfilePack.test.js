import { describe, it, expect } from 'vitest';

import { AI_FACEBOOK_PAGES_PRODUCT, AI_PINS_PRODUCT } from '@/lib/studio/products';
import {
	FACEBOOK_STUDIO_ASPECT_RATIOS,
	PINTEREST_STUDIO_ASPECT_RATIOS,
	resolveDefaultAspectRatioIdForProduct,
	resolveDefaultExportProfileId,
	resolveExportProfileIdForAspect,
	resolveExportProfilesForProduct,
	resolvePreviewAspectClass,
} from '@/lib/studio/exportProfilePack';

describe('resolveDefaultExportProfileId', () => {
	it('defaults pinterest to pinterest_standard', () => {
		expect(resolveDefaultExportProfileId(AI_PINS_PRODUCT)).toBe('pinterest_standard');
	});

	it('defaults facebook to facebook_post', () => {
		expect(resolveDefaultExportProfileId(AI_FACEBOOK_PAGES_PRODUCT)).toBe('facebook_post');
	});
});

describe('resolveExportProfilesForProduct', () => {
	it('lists facebook export profiles for facebook product', () => {
		const profiles = resolveExportProfilesForProduct(AI_FACEBOOK_PAGES_PRODUCT);
		expect(profiles.map((item) => item.id)).toEqual(['facebook_post', 'facebook_story']);
	});

	it('lists pinterest_standard for pinterest product', () => {
		const profiles = resolveExportProfilesForProduct(AI_PINS_PRODUCT);
		expect(profiles.map((item) => item.id)).toEqual(['pinterest_standard']);
	});
});

describe('resolveExportProfileIdForAspect', () => {
	it('maps pinterest aspect ids to pinterest_standard', () => {
		expect(resolveExportProfileIdForAspect(AI_PINS_PRODUCT, 'pinterest')).toBe('pinterest_standard');
	});

	it('maps facebook link post to facebook_post', () => {
		expect(resolveExportProfileIdForAspect(AI_FACEBOOK_PAGES_PRODUCT, 'link_post')).toBe('facebook_post');
	});

	it('maps facebook story to facebook_story', () => {
		expect(resolveExportProfileIdForAspect(AI_FACEBOOK_PAGES_PRODUCT, 'story')).toBe('facebook_story');
	});
});

describe('resolveDefaultAspectRatioIdForProduct', () => {
	it('preserves pinterest config ratio mapping', () => {
		expect(resolveDefaultAspectRatioIdForProduct(AI_PINS_PRODUCT, {
			pinterest: { imageRatio: '2/3' },
		})).toBe('pinterest');
	});

	it('defaults facebook to link_post', () => {
		expect(resolveDefaultAspectRatioIdForProduct(AI_FACEBOOK_PAGES_PRODUCT, {})).toBe('link_post');
	});
});

describe('resolvePreviewAspectClass', () => {
	it('uses landscape preview for facebook link post', () => {
		expect(resolvePreviewAspectClass(AI_FACEBOOK_PAGES_PRODUCT, 'link_post')).toBe('aspect-[1200/630]');
	});

	it('uses tall preview for pinterest', () => {
		expect(resolvePreviewAspectClass(AI_PINS_PRODUCT, 'pinterest')).toBe('aspect-[2/3]');
	});
});

describe('aspect ratio presets', () => {
	it('keeps pinterest presets unchanged', () => {
		expect(PINTEREST_STUDIO_ASPECT_RATIOS.map((item) => item.id)).toEqual([
			'tall', 'pinterest', 'classic', 'custom',
		]);
		expect(PINTEREST_STUDIO_ASPECT_RATIOS.every((item) => item.exportProfileId === 'pinterest_standard')).toBe(true);
	});

	it('defines facebook link post and story presets', () => {
		expect(FACEBOOK_STUDIO_ASPECT_RATIOS.map((item) => item.id)).toEqual(['link_post', 'story']);
	});
});
