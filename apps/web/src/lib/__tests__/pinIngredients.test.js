import { describe, expect, it } from 'vitest';
import {
	extractIngredientsFromSections,
	formatIngredientsList,
	formatIngredientsWithBullets,
	resolveIngredientsForContext,
	resolvePinIngredients,
} from '../pinIngredients.js';

describe('pinIngredients', () => {
	it('formats string ingredients as newline-separated text', () => {
		expect(formatIngredientsList('Salt\nPepper\nOlive oil')).toBe('Salt\nPepper\nOlive oil');
	});

	it('formats array ingredients as newline-separated text', () => {
		expect(formatIngredientsList(['Salt', 'Pepper', '  Olive oil  '])).toBe('Salt\nPepper\nOlive oil');
	});

	it('returns empty string for missing values', () => {
		expect(formatIngredientsList(null)).toBe('');
		expect(formatIngredientsList(undefined)).toBe('');
		expect(formatIngredientsList([])).toBe('');
		expect(formatIngredientsList('')).toBe('');
	});

	it('caps extremely long ingredient lists', () => {
		const many = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`);
		const formatted = formatIngredientsList(many);
		expect(formatted.split('\n')).toHaveLength(12);
		expect(formatted).toContain('Item 12');
		expect(formatted).not.toContain('Item 13');
	});

	it('extracts ingredients from Ingredients article sections', () => {
		const text = extractIngredientsFromSections([
			{ heading: 'Intro', content: '<p>Hello</p>' },
			{ heading: 'Ingredients', content: '<ul><li>Flour</li><li>Eggs</li></ul>' },
		]);
		expect(text).toBe('Flour\nEggs');
	});

	it('resolves preferred hydration order', () => {
		expect(resolveIngredientsForContext({
			variables: { ingredients: ['A', 'B'] },
			content: { ingredients: ['X'] },
		})).toBe('A\nB');

		expect(resolveIngredientsForContext({
			content: {
				recipe_schema: { recipeIngredient: ['Schema flour', 'Schema sugar'] },
			},
		})).toBe('Schema flour\nSchema sugar');

		expect(resolveIngredientsForContext({
			content: {
				sections: [{ heading: 'Ingredients', content: 'Butter\nMilk' }],
			},
		})).toBe('Butter\nMilk');

		expect(resolveIngredientsForContext({})).toBe('');
	});

	it('formats resolved pin ingredients as separate bulleted lines from source only', () => {
		expect(formatIngredientsWithBullets('Salt\nPepper')).toBe('* Salt\n* Pepper');
		expect(resolvePinIngredients({
			sourceIngredients: ['Flour', 'Eggs', 'Milk'],
			aiIngredients: ['Flour', 'Eggs', 'Milk'],
		})).toBe('* Flour\n* Eggs\n* Milk');
		expect(resolvePinIngredients({
			sourceIngredients: ['Flour', 'Eggs'],
			aiIngredients: ['Flour', 'Sugar'],
		})).toBe('* Flour\n* Eggs');
	});

	it('returns empty ingredients area when source is empty (no crash, no invent)', () => {
		expect(resolvePinIngredients({
			sourceIngredients: [],
			aiIngredients: ['Salt'],
		})).toBe('');
		expect(formatIngredientsWithBullets('')).toBe('');
	});
});
