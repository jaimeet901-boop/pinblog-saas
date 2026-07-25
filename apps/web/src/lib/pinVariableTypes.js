/**
 * Variable type registry constants — never hardcode types in resolvers.
 */

export const VARIABLE_TYPES = Object.freeze({
	STATIC: 'static',
	DYNAMIC: 'dynamic',
	COMPUTED: 'computed',
	CONDITIONAL: 'conditional',
	AI: 'ai-generated',
	USER: 'user-defined',
});

export const VARIABLE_NAMESPACES = Object.freeze([
	'post',
	'recipe',
	'author',
	'website',
	'brand',
	'image',
	'legacy',
	'ai',
	'user',
	'custom',
]);

export const VARIABLE_FORMATTERS = Object.freeze([
	'uppercase',
	'lowercase',
	'capitalize',
	'truncate',
	'date',
	'number',
]);
