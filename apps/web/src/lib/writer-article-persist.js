/**
 * Writer article persistence — create vs in-place update.
 * Save Draft and Publish/Schedule must share this so Publish never duplicates a saved draft.
 */

/**
 * @param {string|null|undefined} savedArticleId
 * @returns {{ method: 'POST'|'PATCH', path: string, createsNew: boolean, articleId: string|null }}
 */
export function resolveArticlePersistRequest(savedArticleId) {
	const id = String(savedArticleId || '').trim();
	if (id) {
		return {
			method: 'PATCH',
			path: `/content/articles/${id}`,
			createsNew: false,
			articleId: id,
		};
	}
	return {
		method: 'POST',
		path: '/content/articles',
		createsNew: true,
		articleId: null,
	};
}

/**
 * Top-level payload for POST/PATCH /content/articles (Writer Save + Publish).
 */
export function buildArticlePersistPayload({
	form = {},
	article = {},
	persistBody = null,
	status = 'draft',
	scheduledAt = '',
} = {}) {
	const payload = {
		keyword: form.keyword,
		seo_title: article.seo_title,
		meta_description: article.meta_description,
		slug: article.slug,
		language: form.language,
		country: form.country,
		tone: form.tone,
		body: persistBody,
		status,
	};
	const scheduled = String(scheduledAt || '').trim();
	if (scheduled) {
		payload.scheduled_at = scheduled;
	}
	return payload;
}

/**
 * After a successful persist, resolve the canonical article id (new or existing).
 */
export function resolvePersistedArticleId(savedArticleId, responseRecord) {
	const existing = String(savedArticleId || '').trim();
	if (existing) return existing;
	const created = String(responseRecord?.id || '').trim();
	return created || null;
}

/**
 * Pure simulation of repeated Save/Publish persist decisions (no network).
 * Used by regression tests to prove duplicates are never created once an id exists.
 *
 * @param {Array<'save'|'publish'|'schedule'>} actions
 * @returns {{ articleIds: string[], createCount: number, updateCount: number }}
 */
export function simulateWriterPersistSequence(actions = [], { initialSavedArticleId = null } = {}) {
	let savedArticleId = initialSavedArticleId ? String(initialSavedArticleId) : null;
	let nextId = 1;
	const articleIds = [];
	let createCount = 0;
	let updateCount = 0;

	for (const action of actions) {
		const status = action === 'schedule'
			? 'scheduled'
			: action === 'publish'
				? 'published'
				: 'draft';
		const request = resolveArticlePersistRequest(savedArticleId);
		const response = request.createsNew
			? { id: `art-${nextId++}` }
			: { id: request.articleId };
		if (request.createsNew) createCount += 1;
		else updateCount += 1;
		savedArticleId = resolvePersistedArticleId(savedArticleId, response);
		articleIds.push(savedArticleId);
	}

	return { articleIds, createCount, updateCount, finalSavedArticleId: savedArticleId };
}
