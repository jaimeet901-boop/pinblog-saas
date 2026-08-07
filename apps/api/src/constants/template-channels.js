/**
 * Template gallery channels — platform-scoped, not product-scoped.
 * Future admin (create/edit/hide/official/premium/order) assigns channel via marketplace_meta.
 */

export const TEMPLATE_CHANNELS = Object.freeze([
	'pinterest',
	'facebook',
	'instagram',
	'linkedin',
	'twitter',
]);

export function normalizeTemplateChannel(value) {
	const channel = String(value || '').trim().toLowerCase();
	if (!channel) return '';
	return TEMPLATE_CHANNELS.includes(channel) ? channel : '';
}

function readMarketplaceMeta(record = {}) {
	return record.marketplace_meta && typeof record.marketplace_meta === 'object'
		? record.marketplace_meta
		: {};
}

function readRecordTags(record = {}) {
	const meta = readMarketplaceMeta(record);
	const tags = meta.tags || meta.Labels || record.tags;
	if (Array.isArray(tags)) {
		return tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
	}
	if (typeof tags === 'string') {
		return tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean);
	}
	return [];
}

/**
 * Resolve the gallery channel for a template record.
 * marketplace_meta.channel (or .pack) is the source of truth when present.
 * Canvas dimensions are legacy fallback only — removed in Phase 2.
 */
export function extractRecordChannel(record = {}) {
	const meta = readMarketplaceMeta(record);
	const explicit = normalizeTemplateChannel(meta.channel || meta.pack);
	if (explicit) return explicit;

	const tags = readRecordTags(record);
	if (tags.includes('facebook') || tags.includes('link-post')) {
		return 'facebook';
	}

	// Legacy fallback for rows created before channel assignment (Phase 1 only).
	const config = record.configuration && typeof record.configuration === 'object'
		? record.configuration
		: {};
	const width = Number(config?.canvas?.width);
	const height = Number(config?.canvas?.height);
	if (width === 1200 && height === 630) return 'facebook';
	if (width === 1080 && height === 1920) return 'facebook';

	return 'pinterest';
}

export function matchesChannelFilter(record, channel) {
	const wanted = normalizeTemplateChannel(channel);
	if (!wanted) return true;
	return extractRecordChannel(record) === wanted;
}
