/**
 * WordPress article sync helpers for Website Dashboard (P1-11).
 * Uses existing POST /wordpress/sites/:id/sync — no backend changes.
 */

async function readJson(response) {
	return response.json().catch(() => ({}));
}

export function buildWordpressSyncPath(websiteId) {
	const id = String(websiteId || '').trim();
	if (!id) {
		throw new Error('Website id is required to sync WordPress articles');
	}
	return `/wordpress/sites/${encodeURIComponent(id)}/sync`;
}

export function formatWordpressSyncError(payload, status = 0) {
	const message = String(payload?.message || '').trim();
	if (message) {
		return message;
	}
	const code = String(payload?.errorCode || '').trim();
	if (code) {
		return code.replace(/_/g, ' ').toLowerCase();
	}
	if (status) {
		return `WordPress sync failed (${status})`;
	}
	return 'WordPress sync failed';
}

export function buildWordpressSyncSuccessMessage(stats = {}) {
	const fetched = Number(stats.fetched) || 0;
	const created = Number(stats.created) || 0;
	const updated = Number(stats.updated) || 0;
	const deleted = Number(stats.deleted) || 0;
	const unchanged = Number(stats.unchanged) || 0;
	const parts = [];

	if (created > 0) parts.push(`${created} new`);
	if (updated > 0) parts.push(`${updated} updated`);
	if (deleted > 0) parts.push(`${deleted} removed`);
	if (unchanged > 0) parts.push(`${unchanged} unchanged`);

	if (parts.length > 0) {
		return `Synced ${fetched} WordPress posts (${parts.join(', ')}).`;
	}
	if (fetched > 0) {
		return `Synced ${fetched} WordPress posts.`;
	}
	return 'WordPress articles are up to date.';
}

/**
 * Trigger a manual WordPress article sync for the current website.
 *
 * @param {import('@/lib/apiServerClient').default} apiClient
 * @param {string} websiteId
 * @returns {Promise<{ ok: boolean, stats?: Record<string, number>, site?: object, mode?: string }>}
 */
export async function triggerWordpressArticleSync(apiClient, websiteId) {
	const response = await apiClient.fetch(buildWordpressSyncPath(websiteId), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mode: 'manual' }),
	});
	const data = await readJson(response);
	if (!response.ok) {
		throw new Error(formatWordpressSyncError(data, response.status));
	}
	return data;
}
