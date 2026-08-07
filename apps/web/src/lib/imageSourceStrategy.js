/**
 * Configurable AI Pins image source strategy (Admin → Workspace Config).
 * Resolves whether to use article images, AI generation, and failure fallbacks.
 */

export const IMAGE_SOURCE_STRATEGY = {
	FEATURED_FIRST: 'featured_first',
	AI_FIRST: 'ai_first',
	ALWAYS_FEATURED: 'always_featured',
	ALWAYS_AI: 'always_ai',
};

export const IMAGE_SOURCE_STRATEGY_OPTIONS = [
	{
		value: IMAGE_SOURCE_STRATEGY.AI_FIRST,
		label: 'AI Image First (recommended)',
	},
	{
		value: IMAGE_SOURCE_STRATEGY.FEATURED_FIRST,
		label: 'Featured Image First',
	},
	{
		value: IMAGE_SOURCE_STRATEGY.ALWAYS_FEATURED,
		label: 'Always Featured Image',
	},
	{
		value: IMAGE_SOURCE_STRATEGY.ALWAYS_AI,
		label: 'Always AI Image',
	},
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
	return aliases[raw] || IMAGE_SOURCE_STRATEGY.AI_FIRST;
}

/**
 * Pick the best stored article image URL (featured → content images).
 */
export function pickArticleImageUrl(article = {}) {
	const featured = String(article.featuredImage || article.featured_image || '').trim();
	if (featured) return featured;
	const content = Array.isArray(article.contentImages)
		? article.contentImages
		: Array.isArray(article.content_images)
			? article.content_images
			: [];
	for (const item of content) {
		const url = String(typeof item === 'string' ? item : item?.url || '').trim();
		if (url) return url;
	}
	return String(article.contentImage || article.content_image || '').trim();
}

/**
 * Collect unique article image candidates in fallback order.
 */
export function listArticleImageCandidates(article = {}) {
	const seen = new Set();
	const out = [];
	const push = (value) => {
		const url = String(value || '').trim();
		if (!url || seen.has(url)) return;
		seen.add(url);
		out.push(url);
	};
	push(article.featuredImage || article.featured_image);
	push(article.sourceImageUrl || article.source_image_url);
	const content = Array.isArray(article.contentImages)
		? article.contentImages
		: Array.isArray(article.content_images)
			? article.content_images
			: [];
	for (const item of content) {
		push(typeof item === 'string' ? item : item?.url);
	}
	push(article.contentImage || article.content_image);
	return out;
}

/**
 * @returns {{
 *   useAi: boolean,
 *   requireArticleImage: boolean,
 *   allowArticleFallback: boolean,
 *   imageMode: 'use_featured' | 'generate_ai',
 * }}
 */
export function planImageSource({ strategy, articleImageUrl = '' } = {}) {
	const normalized = normalizeImageSourceStrategy(strategy);
	const hasArticle = Boolean(String(articleImageUrl || '').trim());

	switch (normalized) {
		case IMAGE_SOURCE_STRATEGY.ALWAYS_FEATURED:
			return {
				strategy: normalized,
				useAi: true,
				requireArticleImage: true,
				allowArticleFallback: hasArticle,
				imageMode: 'generate_ai',
			};
		case IMAGE_SOURCE_STRATEGY.ALWAYS_AI:
			return {
				strategy: normalized,
				useAi: true,
				requireArticleImage: false,
				allowArticleFallback: hasArticle,
				imageMode: 'generate_ai',
			};
		case IMAGE_SOURCE_STRATEGY.FEATURED_FIRST:
			return {
				strategy: IMAGE_SOURCE_STRATEGY.FEATURED_FIRST,
				useAi: true,
				requireArticleImage: false,
				allowArticleFallback: hasArticle,
				imageMode: 'generate_ai',
			};
		case IMAGE_SOURCE_STRATEGY.AI_FIRST:
		default:
			return {
				strategy: IMAGE_SOURCE_STRATEGY.AI_FIRST,
				useAi: true,
				requireArticleImage: false,
				allowArticleFallback: hasArticle,
				imageMode: 'generate_ai',
			};
	}
}

/**
 * Map Admin strategy onto Studio default quality chip id.
 */
export function resolveDefaultImageQualityIdFromStrategy(config, qualities) {
	const list = Array.isArray(qualities) ? qualities : [];
	const strategy = normalizeImageSourceStrategy(config?.images?.imageSourceStrategy);
	const featured = list.find((item) => item.imageMode === 'use_featured');
	const ai = list.find((item) => item.imageMode === 'generate_ai');

	if (strategy === IMAGE_SOURCE_STRATEGY.ALWAYS_FEATURED) {
		return featured?.id || ai?.id || list[0]?.id || 'featured';
	}
	if (strategy === IMAGE_SOURCE_STRATEGY.FEATURED_FIRST) {
		return featured?.id || ai?.id || list[0]?.id || 'featured';
	}
	return ai?.id || featured?.id || list[0]?.id || 'featured';
}
