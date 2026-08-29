import { describe, expect, it, beforeEach } from 'vitest';
import { resetVariableRegistryForTests, resolveVariablesInDocument } from '../pinVariableRegistry.js';
import { listOfficialPinTemplateCatalog } from '../officialPinTemplateCatalog.generated.js';
import { createMockRenderSurface, renderDocument } from '../pinLayerCompositor.js';

describe('Recipe Ingredients Card with condensed ingredients', () => {
	beforeEach(() => {
		resetVariableRegistryForTests();
	});

	it('renders {{ingredients}} on the official v2 card without changing the template', async () => {
		const entry = listOfficialPinTemplateCatalog().find(
			(item) => item.templateUuid === 'chefia-official-recipe-ingredients-card',
		);
		expect(entry).toBeTruthy();
		const ingredients = 'Cottage cheese\nMarinara sauce\nMozzarella\nParmesan';
		expect(entry.configuration.layers.find((l) => l.id === 'lyr_ric_ingredients').props.text)
			.toBe('{{ingredients}}');

		const resolved = resolveVariablesInDocument(entry.configuration, {
			title: 'Cottage Cheese Pizza Bowl',
			subtitle: 'High protein',
			image: 'https://example.com/food.jpg',
			ingredients,
		});
		expect(resolved.layers.find((l) => l.id === 'lyr_ric_ingredients').props.text)
			.toBe(ingredients);

		const result = await renderDocument(entry.configuration, {
			format: 'png',
			variables: {
				title: 'Cottage Cheese Pizza Bowl',
				subtitle: 'High protein',
				ingredients,
				image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			},
			createSurface: createMockRenderSurface,
			loadImageFn: async () => ({ width: 10, height: 10 }),
		});
		expect(result.bytes.byteLength).toBeGreaterThan(0);
		expect(result.document.layers.find((l) => l.id === 'lyr_ric_ingredients').props.text)
			.toBe(ingredients);
	});

	it('leaves existing official templates on editorVersion 1', () => {
		const others = listOfficialPinTemplateCatalog().filter(
			(item) => item.templateUuid !== 'chefia-official-recipe-ingredients-card',
		);
		expect(others.length).toBeGreaterThan(10);
		expect(others.every((item) => Number(item.configuration?.editorVersion || 1) === 1)).toBe(true);
	});
});
