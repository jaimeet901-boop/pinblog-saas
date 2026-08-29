import { describe, expect, it } from 'vitest';
import {
	extractIngredientsFromHtml,
	extractIngredientsFromIngredientsHeading,
	extractIngredientsFromJsonLd,
	extractSourceIngredientsFromArticle,
	formatIngredientsList,
	ingredientsToArray,
	resolvePinIngredients,
	validateCondensedIngredients,
} from '../pinIngredients.js';

/** Generic HTML shaped like common recipe blogs (not a hardcoded product recipe). */
const SAMPLE_HEADING_HTML = `
<html><body>
<h2>Ingredients</h2>
<ul>
  <li>1 cup cottage cheese (full-fat or low-fat; small-curd works best)</li>
  <li>¼ cup pizza or marinara sauce</li>
  <li>½ cup shredded mozzarella cheese, divided</li>
  <li>2 tablespoons grated Parmesan cheese</li>
  <li>½ teaspoon Italian seasoning</li>
  <li>¼ teaspoon garlic powder</li>
  <li>Pinch of red pepper flakes (optional)</li>
  <li>Your favorite toppings: turkey pepperoni, diced bell peppers, sliced black olives, cooked Italian sausage, or mushrooms</li>
</ul>
<h2>Ingredient Notes</h2>
<p>Cottage Cheese: Choose a small-curd cottage cheese for the best texture.</p>
<h2>Step-by-Step Instructions</h2>
</body></html>
`;

const SAMPLE_JSON_LD_HTML = `
<script type="application/ld+json">
${JSON.stringify({
	'@context': 'https://schema.org',
	'@type': 'Recipe',
	name: 'Sample Bowl',
	recipeIngredient: [
		'1 cup cottage cheese',
		'1/4 cup marinara sauce',
		'1/2 cup mozzarella',
	],
})}
</script>
`;

describe('ingredient HTML extraction', () => {
	it('extracts list items under an Ingredients heading (production-like structure)', () => {
		const lines = extractIngredientsFromIngredientsHeading(SAMPLE_HEADING_HTML);
		expect(lines.length).toBe(8);
		expect(lines[0]).toMatch(/cottage cheese/i);
		expect(lines.some((line) => /Ingredient Notes/i.test(line))).toBe(false);
	});

	it('prefers JSON-LD recipeIngredient when present', () => {
		const lines = extractIngredientsFromHtml(SAMPLE_JSON_LD_HTML + SAMPLE_HEADING_HTML);
		expect(lines).toEqual([
			'1 cup cottage cheese',
			'1/4 cup marinara sauce',
			'1/2 cup mozzarella',
		]);
		expect(extractIngredientsFromJsonLd(SAMPLE_JSON_LD_HTML)).toHaveLength(3);
	});

	it('returns empty when no recipe ingredients exist', () => {
		expect(extractIngredientsFromHtml('<html><body><h1>Hello</h1></body></html>')).toEqual([]);
	});
});

describe('resolvePinIngredients / validation', () => {
	const source = [
		'1 cup cottage cheese (full-fat or low-fat; small-curd works best)',
		'¼ cup pizza or marinara sauce',
		'½ cup shredded mozzarella cheese, divided',
		'2 tablespoons grated Parmesan cheese',
		'½ teaspoon Italian seasoning',
		'¼ teaspoon garlic powder',
		'Pinch of red pepper flakes (optional)',
		'Your favorite toppings: turkey pepperoni, diced bell peppers, sliced black olives, cooked Italian sausage, or mushrooms',
	];

	it('accepts condensed AI output that only uses source ingredients', () => {
		const ai = [
			'Cottage cheese',
			'Marinara sauce',
			'Mozzarella',
			'Parmesan',
			'Italian seasoning',
			'Garlic powder',
		];
		const validated = validateCondensedIngredients(ai, source);
		expect(validated.ok).toBe(true);
		expect(validated.ingredients).toEqual(ai);
		expect(resolvePinIngredients({ sourceIngredients: source, aiIngredients: ai }).split('\n'))
			.toEqual(ai.map((line) => `* ${line}`));
	});

	it('rejects invented ingredients and falls back to normalized source', () => {
		const ai = ['Cottage cheese', 'Ricotta', 'Marinara sauce'];
		expect(validateCondensedIngredients(ai, source).ok).toBe(false);
		const fallback = resolvePinIngredients({ sourceIngredients: source, aiIngredients: ai });
		expect(fallback).toBe(
			formatIngredientsList(source, { maxItems: 10 })
				.split('\n')
				.map((line) => `* ${line}`)
				.join('\n'),
		);
		expect(fallback.toLowerCase()).not.toContain('ricotta');
	});

	it('falls back to source when AI ingredients are missing or malformed', () => {
		const expected = formatIngredientsList(source, { maxItems: 10 })
			.split('\n')
			.map((line) => `* ${line}`)
			.join('\n');
		expect(resolvePinIngredients({ sourceIngredients: source, aiIngredients: null }))
			.toBe(expected);
		expect(resolvePinIngredients({ sourceIngredients: source, aiIngredients: 'not-a-list' }))
			.toBe(expected);
	});

	it('preserves all ingredients when source has fewer than 6', () => {
		const short = ['Eggs', 'Milk', 'Flour'];
		const expected = short.map((line) => `* ${line}`);
		expect(resolvePinIngredients({ sourceIngredients: short, aiIngredients: null }).split('\n'))
			.toEqual(expected);
		expect(resolvePinIngredients({
			sourceIngredients: short,
			aiIngredients: ['Eggs', 'Milk', 'Flour'],
		}).split('\n')).toEqual(expected);
	});

	it('caps long source fallback and validated AI lists', () => {
		const long = Array.from({ length: 20 }, (_, i) => `Fresh herb blend number ${i + 1}`);
		const condensed = long.slice(0, 15).map((line) => line.replace('Fresh herb blend number', 'herb blend number'));
		const validated = validateCondensedIngredients(condensed, long);
		expect(validated.ok).toBe(true);
		expect(validated.ingredients.length).toBeLessThanOrEqual(10);
		const fallback = resolvePinIngredients({ sourceIngredients: long, aiIngredients: null });
		expect(fallback.split('\n')).toHaveLength(10);
		expect(fallback.split('\n').every((line) => line.startsWith('* '))).toBe(true);
	});

	it('returns empty ingredients when source is missing (never invents)', () => {
		expect(resolvePinIngredients({
			sourceIngredients: [],
			aiIngredients: ['Salt', 'Pepper'],
		})).toBe('');
		expect(extractSourceIngredientsFromArticle({})).toEqual([]);
	});

	it('reads source ingredients from article fields without demo content', () => {
		expect(extractSourceIngredientsFromArticle({
			sourceIngredients: ['A', 'B'],
		})).toEqual(['A', 'B']);
		expect(extractSourceIngredientsFromArticle({
			recipe_schema: { recipeIngredient: ['Butter', 'Sugar'] },
		})).toEqual(['Butter', 'Sugar']);
		expect(ingredientsToArray('One\nTwo')).toEqual(['One', 'Two']);
	});
});
