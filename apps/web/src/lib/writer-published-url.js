/**
 * AI Writer published-URL helpers — pure functions for publish response wiring and UI state.
 */

/**
 * Resolve the WordPress permalink from an existing publish API response.
 * Uses only fields returned by the API (never constructs from slug/title).
 *
 * @param {Record<string, unknown>|null|undefined} data
 * @returns {string}
 */
export function resolvePublishedUrlFromResponse(data) {
	if (!data || typeof data !== 'object') return '';
	return String(data.link || data.url || '').trim();
}

/**
 * Whether the "Published successfully" banner should render.
 *
 * @param {{ publishedUrl?: string, publishing?: boolean }} params
 * @returns {boolean}
 */
export function shouldShowPublishedSuccessBanner({ publishedUrl = '', publishing = false } = {}) {
	if (publishing) return false;
	return Boolean(String(publishedUrl || '').trim());
}

/**
 * Media fields preserved across a new AI generation run.
 * Published URL fields are intentionally excluded so a new article does not inherit a prior publish link.
 *
 * @param {{ article?: { featured_image?: string, gallery_images?: unknown[] }|null, previous?: { featured_image?: string, gallery_images?: unknown[] } }} params
 * @returns {{ featured_image: string, gallery_images: unknown[] }}
 */
export function buildGenerationMediaPreserve({ article = null, previous = {} } = {}) {
	const gallery = Array.isArray(article?.gallery_images) && article.gallery_images.length
		? article.gallery_images
		: (Array.isArray(previous?.gallery_images) ? previous.gallery_images : []);

	return {
		featured_image: String(article?.featured_image || previous?.featured_image || '').trim(),
		gallery_images: gallery,
	};
}

/**
 * Whether a successful WordPress publish response should update article.published_url in session state.
 *
 * @param {{ wpStatus?: string, scheduledAt?: string, publishedUrl?: string }} params
 * @returns {boolean}
 */
export function shouldApplyPublishedUrlToArticle({
	wpStatus = '',
	scheduledAt = '',
	publishedUrl = '',
} = {}) {
	if (!String(publishedUrl || '').trim()) return false;
	if (String(scheduledAt || '').trim()) return false;
	return wpStatus === 'publish';
}

/**
 * Build article patch after a successful live publish (not draft/schedule-without-url).
 *
 * @param {Record<string, unknown>} article
 * @param {{ publishedUrl: string, publishedAt: string, customPrompt?: string }} patch
 * @returns {Record<string, unknown>}
 */
export function applyPublishedUrlPatch(article, { publishedUrl, publishedAt, customPrompt = '' } = {}) {
	return {
		...article,
		published_url: String(publishedUrl || '').trim(),
		published_at: String(publishedAt || '').trim(),
		custom_prompt: String(customPrompt || article?.custom_prompt || '').trim(),
	};
}
