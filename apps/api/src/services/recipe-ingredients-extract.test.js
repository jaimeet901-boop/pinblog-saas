import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	extractIngredientsFromHtml,
	extractIngredientsFromIngredientsHeading,
} from './recipe-ingredients-extract.js';

const HEADING_HTML = `
<section>
  <h2 class="wp-block-heading">Ingredients</h2>
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
</section>
<section>
  <h2>Ingredient Notes</h2>
  <p>Cottage Cheese: Choose a small-curd cottage cheese.</p>
</section>
`;

describe('recipe-ingredients-extract', () => {
	it('extracts Ingredients list items from production-like HTML', () => {
		const lines = extractIngredientsFromIngredientsHeading(HEADING_HTML);
		assert.equal(lines.length, 8);
		assert.match(lines[0], /cottage cheese/i);
		assert.ok(!lines.some((line) => /Ingredient Notes/i.test(line)));
	});

	it('prefers JSON-LD over heading lists', () => {
		const html = `<script type="application/ld+json">${JSON.stringify({
			'@type': 'Recipe',
			recipeIngredient: ['Flour', 'Eggs'],
		})}</script>${HEADING_HTML}`;
		assert.deepEqual(extractIngredientsFromHtml(html), ['Flour', 'Eggs']);
	});

	it('returns empty array when no ingredients exist', () => {
		assert.deepEqual(extractIngredientsFromHtml('<p>No recipe here</p>'), []);
	});
});
