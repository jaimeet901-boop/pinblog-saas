import { describe, expect, it, beforeEach } from 'vitest';
import { resetVariableRegistryForTests, resolveVariablesInDocument } from '../pinVariableRegistry.js';
import { listOfficialPinTemplateCatalog } from '../officialPinTemplateCatalog.generated.js';
import { createMockRenderSurface, renderDocument } from '../pinLayerCompositor.js';

describe('Recipe Ingredients Card empty ingredients', () => {
	beforeEach(() => {
		resetVariableRegistryForTests();
	});

	it('resolves the official v2 document with empty ingredients without throwing', async () => {
		const entry = listOfficialPinTemplateCatalog().find(
			(item) => item.templateUuid === 'chefia-official-recipe-ingredients-card',
		);
		expect(entry).toBeTruthy();
		expect(entry.configuration.editorVersion).toBe(2);

		const resolved = resolveVariablesInDocument(entry.configuration, {
			title: 'Test Recipe',
			subtitle: 'Demo',
			image: 'https://example.com/food.jpg',
			ingredients: '',
		});
		const ingredientsLayer = resolved.layers.find((layer) => layer.id === 'lyr_ric_ingredients');
		expect(ingredientsLayer.props.text).toBe('');

		const result = await renderDocument(entry.configuration, {
			format: 'png',
			variables: {
				title: 'Test Recipe',
				subtitle: '',
				ingredients: '',
				image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			},
			createSurface: createMockRenderSurface,
			loadImageFn: async () => ({ width: 10, height: 10 }),
		});
		expect(result.bytes.byteLength).toBeGreaterThan(0);
		expect(result.document.layers.find((layer) => layer.id === 'lyr_ric_ingredients').props.text).toBe('');
	});
});
