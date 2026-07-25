/**
 * Built-in variable definitions (namespaces + legacy aliases).
 * Renderer/editor must not hardcode these — they load via registerBuiltInVariables().
 */

import { VARIABLE_TYPES } from './pinVariableTypes.js';
import { getByPath } from './pinVariablePaths.js';

function dyn(path, pick) {
	return {
		id: path,
		namespace: path.includes('.') ? path.split('.')[0] : 'legacy',
		type: VARIABLE_TYPES.DYNAMIC,
		resolve: (ctx) => {
			const fromPath = getByPath(ctx, path);
			if (fromPath != null && fromPath !== '') return fromPath;
			return pick(ctx);
		},
	};
}

function computed(path, compute) {
	return {
		id: path,
		namespace: path.includes('.') ? path.split('.')[0] : 'legacy',
		type: VARIABLE_TYPES.COMPUTED,
		resolve: compute,
	};
}

/**
 * @returns {object[]}
 */
export function getBuiltInVariableDefinitions() {
	return [
		// Namespaced — post
		dyn('post.title', (ctx) => ctx.title ?? ctx.article?.title ?? ctx.post?.title),
		dyn('post.subtitle', (ctx) => ctx.subtitle ?? ctx.article?.subtitle ?? ctx.post?.subtitle),
		dyn('post.description', (ctx) => ctx.description ?? ctx.article?.description ?? ctx.post?.description),
		dyn('post.category', (ctx) => ctx.category ?? ctx.article?.category ?? ctx.post?.category),
		dyn('post.date', (ctx) => ctx.date ?? ctx.article?.date ?? ctx.post?.date),
		dyn('post.reading_time', (ctx) => ctx.reading_time ?? ctx.readingTime ?? ctx.post?.reading_time),
		dyn('post.image', (ctx) => ctx.image ?? ctx.imageUrl ?? ctx.featuredImageUrl ?? ctx.post?.image),

		// Namespaced — recipe
		dyn('recipe.prep_time', (ctx) => ctx.prep_time ?? ctx.prepTime ?? ctx.analysis?.prepTime ?? ctx.recipe?.prep_time),
		dyn('recipe.cook_time', (ctx) => ctx.cook_time ?? ctx.cookTime ?? ctx.analysis?.cookTime ?? ctx.recipe?.cook_time),
		dyn('recipe.total_time', (ctx) => ctx.total_time ?? ctx.totalTime ?? ctx.analysis?.totalTime ?? ctx.recipe?.total_time),
		dyn('recipe.servings', (ctx) => ctx.servings ?? ctx.analysis?.servings ?? ctx.recipe?.servings),
		dyn('recipe.rating', (ctx) => ctx.rating ?? ctx.analysis?.rating ?? ctx.recipe?.rating),
		dyn('recipe.title', (ctx) => ctx.recipe?.title ?? ctx.title),

		// Namespaced — author / website / brand
		dyn('author.name', (ctx) => ctx.author ?? ctx.article?.author ?? ctx.author?.name),
		dyn('website.name', (ctx) => ctx.website ?? ctx.websiteDomain ?? ctx.website?.name),
		dyn('brand.logo', (ctx) => ctx.logo ?? ctx.logoUrl ?? ctx.brand?.logo),
		dyn('brand.primary_color', (ctx) => ctx.brand?.primary_color ?? ctx.brand?.primaryColor ?? ''),

		// Computed example
		computed('recipe.time_label', (ctx) => {
			const total = ctx.total_time ?? ctx.totalTime ?? ctx.recipe?.total_time ?? ctx.analysis?.totalTime;
			if (!total) return '';
			return `${total} total`;
		}),

		// AI-generated placeholders (extension point — resolve from ctx.ai.*)
		{
			id: 'ai.caption',
			namespace: 'ai',
			type: VARIABLE_TYPES.AI,
			resolve: (ctx) => ctx.ai?.caption ?? ctx.aiVariables?.caption ?? '',
		},
		{
			id: 'ai.hook',
			namespace: 'ai',
			type: VARIABLE_TYPES.AI,
			resolve: (ctx) => ctx.ai?.hook ?? ctx.aiVariables?.hook ?? '',
		},

		// Static example
		{
			id: 'brand.cta_default',
			namespace: 'brand',
			type: VARIABLE_TYPES.STATIC,
			value: 'Get the Recipe',
			resolve: () => 'Get the Recipe',
		},

		// Legacy flat tokens (aliases) — backward compatibility
		dyn('title', (ctx) => ctx.title ?? ctx.article?.title ?? ctx.post?.title),
		dyn('subtitle', (ctx) => ctx.subtitle ?? ctx.post?.subtitle),
		dyn('description', (ctx) => ctx.description ?? ctx.post?.description),
		dyn('image', (ctx) => ctx.image ?? ctx.imageUrl ?? ctx.featuredImageUrl),
		dyn('logo', (ctx) => ctx.logo ?? ctx.logoUrl ?? ctx.brand?.logo),
		dyn('author', (ctx) => ctx.author ?? ctx.author?.name),
		dyn('website', (ctx) => ctx.website ?? ctx.websiteDomain),
		dyn('category', (ctx) => ctx.category ?? ctx.post?.category),
		dyn('prep_time', (ctx) => ctx.prep_time ?? ctx.prepTime ?? ctx.recipe?.prep_time),
		dyn('cook_time', (ctx) => ctx.cook_time ?? ctx.cookTime ?? ctx.recipe?.cook_time),
		dyn('total_time', (ctx) => ctx.total_time ?? ctx.totalTime ?? ctx.recipe?.total_time),
		dyn('servings', (ctx) => ctx.servings ?? ctx.recipe?.servings),
		dyn('rating', (ctx) => ctx.rating ?? ctx.recipe?.rating),
		dyn('date', (ctx) => ctx.date ?? ctx.post?.date),
		dyn('reading_time', (ctx) => ctx.reading_time ?? ctx.readingTime),
		dyn('cta', (ctx) => ctx.cta ?? ctx.overlayText ?? ctx.brand?.cta_default ?? ctx.category ?? ''),
	];
}

/** Legacy token list for docs / constants sync */
export const LEGACY_VARIABLE_TOKENS = Object.freeze([
	'{{title}}',
	'{{subtitle}}',
	'{{description}}',
	'{{image}}',
	'{{logo}}',
	'{{author}}',
	'{{website}}',
	'{{category}}',
	'{{prep_time}}',
	'{{cook_time}}',
	'{{total_time}}',
	'{{servings}}',
	'{{rating}}',
	'{{date}}',
	'{{reading_time}}',
	'{{cta}}',
]);

export const NAMESPACED_VARIABLE_TOKENS = Object.freeze([
	'{{post.title}}',
	'{{post.subtitle}}',
	'{{post.description}}',
	'{{post.image}}',
	'{{recipe.prep_time}}',
	'{{recipe.cook_time}}',
	'{{recipe.total_time}}',
	'{{recipe.servings}}',
	'{{recipe.rating}}',
	'{{author.name}}',
	'{{website.name}}',
	'{{brand.logo}}',
	'{{brand.primary_color}}',
]);
