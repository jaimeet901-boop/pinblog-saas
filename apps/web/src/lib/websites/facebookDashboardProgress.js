/**
 * UI-only helper: detect Facebook studio progress for Website Dashboard setup.
 * Uses existing read APIs — no backend changes.
 */

async function readJson(response) {
	return response.json().catch(() => ({}));
}

function normalizeAccounts(payload) {
	if (Array.isArray(payload)) return payload;
	return payload?.items || payload?.accounts || [];
}

function normalizePages(payload) {
	if (Array.isArray(payload)) return payload;
	return payload?.items || payload?.pages || [];
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
		if ((history?.totalItems || 0) > 0) {
			return true;
		}

		const [pinsRes, accountsRes] = await Promise.all([
			apiServerClient.fetch(`/ai-pins/pins?websiteId=${encodeURIComponent(id)}`, { method: 'GET' }),
			apiServerClient.fetch('/facebook/accounts?filter=active', { method: 'GET' }),
		]);
		const pinsPayload = await readJson(pinsRes);
		const accountsPayload = await readJson(accountsRes);
		const pinItems = Array.isArray(pinsPayload?.items) ? pinsPayload.items : [];
		if (pinItems.length === 0) {
			return false;
		}

		const accountList = normalizeAccounts(accountsPayload);
		const pageIds = new Set();
		await Promise.all(accountList.map(async (account) => {
			const accountId = String(account.id || account.accountId || '').trim();
			if (!accountId) return;
			const pagesRes = await apiServerClient.fetch(
				`/facebook/pages?accountId=${encodeURIComponent(accountId)}`,
				{ method: 'GET' },
			);
			const pagesPayload = await readJson(pagesRes);
			for (const page of normalizePages(pagesPayload)) {
				const pageId = String(page.pageId || page.id || '').trim();
				if (pageId) pageIds.add(pageId);
			}
		}));

		return pinItems.some((pin) => {
			const boardId = String(pin.pinterest_board_id || pin.boardId || '').trim();
			return boardId && pageIds.has(boardId);
		});
	} catch {
		return false;
	}
}

export function buildFacebookStudioHref(websiteId) {
	const params = new URLSearchParams();
	params.set('websiteId', String(websiteId || ''));
	return `/app/ai-facebook-pages?${params.toString()}`;
}
