/**
 * Normalize GET /websites payload into unique website records (never article rows).
 */
export function normalizeWebsiteList(payload) {
	const rows = Array.isArray(payload)
		? payload
		: (Array.isArray(payload?.items) ? payload.items : []);
	const seen = new Set();
	const websites = [];

	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const id = String(row.id || '').trim();
		if (!id || seen.has(id)) continue;

		// Article-shaped rows have title + websiteId and no website domain/url/name fields.
		const looksLikeArticle = Boolean(row.title) && Boolean(row.websiteId)
			&& !row.domain && !row.url && !row.name;
		if (looksLikeArticle) continue;

		seen.add(id);
		websites.push(row);
	}

	return websites;
}
