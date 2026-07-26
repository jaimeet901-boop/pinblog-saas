/**
 * Pin Template Engine — shared constants / registries (API).
 * Keep in sync with apps/web/src/lib/pinEngineConstants.js
 */

/** v1 procedural configuration (implicit when layers absent). */
export const DOCUMENT_SCHEMA_VERSION = 1;
/** v2 layer document (editorVersion 2 + layers[]). */
export const DOCUMENT_SCHEMA_VERSION_LAYERS = 2;
/** Reserved — do not emit until migrators exist. */
export const DOCUMENT_SCHEMA_VERSION_V3 = 3;
export const DOCUMENT_SCHEMA_VERSION_V4 = 4;

export const EDITOR_VERSION_PROCEDURAL = 1;
export const EDITOR_VERSION_LAYERS = 2;

export const LAYER_TYPES = Object.freeze([
	'background',
	'image',
	'aiImage',
	'text',
	'shape',
	'badge',
	'sticker',
	'logo',
	'cta',
	'divider',
	'gradient',
]);

export const TEMPLATE_CATEGORIES = Object.freeze([
	'recipes',
	'dinner',
	'breakfast',
	'desserts',
	'snacks',
	'drinks',
	'healthy',
	'lifestyle',
	'home',
	'fitness',
	'travel',
	'finance',
	'technology',
	'diy',
	'general',
]);

export const TEMPLATE_STATUS = Object.freeze([
	'draft',
	'published',
	'archived',
]);

export const TEMPLATE_VISIBILITY = Object.freeze([
	'private',
	'workspace',
	'public',
	'official',
	'community',
]);

export const TEMPLATE_ASSET_SOURCES = Object.freeze([
	'upload',
	'ai',
	'logo',
	'sticker',
	'watermark',
]);

export const RENDER_TARGETS = Object.freeze([
	'png',
	'jpg',
	'webp',
	'pdf',
	'svg',
	'mp4',
]);

export const EXPORT_FORMATS = RENDER_TARGETS;

export const VARIABLE_TOKENS = Object.freeze([
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

export const VARIABLE_NAMESPACES = Object.freeze([
	'post',
	'recipe',
	'author',
	'website',
	'brand',
	'ai',
	'user',
]);

export const TEMPLATE_ENGINE_COLLECTIONS = Object.freeze([
	'ai_pin_templates',
	'ai_pin_template_versions',
	'ai_pin_template_assets',
	'ai_pin_template_favorites',
	'ai_pin_template_preview_cache',
]);

export function isLayerType(value) {
	return LAYER_TYPES.includes(String(value || ''));
}

export function isTemplateCategory(value) {
	return TEMPLATE_CATEGORIES.includes(String(value || ''));
}

export function isTemplateStatus(value) {
	return TEMPLATE_STATUS.includes(String(value || ''));
}

export function isTemplateVisibility(value) {
	return TEMPLATE_VISIBILITY.includes(String(value || ''));
}

export function isRenderTarget(value) {
	return RENDER_TARGETS.includes(String(value || '').toLowerCase());
}

export function isVariableToken(value) {
	return VARIABLE_TOKENS.includes(String(value || ''));
}
