import { describe, expect, it, beforeEach } from 'vitest';
import { resetVariableRegistryForTests, resolveVariablesInDocument } from '../pinVariableRegistry.js';
import { listOfficialPinTemplateCatalog } from '../officialPinTemplateCatalog.generated.js';
import { createMockRenderSurface, renderDocument } from '../pinLayerCompositor.js';

describe('Recipe Ingredients Card with condensed ingredients', () => {
	beforeEach(() => {
		resetVariableRegistryForTests();
	});

	it('renders {{ingredients}} as separate bulleted lines on the official v2 card', async () => {
		const entry = listOfficialPinTemplateCatalog().find(
			(item) => item.templateUuid === 'chefia-official-recipe-ingredients-card',
		);
		expect(entry).toBeTruthy();
		const ingredients = '* Cottage cheese\n* Marinara sauce\n* Mozzarella\n* Parmesan';
		expect(entry.configuration.layers.find((l) => l.id === 'lyr_ric_ingredients').props.text)
			.toBe('{{ingredients}}');
		expect(entry.configuration.layers.find((l) => l.id === 'lyr_ric_heading').props.text)
			.toBe("You'll Need...");
		expect(entry.configuration.layers.some((l) => /secondary|circle/i.test(l.id || ''))).toBe(false);

		const resolved = resolveVariablesInDocument(entry.configuration, {
			title: 'Cottage Cheese Pizza Bowl',
			subtitle: 'High protein',
			image: 'https://example.com/food.jpg',
			ingredients,
		});
		expect(resolved.layers.find((l) => l.id === 'lyr_ric_ingredients').props.text)
			.toBe(ingredients);
		expect(resolved.layers.find((l) => l.id === 'lyr_ric_ingredients').props.text.split('\n'))
			.toHaveLength(4);

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
