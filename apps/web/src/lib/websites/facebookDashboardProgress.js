/**
 * UI-only helper: detect Facebook studio progress for Website Dashboard setup.
 * Uses existing Facebook history reads — no backend changes.
 */

async function readJson(response) {
	return response.json().catch(() => ({}));
}

/**
 * @returns {Promise<boolean>}
 */
export async function fetchFacebookStudioProgress(apiServerClient, websiteId) {
	const id = String(websiteId || '').trim();
	if (!id) return false;

	try {
		const historyRes = await apiServerClient.fetch(
			`/facebook/history?websiteId=${encodeURIComponent(id)}&perPage=1`,
			{ method: 'GET' },
		);
		const history = await readJson(historyRes);
		return (history?.totalItems || 0) > 0;
	} catch {
		return false;
	}
}

export function buildFacebookStudioHref(websiteId) {
	const params = new URLSearchParams();
	params.set('websiteId', String(websiteId || ''));
	return `/app/ai-facebook-pages?${params.toString()}`;
}
