/**
 * Ingredient list formatting for Variable Engine + pin generation hydration.
 * Keeps template tokens free of recipe-specific hardcoding.
 */

export const INGREDIENTS_MAX_ITEMS = 12;

/**
 * Normalize a string or string[] into a newline-separated ingredient list.
 * @param {unknown} value
 * @param {{ maxItems?: number }} [options]
 * @returns {string}
 */
export function formatIngredientsList(value, options = {}) {
	const maxItems = Number.isFinite(options.maxItems)
		? Math.max(0, Number(options.maxItems))
		: INGREDIENTS_MAX_ITEMS;

	let items = [];
	if (Array.isArray(value)) {
		items = value
			.map((item) => String(item ?? '').replace(/\s+/g, ' ').trim())
			.filter(Boolean);
	} else if (typeof value === 'string') {
		items = value
			.split(/\r?\n/)
			.map((line) => line.replace(/\s+/g, ' ').trim())
			.filter(Boolean);
	} else if (value == null) {
		return '';
	} else {
		const single = String(value).replace(/\s+/g, ' ').trim();
		if (single) items = [single];
	}

	return items.slice(0, maxItems).join('\n');
}

/**
 * Strip HTML and split into lines for ingredient section bodies.
 * @param {string} htmlOrText
 * @returns {string[]}
 */
export function linesFromIngredientHtml(htmlOrText) {
	const raw = String(htmlOrText || '');
	if (!raw.trim()) return [];
	const withBreaks = raw
		.replace(/<\/(li|p|div|tr|h\d)>/gi, '\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<li[^>]*>/gi, '\n')
		.replace(/<[^>]+>/g, ' ');
	return withBreaks
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
}

/**
 * Pull ingredient lines from Writer-style article sections when heading matches Ingredients.
 * @param {unknown} sections
 * @returns {string}
 */
export function extractIngredientsFromSections(sections) {
	if (!Array.isArray(sections)) return '';
	const section = sections.find((row) => {
		const heading = String(row?.heading || row?.title || '').trim();
		return /ingredient/i.test(heading);
	});
	if (!section) return '';
	return formatIngredientsList(linesFromIngredientHtml(section.content || section.body || ''));
}

/**
 * Resolve ingredients for pin generation / preview context.
 * Preferred order: explicit variables → content → recipe schema → Ingredients section → empty.
 * @param {{ content?: object, variables?: object }} [input]
 * @returns {string}
 */
export function resolveIngredientsForContext({ content = {}, variables = {} } = {}) {
	const article = content.article && typeof content.article === 'object' ? content.article : null;
	const recipeSchema = content.recipe_schema
		|| content.recipeSchema
		|| article?.recipe_schema
		|| article?.recipeSchema
		|| content.recipe
		|| variables.recipe
		|| null;

	const candidates = [
		variables.ingredients,
		content.ingredients,
		variables.recipe?.ingredients,
		content.recipe?.ingredients,
		recipeSchema?.recipeIngredient,
		recipeSchema?.recipeIngredients,
		recipeSchema?.ingredients,
		extractIngredientsFromSections(content.sections),
		extractIngredientsFromSections(article?.sections),
	];

	for (const candidate of candidates) {
		const formatted = formatIngredientsList(candidate);
		if (formatted) return formatted;
	}
	return '';
}
