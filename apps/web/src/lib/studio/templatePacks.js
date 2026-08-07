/**
 * Product-driven studio template packs (F6-4).
 * Gallery listing is scoped by platform channel — not product name.
 */

export const TEMPLATE_CHANNELS = Object.freeze([
	'pinterest',
	'facebook',
	'instagram',
	'linkedin',
	'twitter',
]);

export const STUDIO_TEMPLATE_PACKS = Object.freeze({
	pinterest: Object.freeze({
		key: 'pinterest',
		channel: 'pinterest',
		galleryTag: '',
		officialCatalogTag: 'pinterest',
		canvas: Object.freeze({ width: 1000, height: 1500 }),
	}),
	facebook: Object.freeze({
		key: 'facebook',
		channel: 'facebook',
		galleryTag: 'facebook',
		officialCatalogTag: 'facebook',
		canvas: Object.freeze({ width: 1200, height: 630 }),
	}),
});

export function normalizeTemplateChannel(value) {
	const channel = String(value || '').trim().toLowerCase();
	if (!channel) return '';
	return TEMPLATE_CHANNELS.includes(channel) ? channel : '';
}

export function resolveGalleryChannel(productOrChannel) {
	if (typeof productOrChannel === 'string') {
		return normalizeTemplateChannel(productOrChannel) || 'pinterest';
	}
	return resolveTemplatePack(productOrChannel).channel;
}

const GALLERY_FILTER_DEFAULTS = Object.freeze({
	q: '',
	category: '',
	status: '',
	visibility: '',
	scope: '',
	library: '',
	sort: 'recently_updated',
	favorite: false,
	recentlyUsed: false,
	tag: '',
	includeArchived: false,
	channel: '',
});

/**
 * Build gallery API filters for a platform channel.
 * Shared by Choose Template modal and Templates page.
 */
export function buildGalleryFiltersForChannel(channel, overrides = {}) {
	return {
		...GALLERY_FILTER_DEFAULTS,
		channel: resolveGalleryChannel(channel),
		...overrides,
	};
}

export function normalizeStudioTemplatePackKey(value) {
	const key = String(value || 'pinterest').trim().toLowerCase();
	return key === 'facebook' ? 'facebook' : 'pinterest';
}

export function resolveTemplatePackKeyForChannel(channel) {
	return normalizeStudioTemplatePackKey(channel === 'facebook' ? 'facebook' : 'pinterest');
}

export function resolveTemplatePackKey(product) {
	const fromProduct = product?.studioAssets?.templatePackKey;
	if (fromProduct) return normalizeStudioTemplatePackKey(fromProduct);
	return resolveTemplatePackKeyForChannel(product?.destinationId);
}

export function resolveTemplatePack(product) {
	const key = resolveTemplatePackKey(product);
	return STUDIO_TEMPLATE_PACKS[key] || STUDIO_TEMPLATE_PACKS.pinterest;
}

export function resolveTemplatePackForChannel(channel) {
	const key = resolveTemplatePackKeyForChannel(channel);
	return STUDIO_TEMPLATE_PACKS[key] || STUDIO_TEMPLATE_PACKS.pinterest;
}

export function getTemplateEntryTags(template = {}) {
	const tags = [
		...(Array.isArray(template.tags) ? template.tags : []),
		...(template.marketplace_meta?.tags || []),
	];
	return tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
}

export function getTemplateEntryCanvas(template = {}) {
	const config = template.configuration || template.config || template;
	const width = Number(config?.canvas?.width);
	const height = Number(config?.canvas?.height);
	return {
		width: Number.isFinite(width) ? width : null,
		height: Number.isFinite(height) ? height : null,
	};
}

export function matchesTemplatePackEntry(template, productOrPackKey) {
	const packKey = typeof productOrPackKey === 'string'
		? productOrPackKey
		: resolveTemplatePackKey(productOrPackKey);
	const pack = STUDIO_TEMPLATE_PACKS[packKey] || STUDIO_TEMPLATE_PACKS.pinterest;
	const tags = getTemplateEntryTags(template);
	const { width, height } = getTemplateEntryCanvas(template);

	if (pack.channel === 'facebook') {
		if (tags.includes('facebook')) return true;
		return width === pack.canvas.width && height === pack.canvas.height;
	}

	if (tags.includes('facebook') || tags.includes('link-post')) return false;
	if (width === 1200 && height === 630) return false;
	if (width === 1080 && height === 1920) return false;
	return true;
}

export function filterTemplatesForPack(templates, productOrPackKey) {
	const list = Array.isArray(templates) ? templates : [];
	return list.filter((template) => matchesTemplatePackEntry(template, productOrPackKey));
}

export function filterOfficialCatalogForPack(catalog, productOrPackKey) {
	const packKey = typeof productOrPackKey === 'string'
		? productOrPackKey
		: resolveTemplatePackKey(productOrPackKey);
	const pack = STUDIO_TEMPLATE_PACKS[packKey] || STUDIO_TEMPLATE_PACKS.pinterest;
	const list = Array.isArray(catalog) ? catalog : [];
	return list.filter((entry) => {
		if (entry?.channel) return entry.channel === pack.channel;
		return matchesTemplatePackEntry(entry, packKey);
	});
}
