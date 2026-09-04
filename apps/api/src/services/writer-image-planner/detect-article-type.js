/**
 * Infer article type from existing Writer article fields.
 * Does not mutate the article or add articleType to persisted schema.
 */

import { ARTICLE_TYPES } from './constants.js';

function headingText(section) {
	return String(section?.heading || '').trim().toLowerCase();
}

function allHeadings(article) {
	const sections = Array.isArray(article?.sections) ? article.sections : [];
	return sections.map(headingText).filter(Boolean);
}

function titleText(article) {
	return String(article?.seo_title || '').trim().toLowerCase();
}

function hasRecipeSchema(article) {
	const schema = article?.recipe_schema;
	if (!schema || typeof schema !== 'object') return false;
	const types = schema['@type'];
	if (Array.isArray(types)) {
		return types.some((t) => String(t || '').toLowerCase() === 'recipe');
	}
	if (types) return String(types).toLowerCase() === 'recipe';
	return Boolean(schema.recipeIngredient || schema.recipeInstructions || schema.name);
}

function looksLikeHowTo(title, joinedHeadings) {
	const corpus = `${title} | ${joinedHeadings}`;
	if (/^how\s+to\b/i.test(title)) return true;
	if (/\b(step[- ]by[- ]step|tutorial|diy guide|beginner.?s guide)\b/i.test(title)) return true;
	if (/\b(how to|step\s*\d|instructions?|method|procedure|tutorial)\b/i.test(corpus)) return true;
	const stepHeadings = joinedHeadings
		.split(' | ')
		.filter((h) => /\b(step\s*\d|removing|cleaning|drying|seasoning|preparing|installing|assembling)\b/i.test(h));
	if (stepHeadings.length >= 2 && /\b(how|clean|fix|install|build|make|prepare)\b/i.test(title)) {
		return true;
	}
	return false;
}

/**
 * @param {object} article — Writer article JSON (read-only)
 * @returns {(typeof ARTICLE_TYPES)[number]}
 */
export function detectArticleType(article = {}) {
	if (hasRecipeSchema(article)) return 'recipe';

	const headings = allHeadings(article);
	const joined = headings.join(' | ');
	const title = titleText(article);

	const recipeHints = /\b(ingredient|cook(?:ing)?|bake|sauce|simmer|fry|roast|grill|assemble|plating|serving|prep(?:aration)?)\b/i;
	if (headings.filter((h) => recipeHints.test(h)).length >= 2) {
		return 'recipe';
	}

	// Title is strong evidence for how-to (do not rely only on headings)
	if (looksLikeHowTo(title, joined)) {
		return 'how-to';
	}

	if (/\b(vs\.?|versus|compared?|comparison|pros and cons|differences?)\b/i.test(`${title} | ${joined}`)) {
		return 'comparison';
	}

	if (/\b(review|worth it|rating|verdict|pros|cons)\b/i.test(`${title} | ${joined}`)) {
		return 'review';
	}

	const listicleTitle = /^\d+\s+|^(top|best)\s+\d+/i.test(title)
		|| /\b\d+\s+(ways|tips|ideas|reasons|things|breakfasts?|meals?)\b/i.test(title);
	const listicleHits = headings.filter((h) =>
		/^\d+[\).\s]|^(top|best|worst)\b|\b\d+\s+(ways|tips|ideas|reasons|things)\b/i.test(h),
	).length;
	if (listicleTitle || listicleHits >= 2 || (listicleHits >= 1 && headings.length >= 4)) {
		return 'listicle';
	}

	return 'informational';
}

export function isKnownArticleType(value) {
	return ARTICLE_TYPES.includes(String(value || '').trim().toLowerCase());
}
