/**
 * Writer article-images client helper (M3-A).
 * Calls POST /writer-article-images after successful article generation.
 */

/**
 * @param {unknown} value
 * @returns {number} 0–5
 */
export function normalizeClientImageCount(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(5, Math.floor(n)));
}

/**
 * Fetch planned/resolved article images. Never throws for transport failures —
 * returns { ok:false } so Writer generation can still succeed.
 *
 * @param {{
 *   article: object,
 *   imageCount: number,
 *   requestId: string,
 *   fetchFn?: Function,
 * }} params
 */
export async function fetchWriterArticleImages({
	article,
	imageCount,
	requestId,
	fetchFn,
} = {}) {
	const count = normalizeClientImageCount(imageCount);
	if (count <= 0) {
		return { ok: true, skipped: true, images: null };
	}

	let doFetch = fetchFn;
	if (typeof doFetch !== 'function') {
		const { default: apiServerClient } = await import('./apiServerClient.js');
		doFetch = (url, options) => apiServerClient.fetch(url, options);
	}

	try {
		const response = await doFetch('/writer-article-images', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				article,
				imageCount: count,
				requestId: String(requestId || '').trim(),
			}),
		});

		const payload = await response.json().catch(() => ({}));
		if (!response.ok || payload?.ok === false) {
			return {
				ok: false,
				skipped: false,
				images: null,
				errorCode: payload?.errorCode || 'WRITER_ARTICLE_IMAGES_HTTP',
				message: String(payload?.message || 'Article images request failed').slice(0, 200),
			};
		}

		if (payload?.skipped || !payload?.images) {
			return { ok: true, skipped: true, images: null };
		}

		return {
			ok: true,
			skipped: false,
			images: payload.images,
		};
	} catch (error) {
		return {
			ok: false,
			skipped: false,
			images: null,
			errorCode: 'WRITER_ARTICLE_IMAGES_NETWORK',
			message: String(error?.message || 'Network error').slice(0, 200),
		};
	}
}
