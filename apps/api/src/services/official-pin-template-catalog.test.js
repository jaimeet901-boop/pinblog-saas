/**
 * F6-4 — official pin template catalog tests (Pinterest + Facebook packs).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	listOfficialPinTemplateCatalog,
	listOfficialFacebookPinTemplateCatalog,
	listOfficialPinterestPinTemplateCatalog,
} from './official-pin-template-catalog.js';
import { TEMPLATE_CATEGORIES } from '../constants/pin-engine.js';
import { validateTemplateConfiguration } from '../utils/template-config-validation.js';
import { filterOfficialCatalogByPack } from './studio/template-pack.js';

function structuralKey(entry) {
	const c = entry.configuration || {};
	const L = c.layout || {};
	const T = c.typography || {};
	const O = c.textOverlay || {};
	const D = c.decorations || {};
	return [
		L.textPosition, L.textAlign, L.ctaPosition, L.frameStyle, L.foodFocusY,
		T.fontFamily, T.fontSize || T.titleSize, T.scriptEnabled, T.textColor,
		O.style, O.intensity, D.accentStyle, D.brushHighlight,
		c.canvas?.width, c.canvas?.height,
	].join('|');
}

describe('official pin template catalog — pinterest pack', () => {
	it('exports exactly 24 unique published-ready Pinterest templates', () => {
		const catalog = listOfficialPinterestPinTemplateCatalog();
		assert.equal(catalog.length, 24);
		const uuids = catalog.map((entry) => entry.templateUuid);
		assert.equal(new Set(uuids).size, 24);
		const structures = catalog.map(structuralKey);
		assert.equal(new Set(structures).size, 24, 'each Pinterest template must have a unique structural signature');

		for (const entry of catalog) {
			assert.match(entry.templateUuid, /^chefia-official-/);
			assert.doesNotMatch(entry.templateUuid, /^chefia-official-facebook-/);
			assert.equal(entry.channel, 'pinterest');
			assert.ok(entry.tags.includes('pinterest'));
			assert.ok(!entry.tags.includes('facebook'));
			assert.ok(entry.name);
			assert.ok(TEMPLATE_CATEGORIES.includes(entry.category), `unknown category: ${entry.category}`);
			assert.match(entry.thumbnail, /^data:image\/svg\+xml/);
			const validated = validateTemplateConfiguration(entry.configuration);
			assert.equal(validated.ok, true, JSON.stringify(validated.issues));
			assert.equal(entry.configuration?.canvas?.width, 1000);
			assert.equal(entry.configuration?.canvas?.height, 1500);
		}
	});
});

describe('official pin template catalog — facebook pack', () => {
	it('exports 8 unique landscape Facebook link-post templates', () => {
		const catalog = listOfficialFacebookPinTemplateCatalog();
		assert.equal(catalog.length, 8);
		const uuids = catalog.map((entry) => entry.templateUuid);
		assert.equal(new Set(uuids).size, 8);
		const structures = catalog.map(structuralKey);
		assert.equal(new Set(structures).size, 8, 'each Facebook template must have a unique structural signature');

		for (const entry of catalog) {
			assert.match(entry.templateUuid, /^chefia-official-facebook-/);
			assert.equal(entry.channel, 'facebook');
			assert.ok(entry.tags.includes('facebook'));
			assert.ok(entry.tags.includes('link-post'));
			assert.match(entry.thumbnail, /^data:image\/svg\+xml/);
			const validated = validateTemplateConfiguration(entry.configuration);
			assert.equal(validated.ok, true, JSON.stringify(validated.issues));
			assert.equal(entry.configuration?.canvas?.width, 1200);
			assert.equal(entry.configuration?.canvas?.height, 630);
		}
	});
});

describe('official pin template catalog — combined', () => {
	it('combines pinterest and facebook without uuid collisions', () => {
		const catalog = listOfficialPinTemplateCatalog();
		assert.equal(catalog.length, 32);
		assert.equal(new Set(catalog.map((entry) => entry.templateUuid)).size, 32);
		assert.equal(filterOfficialCatalogByPack(catalog, 'pinterest').length, 24);
		assert.equal(filterOfficialCatalogByPack(catalog, 'facebook').length, 8);
	});
});
