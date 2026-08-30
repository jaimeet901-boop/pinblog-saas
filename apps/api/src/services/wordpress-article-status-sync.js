/**
 * Sync article status when a WordPress publish job is permanently aborted
 * (terminal failure or user cancellation). Not used for retryable failures.
 */

/**
 * @param {string|null|undefined} articleId
 * @param {{ updateArticle?: (id: string, payload: object) => Promise<unknown> }} [deps]
 * @returns {Promise<boolean>} true when an article update was attempted
 */
export async function syncArticleToDraftOnPublishAbort(articleId, deps = {}) {
	const id = String(articleId || '').trim();
	if (!id) return false;

	if (typeof deps.updateArticle === 'function') {
		await deps.updateArticle(id, { status: 'draft' });
		return true;
	}

	const { default: pocketbaseClient } = await import('../utils/pocketbaseClient.js');
	await pocketbaseClient.collection('articles').update(id, { status: 'draft' });
	return true;
}

/**
 * Terminal publish failure → draft. Retryable failures leave the article unchanged.
 *
 * @param {{ article_id?: string|null }} job
 * @param {{ retryable: boolean, updateArticle?: Function }} options
 */
export async function applyWordpressPublishFailureArticleSync(job, { retryable, updateArticle } = {}) {
	if (retryable) return false;
	return syncArticleToDraftOnPublishAbort(job?.article_id, { updateArticle });
}
