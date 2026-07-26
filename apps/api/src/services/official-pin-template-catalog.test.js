import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listOfficialPinTemplateCatalog } from './official-pin-template-catalog.js';
import { TEMPLATE_CATEGORIES } from '../constants/pin-engine.js';
import { validateTemplateConfiguration } from '../utils/template-config-validation.js';

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
	].join('|');
}

describe('official pin template catalog', () => {
	it('exports exactly 24 unique published-ready official templates', () => {
		const catalog = listOfficialPinTemplateCatalog();
		assert.equal(catalog.length, 24);
		const uuids = catalog.map((entry) => entry.templateUuid);
		assert.equal(new Set(uuids).size, 24);
		const structures = catalog.map(structuralKey);
		assert.equal(new Set(structures).size, 24, 'each template must have a unique structural signature');

		for (const entry of catalog) {
			assert.match(entry.templateUuid, /^chefia-official-/);
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
