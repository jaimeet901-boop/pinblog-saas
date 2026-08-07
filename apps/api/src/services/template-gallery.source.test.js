import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('template-gallery source of truth', () => {
	it('listGalleryTemplates does not import in-memory official catalog', () => {
		const source = fs.readFileSync(path.join(__dirname, 'template-gallery.js'), 'utf8');
		assert.doesNotMatch(source, /official-pin-template-catalog/);
		assert.doesNotMatch(source, /listOfficialPinTemplateCatalog/);
		assert.doesNotMatch(source, /OFFICIAL_PIN_TEMPLATE_CATALOG/);
	});

	it('prepareGalleryLibrary no longer seeds catalog on gallery requests', () => {
		const source = fs.readFileSync(path.join(__dirname, 'template-gallery.js'), 'utf8');
		assert.doesNotMatch(source, /ensureOfficialPinTemplatesSeeded/);
		assert.doesNotMatch(source, /bootstrapOfficialPinTemplates/);
	});
});
