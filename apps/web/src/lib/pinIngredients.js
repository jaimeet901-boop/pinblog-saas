/**
 * Ingredient list formatting for Variable Engine + pin generation hydration.
 * Keeps template tokens free of recipe-specific hardcoding.
 */

export const INGREDIENTS_MAX_ITEMS = 12;
export const INGREDIENTS_PIN_TARGET_MAX = 10;

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
 * @param {unknown} value
 * @returns {string[]}
 */
export function ingredientsToArray(value) {
	const formatted = formatIngredientsList(value, { maxItems: 40 });
	if (!formatted) return [];
	return formatted.split('\n').filter(Boolean);
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

function stripTags(value) {
	return String(value || '')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&#039;|&apos;/gi, "'")
		.replace(/&quot;/gi, '"')
		.replace(/\s+/g, ' ')
		.trim();
}

function collectRecipeNodes(node, out = []) {
	if (!node) return out;
	if (Array.isArray(node)) {
		for (const item of node) collectRecipeNodes(item, out);
		return out;
	}
	if (typeof node !== 'object') return out;
	if (node['@graph']) collectRecipeNodes(node['@graph'], out);
	const type = node['@type'];
	const types = Array.isArray(type) ? type : [type];
	if (types.some((t) => String(t || '').toLowerCase() === 'recipe') || node.recipeIngredient) {
		out.push(node);
	}
	return out;
}

/**
 * @param {string} html
 * @returns {string[]}
 */
export function extractIngredientsFromJsonLd(html) {
	const raw = String(html || '');
	const blocks = [...raw.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
	const lines = [];
	for (const match of blocks) {
		let data;
		try {
			data = JSON.parse(match[1]);
		} catch {
			continue;
		}
		for (const recipe of collectRecipeNodes(data)) {
			const ingredients = recipe.recipeIngredient || recipe.recipeIngredients || [];
			if (Array.isArray(ingredients)) {
				for (const item of ingredients) {
					if (typeof item === 'string') lines.push(item);
					else if (item && typeof item === 'object') {
						lines.push(item.name || item.text || item.item || '');
					}
				}
			} else if (typeof ingredients === 'string') {
				lines.push(...ingredients.split(/\r?\n/));
			}
		}
	}
	return ingredientsToArray(lines);
}

/**
 * @param {string} html
 * @returns {string[]}
 */
export function extractIngredientsFromIngredientsHeading(html) {
	const raw = String(html || '');
	const heading = raw.match(/<h([1-6])[^>]*>\s*(?:Ingredients|You(?:'|’)?ll\s+Need)\s*<\/h\1>/i);
	if (!heading || heading.index == null) return [];
	const level = Number(heading[1]) || 2;
	const start = heading.index + heading[0].length;
	const rest = raw.slice(start);
	const nextHeading = rest.match(new RegExp(`<h([1-${level}])\\b`, 'i'));
	const section = nextHeading && nextHeading.index != null
		? rest.slice(0, nextHeading.index)
		: rest.slice(0, 4000);

	const listItems = [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
		.map((m) => stripTags(m[1]))
		.filter(Boolean);
	if (listItems.length > 0) return ingredientsToArray(listItems);

	const itemprop = [...section.matchAll(/itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)(?:<\/[^>]+>)/gi)]
		.map((m) => stripTags(m[1]))
		.filter(Boolean);
	if (itemprop.length > 0) return ingredientsToArray(itemprop);

	const wprm = [...section.matchAll(/wprm-recipe-ingredient[^>]*>([\s\S]*?)(?:<\/li>|<\/div>)/gi)]
		.map((m) => stripTags(m[1]))
		.filter(Boolean);
	return ingredientsToArray(wprm);
}

/**
 * Extract real ingredients from HTML (JSON-LD → Ingredients heading → empty).
 * @param {string} html
 * @returns {string[]}
 */
export function extractIngredientsFromHtml(html) {
	const fromLd = extractIngredientsFromJsonLd(html);
	if (fromLd.length > 0) return fromLd;
	return extractIngredientsFromIngredientsHeading(html);
}

/**
 * Collect source ingredients already attached to an article object (no network).
 * @param {object} article
 * @returns {string[]}
 */
export function extractSourceIngredientsFromArticle(article = {}) {
	const candidates = [
		article?.sourceIngredients,
		article?.ingredients,
		article?.recipe_schema?.recipeIngredient,
		article?.recipeSchema?.recipeIngredient,
		article?.recipe?.ingredients,
		article?.recipe?.recipeIngredient,
	];
	for (const candidate of candidates) {
		const list = ingredientsToArray(candidate);
		if (list.length > 0) return list;
	}
	const fromSections = extractIngredientsFromSections(article?.sections);
	if (fromSections) return ingredientsToArray(fromSections);
	if (article?.content) {
		const fromHtml = extractIngredientsFromHtml(String(article.content));
		if (fromHtml.length > 0) return fromHtml;
	}
	return [];
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

const MATCH_NOISE = /\b(\d+[\/.\d]*|¼|½|¾|⅓|⅔|⅛|cup|cups|tablespoons?|teaspoons?|tbsp|tsp|oz|ounces?|lb|lbs|g|kg|ml|l|pinch|optional|divided|to|taste|or|and|of|a|an|the|your|favorite|toppings?)\b/gi;

/**
 * Normalize an ingredient line for fuzzy traceability checks.
 * @param {string} value
 * @returns {string}
 */
export function normalizeIngredientMatchKey(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/\([^)]*\)/g, ' ')
		.replace(MATCH_NOISE, ' ')
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * True when an AI line is traceable to at least one source ingredient.
 * @param {string} aiItem
 * @param {string[]} sourceItems
 */
export function isIngredientTraceableToSource(aiItem, sourceItems = []) {
	const aiNorm = normalizeIngredientMatchKey(aiItem);
	if (!aiNorm || aiNorm.length < 2) return false;
	const aiTokens = aiNorm.split(/\s+/).filter((t) => t.length > 2);
	if (aiTokens.length === 0) return false;

	return (sourceItems || []).some((src) => {
		const srcNorm = normalizeIngredientMatchKey(src);
		if (!srcNorm) return false;
		if (srcNorm.includes(aiNorm) || aiNorm.includes(srcNorm)) return true;
		return aiTokens.every((token) => srcNorm.includes(token));
	});
}

/**
 * Validate AI-condensed ingredients against the real source list.
 * @param {unknown} aiIngredients
 * @param {unknown} sourceIngredients
 * @returns {{ ok: boolean, ingredients: string[], reason: string }}
 */
export function validateCondensedIngredients(aiIngredients, sourceIngredients) {
	const source = ingredientsToArray(sourceIngredients);
	if (source.length === 0) {
		return { ok: false, ingredients: [], reason: 'no_source' };
	}

	const aiList = ingredientsToArray(aiIngredients);
	if (aiList.length === 0) {
		return { ok: false, ingredients: [], reason: 'empty_ai' };
	}

	const validated = [];
	for (const item of aiList) {
		if (!isIngredientTraceableToSource(item, source)) {
			return { ok: false, ingredients: [], reason: 'invented_or_untraceable' };
		}
		validated.push(item);
		if (validated.length >= INGREDIENTS_PIN_TARGET_MAX) break;
	}

	return { ok: true, ingredients: validated, reason: 'validated' };
}

/**
 * Choose final pin ingredients: validated AI condensation, else normalized source, else empty.
 * Never invents when source is missing.
 * @param {{ sourceIngredients?: unknown, aiIngredients?: unknown }} input
 * @returns {string} newline-separated list for {{ingredients}}
 */
export function resolvePinIngredients({ sourceIngredients = [], aiIngredients = null } = {}) {
	const source = ingredientsToArray(sourceIngredients);
	if (source.length === 0) return '';

	const validated = validateCondensedIngredients(aiIngredients, source);
	if (validated.ok && validated.ingredients.length > 0) {
		return formatIngredientsList(validated.ingredients, { maxItems: INGREDIENTS_PIN_TARGET_MAX });
	}

	const maxItems = source.length <= 6 ? source.length : INGREDIENTS_PIN_TARGET_MAX;
	return formatIngredientsList(source, { maxItems });
}
