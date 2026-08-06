/**
 * F6-4 — studio template pack resolver tests.
 * Run: node --test src/services/studio/template-pack.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	filterOfficialCatalogByPack,
	matchesStudioTemplatePackEntry,
	normalizeStudioTemplatePackKey,
	resolveStudioTemplatePackMeta,
	resolveTemplatePackKeyForChannel,
} from './template-pack.js';

const samplePinterestTemplate = {
	tags: ['hero', 'pinterest'],
	configuration: { canvas: { width: 1000, height: 1500 } },
};

const sampleFacebookTemplate = {
	tags: ['facebook', 'link-post'],
	configuration: { canvas: { width: 1200, height: 630 } },
};

describe('normalizeStudioTemplatePackKey', () => {
	it('defaults to pinterest', () => {
		assert.equal(normalizeStudioTemplatePackKey(), 'pinterest');
		assert.equal(normalizeStudioTemplatePackKey(''), 'pinterest');
	});

	it('accepts facebook', () => {
		assert.equal(normalizeStudioTemplatePackKey('facebook'), 'facebook');
	});
});

describe('resolveTemplatePackKeyForChannel', () => {
	it('maps channels to pack keys', () => {
		assert.equal(resolveTemplatePackKeyForChannel('pinterest'), 'pinterest');
		assert.equal(resolveTemplatePackKeyForChannel('facebook'), 'facebook');
	});
});

describe('matchesStudioTemplatePackEntry', () => {
	it('includes pinterest portrait templates and excludes facebook', () => {
		assert.equal(matchesStudioTemplatePackEntry(samplePinterestTemplate, 'pinterest'), true);
		assert.equal(matchesStudioTemplatePackEntry(sampleFacebookTemplate, 'pinterest'), false);
	});

	it('includes facebook templates and excludes pinterest portrait', () => {
		assert.equal(matchesStudioTemplatePackEntry(sampleFacebookTemplate, 'facebook'), true);
		assert.equal(matchesStudioTemplatePackEntry(samplePinterestTemplate, 'facebook'), false);
	});

	it('matches facebook by canvas dimensions when tag missing', () => {
		assert.equal(matchesStudioTemplatePackEntry({
			tags: [],
			configuration: { canvas: { width: 1200, height: 630 } },
		}, 'facebook'), true);
	});
});

describe('resolveStudioTemplatePackMeta', () => {
	it('returns facebook gallery tag for facebook pack', () => {
		const pack = resolveStudioTemplatePackMeta('facebook');
		assert.equal(pack.galleryTag, 'facebook');
		assert.equal(pack.canvas.width, 1200);
	});

	it('keeps pinterest gallery untagged for backward compatibility', () => {
		const pack = resolveStudioTemplatePackMeta('pinterest');
		assert.equal(pack.galleryTag, '');
		assert.equal(pack.canvas.width, 1000);
	});
});

describe('filterOfficialCatalogByPack', () => {
	it('filters catalog entries by channel field', () => {
		const catalog = [
			{ channel: 'pinterest', configuration: { canvas: { width: 1000, height: 1500 } } },
			{ channel: 'facebook', configuration: { canvas: { width: 1200, height: 630 } } },
		];
		assert.equal(filterOfficialCatalogByPack(catalog, 'facebook').length, 1);
		assert.equal(filterOfficialCatalogByPack(catalog, 'pinterest').length, 1);
	});
});
