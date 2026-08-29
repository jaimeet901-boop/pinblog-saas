/**
 * On-demand extraction of real recipe ingredients from article HTML.
 * Prefer JSON-LD recipeIngredient, then Ingredients heading lists.
 * Never invents ingredients from titles.
 */

function stripTags(value) {
	return String(value || '')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&#039;|&apos;/gi, "'")
		.replace(/&quot;/gi, '"')
		.replace(/&#(\d+);/g, (_, n) => {
			const code = Number(n);
			return Number.isFinite(code) ? String.fromCharCode(code) : '';
		})
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeIngredientLines(items) {
	const out = [];
	const seen = new Set();
	for (const raw of items || []) {
		const line = String(raw ?? '').replace(/\s+/g, ' ').trim();
		if (!line) continue;
		const key = line.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(line);
		if (out.length >= 40) break;
	}
	return out;
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
		const recipes = collectRecipeNodes(data);
		for (const recipe of recipes) {
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
	return normalizeIngredientLines(lines);
}

/**
 * @param {string} html
 * @returns {string[]}
 */
export function extractIngredientsFromIngredientsHeading(html) {
	const raw = String(html || '');
	const heading = raw.match(/<h([1-6])[^>]*>\s*(?:Ingredients|You(?:'|’)?ll\s+Need)\s*<\/h\1>/i);
	if (!heading || heading.index == null) {
		return [];
	}
	const level = Number(heading[1]) || 2;
	const start = heading.index + heading[0].length;
	const rest = raw.slice(start);
	const nextHeading = rest.match(new RegExp(`<h([1-${level}])\\b`, 'i'));
	let section = nextHeading && nextHeading.index != null ? rest.slice(0, nextHeading.index) : rest.slice(0, 4000);

	// Prefer list items inside the section.
	const listItems = [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
		.map((m) => stripTags(m[1]))
		.filter(Boolean);

	if (listItems.length > 0) {
		return normalizeIngredientLines(listItems);
	}

	const itemprop = [...section.matchAll(/itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)(?:<\/[^>]+>)/gi)]
		.map((m) => stripTags(m[1]))
		.filter(Boolean);
	if (itemprop.length > 0) {
		return normalizeIngredientLines(itemprop);
	}

	const wprm = [...section.matchAll(/wprm-recipe-ingredient[^>]*>([\s\S]*?)(?:<\/li>|<\/div>)/gi)]
		.map((m) => stripTags(m[1]))
		.filter(Boolean);
	return normalizeIngredientLines(wprm);
}

/**
 * Extract real ingredients from article HTML.
 * Order: JSON-LD recipeIngredient → Ingredients heading lists → empty.
 * @param {string} html
 * @returns {string[]}
 */
export function extractIngredientsFromHtml(html) {
	const fromLd = extractIngredientsFromJsonLd(html);
	if (fromLd.length > 0) return fromLd;
	const fromHeading = extractIngredientsFromIngredientsHeading(html);
	if (fromHeading.length > 0) return fromHeading;
	return [];
}
