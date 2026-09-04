/** Writer image planner — shared constants (M1, pure logic). */

export const MAX_IMAGE_COUNT = 5;

export const ARTICLE_TYPES = Object.freeze([
	'recipe',
	'how-to',
	'listicle',
	'comparison',
	'review',
	'informational',
]);

export const SLOT_TYPES = Object.freeze(['featured', 'inline']);

/** Placement tokens for compose/publish (metadata only in M1). */
export const AFTER_INTRODUCTION = 'introduction';
export const AFTER_HERO = 'hero';

export function afterSection(index) {
	return `section:${Number(index)}`;
}
