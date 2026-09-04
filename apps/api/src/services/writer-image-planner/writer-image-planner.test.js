/**
 * Writer image planner (M1.1) — isolated unit tests.
 * Run: node --test src/services/writer-image-planner/writer-image-planner.test.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	planArticleImages,
	validateImagePlan,
	normalizeImagePlan,
	detectArticleType,
	MAX_IMAGE_COUNT,
} from './index.js';
import { stripListNumbering, visualSubject } from './queries.js';
import { visualCategoriesOverlap, inferVisualCategory } from './select.js';

const here = dirname(fileURLToPath(import.meta.url));

const CHICKEN_ALFREDO = {
	seo_title: 'Easy Chicken Alfredo Pasta Recipe',
	introduction: '<p>A creamy weeknight pasta with tender chicken.</p>',
	sections: [
		{ heading: 'Ingredients', level: 'h2', content: '<p>Chicken, pasta, cream, cheese.</p>' },
		{ heading: 'Cooking the chicken', level: 'h2', content: '<p>Season and sear the chicken.</p>' },
		{ heading: 'Making the Alfredo sauce', level: 'h2', content: '<p>Simmer cream, butter, and cheese.</p>' },
		{ heading: 'Combining pasta, chicken and sauce', level: 'h2', content: '<p>Toss pasta with sauce.</p>' },
		{ heading: 'Serving the finished dish', level: 'h2', content: '<p>Plate and garnish.</p>' },
		{ heading: 'Frequently Asked Questions', level: 'h2', content: '<p>Storage tips.</p>' },
		{ heading: 'Conclusion', level: 'h2', content: '<p>Enjoy your pasta night.</p>' },
	],
	faq: [{ question: 'Can I freeze it?', answer: 'Yes.' }],
	conclusion: '<p>Enjoy your pasta night.</p>',
	recipe_schema: {
		'@type': 'Recipe',
		name: 'Easy Chicken Alfredo Pasta',
		recipeIngredient: ['chicken', 'pasta', 'cream'],
	},
};

const CAST_IRON = {
	seo_title: 'How to Clean a Cast Iron Pan',
	introduction: '<p>Keep your skillet seasoned and rust-free.</p>',
	sections: [
		{ heading: 'What you need', level: 'h2', content: '<p>Coarse salt, cloth, oil.</p>' },
		{ heading: 'Removing food residue', level: 'h2', content: '<p>Scrape stuck food gently.</p>' },
		{ heading: 'Cleaning the pan', level: 'h2', content: '<p>Scrub with salt and rinse briefly.</p>' },
		{ heading: 'Drying and seasoning', level: 'h2', content: '<p>Dry fully and oil lightly.</p>' },
		{ heading: 'Common mistakes', level: 'h2', content: '<p>Avoid soaking overnight.</p>' },
		{ heading: 'FAQ', level: 'h2', content: '<p>Can I use soap?</p>' },
		{ heading: 'Conclusion', level: 'h2', content: '<p>A clean pan lasts decades.</p>' },
	],
	faq: [],
	conclusion: '<p>A clean pan lasts decades.</p>',
};

const BREAKFAST_LISTICLE = {
	seo_title: '10 Healthy Breakfast Ideas',
	introduction: '<p>Start the day with better fuel.</p>',
	sections: [
		{ heading: '1 Overnight oats with berries', level: 'h2', content: '<p>Oats soaked overnight.</p>' },
		{ heading: '2 Greek yogurt parfait', level: 'h2', content: '<p>Yogurt layered with fruit.</p>' },
		{ heading: '3 Avocado toast with eggs', level: 'h2', content: '<p>Toast topped with avocado.</p>' },
		{ heading: '4 Smoothie bowl', level: 'h2', content: '<p>Blended fruit bowl.</p>' },
		{ heading: '5 Veggie omelette', level: 'h2', content: '<p>Eggs with vegetables.</p>' },
		{ heading: '6 Chia pudding', level: 'h2', content: '<p>Chia seeds in milk.</p>' },
		{ heading: 'FAQ', level: 'h2', content: '<p>Make ahead?</p>' },
		{ heading: 'Conclusion', level: 'h2', content: '<p>Mix and match.</p>' },
	],
	faq: [],
	conclusion: '<p>Mix and match.</p>',
};

describe('writer-image-planner M1', () => {
	it('1. imageCount = 0 → zero slots, no side effects', () => {
		const plan = planArticleImages(CHICKEN_ALFREDO, { imageCount: 0 });
		assert.equal(plan.requestedCount, 0);
		assert.equal(plan.plannedCount, 0);
		assert.equal(plan.imageSlots.length, 0);
		assert.equal(plan.articleType, 'recipe');
	});

	it('2. imageCount = 1 → single highest-priority slot', () => {
		const plan = planArticleImages(CHICKEN_ALFREDO, { imageCount: 1 });
		assert.equal(plan.requestedCount, 1);
		assert.equal(plan.plannedCount, 1);
		assert.equal(plan.imageSlots.length, 1);
		assert.equal(plan.imageSlots[0].type, 'featured');
		assert.equal(plan.imageSlots[0].priority, 1);
		assert.match(plan.imageSlots[0].concept, /plated|finished|dish/i);
	});

	it('3. recipe with process sections + imageCount = 3 → three distinct concepts', () => {
		const plan = planArticleImages(CHICKEN_ALFREDO, { imageCount: 3 });
		assert.equal(plan.plannedCount, 3);
		assert.equal(plan.imageSlots.length, 3);
		const concepts = plan.imageSlots.map((s) => s.concept.toLowerCase());
		const queries = plan.imageSlots.map((s) => s.query.toLowerCase());
		assert.equal(new Set(concepts).size, 3);
		assert.equal(new Set(queries).size, 3);
		const titleSpam = queries.filter((q) => q === 'easy chicken alfredo pasta recipe').length;
		assert.ok(titleSpam <= 1);
		assert.ok(plan.imageSlots.some((s) => s.type === 'featured'));
		assert.ok(
			plan.imageSlots.some((s) => /chicken|skillet|sauce|alfredo|pasta|combin/i.test(s.query)),
		);
	});

	it('4. FAQ is never selected', () => {
		const plan = planArticleImages(CHICKEN_ALFREDO, { imageCount: 5 });
		for (const slot of plan.imageSlots) {
			if (Number.isInteger(slot.sectionIndex)) {
				const heading = CHICKEN_ALFREDO.sections[slot.sectionIndex].heading;
				assert.doesNotMatch(heading, /faq|frequently asked/i);
			}
			assert.doesNotMatch(slot.concept, /\bfaq\b/i);
			assert.doesNotMatch(slot.query, /\bfaq\b/i);
		}
	});

	it('5. Conclusion is excluded by default', () => {
		const plan = planArticleImages(CHICKEN_ALFREDO, { imageCount: 5 });
		for (const slot of plan.imageSlots) {
			if (Number.isInteger(slot.sectionIndex)) {
				const heading = CHICKEN_ALFREDO.sections[slot.sectionIndex].heading;
				assert.doesNotMatch(heading, /conclusion/i);
			}
			assert.doesNotMatch(String(slot.after), /conclusion/i);
		}
	});

	it('6. Adjacent sections are not both selected when alternatives exist', () => {
		const article = {
			seo_title: 'Guide to Homemade Bread',
			introduction: '<p>Bake better bread.</p>',
			sections: [
				{ heading: 'Mixing the dough', level: 'h2', content: '<p>Combine flour and water.</p>' },
				{ heading: 'Kneading', level: 'h2', content: '<p>Knead until smooth.</p>' },
				{ heading: 'First rise', level: 'h2', content: '<p>Let dough rise.</p>' },
				{ heading: 'Shaping loaves', level: 'h2', content: '<p>Shape the dough.</p>' },
				{ heading: 'Baking in oven', level: 'h2', content: '<p>Bake until golden.</p>' },
			],
			faq: [],
			conclusion: '<p>Done.</p>',
			recipe_schema: { '@type': 'Recipe', name: 'Bread', recipeIngredient: ['flour'] },
		};
		const plan = planArticleImages(article, { imageCount: 3 });
		const indexes = plan.imageSlots
			.map((s) => s.sectionIndex)
			.filter((i) => Number.isInteger(i))
			.sort((a, b) => a - b);
		for (let i = 1; i < indexes.length; i += 1) {
			assert.notEqual(
				Math.abs(indexes[i] - indexes[i - 1]),
				1,
				`adjacent sections selected: ${indexes.join(',')}`,
			);
		}
	});

	it('7. request 5 but only 2 meaningful opportunities → plannedCount = 2', () => {
		const sparse = {
			seo_title: 'Short Note',
			introduction: '<p>Hi.</p>',
			sections: [
				{ heading: 'Cooking the chicken', level: 'h2', content: '<p>Cook chicken.</p>' },
			],
			faq: [],
			conclusion: '',
			recipe_schema: { '@type': 'Recipe', name: 'Chicken', recipeIngredient: ['chicken'] },
		};
		const plan = planArticleImages(sparse, { imageCount: 5 });
		assert.equal(plan.requestedCount, 5);
		assert.ok(plan.plannedCount <= 2);
		assert.equal(plan.plannedCount, plan.imageSlots.length);
		assert.ok(plan.plannedCount >= 1);
	});

	it('8. Duplicate concepts are removed', () => {
		const result = validateImagePlan({
			requestedCount: 3,
			articleType: 'recipe',
			imageSlots: [
				{
					id: 'a',
					type: 'featured',
					priority: 1,
					sectionIndex: null,
					after: 'hero',
					concept: 'finished plated dish',
					query: 'pasta plated',
					altHint: 'x',
				},
				{
					id: 'b',
					type: 'inline',
					priority: 2,
					sectionIndex: 0,
					after: 'section:0',
					concept: 'finished plated dish',
					query: 'pasta on plate',
					altHint: 'y',
				},
			],
		}, { article: CHICKEN_ALFREDO });
		assert.equal(result.plan.imageSlots.length, 1);
		assert.ok(result.errors.some((e) => /duplicate concept/i.test(e)));
	});

	it('9. Duplicate queries are removed', () => {
		const result = validateImagePlan({
			requestedCount: 3,
			articleType: 'recipe',
			imageSlots: [
				{
					id: 'a',
					type: 'featured',
					priority: 1,
					sectionIndex: null,
					after: 'hero',
					concept: 'hero dish',
					query: 'chicken alfredo plated',
					altHint: 'x',
				},
				{
					id: 'b',
					type: 'inline',
					priority: 2,
					sectionIndex: 0,
					after: 'section:0',
					concept: 'other concept',
					query: 'chicken alfredo plated',
					altHint: 'y',
				},
			],
		}, { article: CHICKEN_ALFREDO });
		assert.equal(result.plan.imageSlots.length, 1);
		assert.ok(result.errors.some((e) => /duplicate query/i.test(e)));
	});

	it('10. More than one Featured Image is impossible', () => {
		const result = validateImagePlan({
			requestedCount: 3,
			articleType: 'recipe',
			imageSlots: [
				{
					id: 'f1',
					type: 'featured',
					priority: 1,
					sectionIndex: null,
					after: 'hero',
					concept: 'one',
					query: 'one query',
					altHint: 'a',
				},
				{
					id: 'f2',
					type: 'featured',
					priority: 2,
					sectionIndex: null,
					after: 'hero',
					concept: 'two',
					query: 'two query',
					altHint: 'b',
				},
			],
		});
		assert.equal(result.plan.imageSlots.filter((s) => s.type === 'featured').length, 1);
		assert.ok(result.errors.some((e) => /more than one featured/i.test(e)));

		const planned = planArticleImages(CHICKEN_ALFREDO, { imageCount: 5 });
		assert.equal(planned.imageSlots.filter((s) => s.type === 'featured').length, 1);
	});

	it('11. Invalid planner output is rejected or safely normalized', () => {
		const bad = validateImagePlan(null);
		assert.equal(bad.ok, false);
		assert.equal(bad.plan.plannedCount, 0);

		const messy = normalizeImagePlan({
			requestedCount: 2,
			articleType: 'nope',
			imageSlots: [
				{ id: '', type: 'inline', concept: 'x', query: 'y' },
				{
					id: 'ok',
					type: 'featured',
					priority: 1,
					sectionIndex: null,
					after: 'hero',
					concept: 'valid concept',
					query: 'valid query string',
					altHint: 'alt',
				},
			],
		});
		assert.ok(messy.plannedCount <= messy.requestedCount);
		assert.equal(messy.imageSlots.length, messy.plannedCount);
		assert.ok(messy.imageSlots.every((s) => s.id && s.concept && s.query));
	});

	it('12. plannedCount <= requestedCount always', () => {
		for (const n of [0, 1, 2, 3, 4, 5, 9]) {
			const plan = planArticleImages(CHICKEN_ALFREDO, { imageCount: n });
			const requested = Math.min(MAX_IMAGE_COUNT, Math.max(0, n));
			assert.ok(plan.plannedCount <= plan.requestedCount);
			assert.equal(plan.requestedCount, requested);
			assert.equal(plan.plannedCount, plan.imageSlots.length);
		}
	});

	it('13. planner stays isolated from Writer/WP/prompts (no forbidden imports)', () => {
		const files = [
			'index.js',
			'constants.js',
			'detect-article-type.js',
			'candidates.js',
			'queries.js',
			'select.js',
			'validate.js',
		];
		for (const name of files) {
			const src = readFileSync(join(here, name), 'utf8');
			assert.doesNotMatch(src, /from ['"].*prompts\.js['"]/);
			assert.doesNotMatch(src, /SystemPrompt/);
			assert.doesNotMatch(src, /from ['"].*integrated-ai/);
			assert.doesNotMatch(src, /from ['"].*wordpress/i);
			assert.doesNotMatch(src, /WriterPage|composeHtml/);
			assert.doesNotMatch(src, /from ['"].*pexels|from ['"].*unsplash/i);
			assert.doesNotMatch(src, /pocketbaseClient/);
			assert.doesNotMatch(src, /\bfetch\s*\(/);
		}
	});

	it('detects recipe type from recipe_schema', () => {
		assert.equal(detectArticleType(CHICKEN_ALFREDO), 'recipe');
	});

	it('semanticPlanner hook can run without changing count rules', () => {
		let called = false;
		const plan = planArticleImages(CHICKEN_ALFREDO, {
			imageCount: 2,
			semanticPlanner: (candidates) => {
				called = true;
				return candidates;
			},
		});
		assert.equal(called, true);
		assert.ok(plan.plannedCount <= 2);
	});
});

describe('writer-image-planner M1.1 quality polish', () => {
	it('A. recipe Chicken Alfredo: process over plated duplicate', () => {
		const plan = planArticleImages(CHICKEN_ALFREDO, { imageCount: 3 });
		assert.equal(plan.articleType, 'recipe');
		assert.equal(plan.plannedCount, 3);

		const featured = plan.imageSlots.filter((s) => s.type === 'featured');
		assert.equal(featured.length, 1);
		assert.match(featured[0].concept, /finished|plated/i);
		assert.match(featured[0].query, /chicken alfredo pasta/i);
		assert.doesNotMatch(featured[0].query, /^easy chicken alfredo pasta recipe$/i);

		const inlines = plan.imageSlots.filter((s) => s.type === 'inline');
		assert.equal(inlines.length, 2);

		for (const slot of inlines) {
			assert.doesNotMatch(slot.concept, /plated serving|finished plated|serving presentation/i);
			assert.doesNotMatch(slot.query, /plated serving|plated finished/i);
			assert.ok(
				!visualCategoriesOverlap(featured[0], slot),
				`inline overlaps featured visually: ${slot.concept}`,
			);
		}

		const blob = inlines.map((s) => `${s.concept} ${s.query}`).join(' ').toLowerCase();
		assert.match(blob, /chicken|cook/);
		assert.match(blob, /sauce|alfredo|combin|toss|pasta/);
	});

	it('B. how-to cast iron: type, process over materials, contextual queries', () => {
		assert.equal(detectArticleType(CAST_IRON), 'how-to');
		const plan = planArticleImages(CAST_IRON, { imageCount: 3 });
		assert.equal(plan.articleType, 'how-to');
		assert.equal(plan.plannedCount, 3);

		const featured = plan.imageSlots.find((s) => s.type === 'featured');
		assert.ok(featured);
		assert.notEqual(featured.query.toLowerCase(), 'how to clean a cast iron pan');
		assert.match(featured.query, /cast iron/i);

		const inlineHeadings = plan.imageSlots
			.filter((s) => Number.isInteger(s.sectionIndex))
			.map((s) => CAST_IRON.sections[s.sectionIndex].heading);
		assert.ok(!inlineHeadings.some((h) => /^what you need$/i.test(h)));
		assert.ok(
			inlineHeadings.some((h) => /remov|clean|dry|season/i.test(h)),
			`expected process sections, got: ${inlineHeadings.join(', ')}`,
		);

		for (const slot of plan.imageSlots) {
			assert.doesNotMatch(slot.query, /^what you need$/i);
			if (Number.isInteger(slot.sectionIndex)) {
				const heading = CAST_IRON.sections[slot.sectionIndex].heading;
				assert.doesNotMatch(heading, /faq|conclusion/i);
			}
		}
	});

	it('C. listicle breakfast: strip numbers, distinct items, cleaner featured', () => {
		const plan = planArticleImages(BREAKFAST_LISTICLE, { imageCount: 4 });
		assert.equal(plan.articleType, 'listicle');
		assert.equal(plan.plannedCount, 4);

		const featured = plan.imageSlots.find((s) => s.type === 'featured');
		assert.ok(featured);
		assert.notEqual(featured.query.toLowerCase(), '10 healthy breakfast ideas');
		assert.match(featured.query, /breakfast/i);

		const inlines = plan.imageSlots.filter((s) => s.type === 'inline');
		assert.ok(inlines.length >= 2);
		for (const slot of inlines) {
			assert.doesNotMatch(slot.query, /^\d+\b/);
			assert.doesNotMatch(slot.concept, /list item:\s*\d+/i);
		}
		const queries = inlines.map((s) => s.query.toLowerCase());
		assert.equal(new Set(queries).size, queries.length);
	});

	it('D. invariants: cap, sparse, invalid, featured unique, visual plated dedupe', () => {
		assert.equal(planArticleImages(CHICKEN_ALFREDO, { imageCount: 0 }).plannedCount, 0);

		const capped = planArticleImages(CHICKEN_ALFREDO, { imageCount: 9 });
		assert.equal(capped.requestedCount, 5);
		assert.ok(capped.plannedCount <= 5);

		const sparse = planArticleImages({
			seo_title: 'Tiny',
			introduction: '<p>x</p>',
			sections: [{ heading: 'Cooking the chicken', level: 'h2', content: '<p>c</p>' }],
			recipe_schema: { '@type': 'Recipe', recipeIngredient: ['chicken'] },
		}, { imageCount: 5 });
		assert.ok(sparse.plannedCount <= 2);

		const empty = planArticleImages(null, { imageCount: 3 });
		assert.ok(empty.plannedCount <= empty.requestedCount);
		assert.ok(Array.isArray(empty.imageSlots));

		const platedDedupe = validateImagePlan({
			requestedCount: 3,
			articleType: 'recipe',
			imageSlots: [
				{
					id: 'a',
					type: 'featured',
					priority: 1,
					sectionIndex: null,
					after: 'hero',
					concept: 'finished plated dish',
					query: 'chicken alfredo pasta plated finished dish',
					altHint: 'x',
					visualCategory: 'plated_finished',
				},
				{
					id: 'b',
					type: 'inline',
					priority: 2,
					sectionIndex: 4,
					after: 'section:4',
					concept: 'plated serving presentation',
					query: 'chicken alfredo pasta plated serving',
					altHint: 'y',
					visualCategory: 'plated_finished',
				},
			],
		}, { article: CHICKEN_ALFREDO });
		assert.equal(platedDedupe.plan.imageSlots.length, 1);
		assert.ok(platedDedupe.errors.some((e) => /visual category/i.test(e)));

		assert.equal(inferVisualCategory('finished plated dish', 'x'), 'plated_finished');
		assert.ok(visualCategoriesOverlap(
			{ concept: 'finished plated dish', query: 'a plated finished dish' },
			{ concept: 'plated serving presentation', query: 'b plated serving' },
		));
	});

	it('helpers: stripListNumbering and visualSubject', () => {
		assert.equal(stripListNumbering('1 Overnight oats with berries'), 'Overnight oats with berries');
		assert.equal(stripListNumbering('3) Avocado toast with eggs'), 'Avocado toast with eggs');
		assert.equal(visualSubject({ seo_title: 'Easy Chicken Alfredo Pasta Recipe' }), 'Chicken Alfredo Pasta');
		assert.equal(visualSubject({ seo_title: 'How to Clean a Cast Iron Pan' }), 'Cast Iron Pan');
		assert.equal(visualSubject({ seo_title: '10 Healthy Breakfast Ideas' }), 'Healthy Breakfast');
		// "healthy" is topical, not marketing fluff to strip
	});
});
