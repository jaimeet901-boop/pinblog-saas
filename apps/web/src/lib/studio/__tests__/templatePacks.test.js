import { describe, it, expect } from 'vitest';

import { AI_FACEBOOK_PAGES_PRODUCT, AI_PINS_PRODUCT } from '@/lib/studio/products';
import { listOfficialPinTemplateCatalog } from '@/lib/officialPinTemplateCatalog.generated';
import {
	filterOfficialCatalogForPack,
	filterTemplatesForPack,
	matchesTemplatePackEntry,
	resolveTemplatePack,
	resolveTemplatePackKey,
} from '@/lib/studio/templatePacks';

describe('resolveTemplatePack', () => {
	it('resolves pinterest pack for AI Pins product', () => {
		const pack = resolveTemplatePack(AI_PINS_PRODUCT);
		expect(pack.key).toBe('pinterest');
		expect(pack.canvas).toEqual({ width: 1000, height: 1500 });
		expect(pack.galleryTag).toBe('');
	});

	it('resolves facebook pack for Facebook product', () => {
		const pack = resolveTemplatePack(AI_FACEBOOK_PAGES_PRODUCT);
		expect(pack.key).toBe('facebook');
		expect(pack.galleryTag).toBe('facebook');
		expect(pack.canvas).toEqual({ width: 1200, height: 630 });
	});
});

describe('matchesTemplatePackEntry', () => {
	it('keeps legacy untagged portrait templates in pinterest pack', () => {
		expect(matchesTemplatePackEntry({
			tags: ['hero'],
			configuration: { canvas: { width: 1000, height: 1500 } },
		}, AI_PINS_PRODUCT)).toBe(true);
	});

	it('excludes facebook templates from pinterest pack', () => {
		expect(matchesTemplatePackEntry({
			tags: ['facebook', 'link-post'],
			configuration: { canvas: { width: 1200, height: 630 } },
		}, AI_PINS_PRODUCT)).toBe(false);
	});

	it('includes facebook templates in facebook pack', () => {
		expect(matchesTemplatePackEntry({
			tags: ['facebook', 'link-post'],
			configuration: { canvas: { width: 1200, height: 630 } },
		}, AI_FACEBOOK_PAGES_PRODUCT)).toBe(true);
	});
});

describe('filterOfficialCatalogForPack', () => {
	const catalog = listOfficialPinTemplateCatalog();

	it('preserves 24 pinterest official templates', () => {
		const pinterest = filterOfficialCatalogForPack(catalog, AI_PINS_PRODUCT);
		expect(pinterest).toHaveLength(24);
		expect(pinterest.every((entry) => entry.channel === 'pinterest')).toBe(true);
	});

	it('returns 8 facebook official templates', () => {
		const facebook = filterOfficialCatalogForPack(catalog, AI_FACEBOOK_PAGES_PRODUCT);
		expect(facebook).toHaveLength(8);
		expect(facebook.every((entry) => entry.channel === 'facebook')).toBe(true);
		expect(facebook.every((entry) => entry.configuration.canvas.height === 630)).toBe(true);
	});
});

describe('filterTemplatesForPack', () => {
	it('filters mixed gallery rows by product pack', () => {
		const rows = [
			{ tags: ['pinterest'], configuration: { canvas: { width: 1000, height: 1500 } } },
			{ tags: ['facebook'], configuration: { canvas: { width: 1200, height: 630 } } },
		];
		expect(filterTemplatesForPack(rows, AI_PINS_PRODUCT)).toHaveLength(1);
		expect(filterTemplatesForPack(rows, AI_FACEBOOK_PAGES_PRODUCT)).toHaveLength(1);
		expect(resolveTemplatePackKey(AI_FACEBOOK_PAGES_PRODUCT)).toBe('facebook');
	});
});
