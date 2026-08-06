/**
 * Studio template pack resolution (F6-4) — pure, no I/O.
 */

export const STUDIO_TEMPLATE_PACK_KEYS = Object.freeze(['pinterest', 'facebook']);

export const STUDIO_TEMPLATE_PACK_DEFAULTS = Object.freeze({
	pinterest: {
		key: 'pinterest',
		channel: 'pinterest',
		galleryTag: '',
		officialCatalogTag: 'pinterest',
		canvas: { width: 1000, height: 1500 },
	},
	facebook: {
		key: 'facebook',
		channel: 'facebook',
		galleryTag: 'facebook',
		officialCatalogTag: 'facebook',
		canvas: { width: 1200, height: 630 },
	},
});

export function normalizeStudioTemplatePackKey(value) {
	const key = String(value || 'pinterest').trim().toLowerCase();
	return key === 'facebook' ? 'facebook' : 'pinterest';
}

export function resolveTemplatePackKeyForChannel(channel) {
	return normalizeStudioTemplatePackKey(channel === 'facebook' ? 'facebook' : 'pinterest');
}

export function resolveStudioTemplatePackMeta(packKey) {
	const key = normalizeStudioTemplatePackKey(packKey);
	return STUDIO_TEMPLATE_PACK_DEFAULTS[key];
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

export function matchesStudioTemplatePackEntry(template, packKey) {
	const pack = resolveStudioTemplatePackMeta(packKey);
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

export function filterOfficialCatalogByPack(catalog, packKey) {
	const list = Array.isArray(catalog) ? catalog : [];
	return list.filter((entry) => {
		if (entry?.channel) {
			return entry.channel === resolveStudioTemplatePackMeta(packKey).channel;
		}
		return matchesStudioTemplatePackEntry(entry, packKey);
	});
}
