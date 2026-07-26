export const IMAGE_SOURCE_STRATEGY = {
	FEATURED_FIRST: 'featured_first',
	AI_FIRST: 'ai_first',
	ALWAYS_FEATURED: 'always_featured',
	ALWAYS_AI: 'always_ai',
};

export const IMAGE_SOURCE_STRATEGY_OPTIONS = [
	{ value: IMAGE_SOURCE_STRATEGY.FEATURED_FIRST, label: 'Featured Image First (recommended)' },
	{ value: IMAGE_SOURCE_STRATEGY.AI_FIRST, label: 'AI Image First' },
	{ value: IMAGE_SOURCE_STRATEGY.ALWAYS_FEATURED, label: 'Always Featured Image' },
	{ value: IMAGE_SOURCE_STRATEGY.ALWAYS_AI, label: 'Always AI Image' },
];

export function normalizeImageSourceStrategy(value) {
	const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
	const aliases = {
		featured_first: IMAGE_SOURCE_STRATEGY.FEATURED_FIRST,
		featured_image_first: IMAGE_SOURCE_STRATEGY.FEATURED_FIRST,
		prefer_featured: IMAGE_SOURCE_STRATEGY.FEATURED_FIRST,
		ai_first: IMAGE_SOURCE_STRATEGY.AI_FIRST,
		ai_image_first: IMAGE_SOURCE_STRATEGY.AI_FIRST,
		prefer_ai: IMAGE_SOURCE_STRATEGY.AI_FIRST,
		always_featured: IMAGE_SOURCE_STRATEGY.ALWAYS_FEATURED,
		always_featured_image: IMAGE_SOURCE_STRATEGY.ALWAYS_FEATURED,
		always_ai: IMAGE_SOURCE_STRATEGY.ALWAYS_AI,
		always_ai_image: IMAGE_SOURCE_STRATEGY.ALWAYS_AI,
	};
	return aliases[raw] || IMAGE_SOURCE_STRATEGY.FEATURED_FIRST;
}

/** Quota / provider outages should fall back immediately when an article image exists. */
export function isImmediateImageFallbackError(error) {
	const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
	if (status === 402 || status === 429 || status === 503 || status === 504) {
		return true;
	}
	const message = String(error?.message || error?.error || '').toLowerCase();
	return /quota|rate.?limit|insufficient|credit|timeout|timed out|unavailable|not configured|overloaded|capacity|billing|resource.?exhausted|provider.*(fail|error|down)/i.test(message);
}
