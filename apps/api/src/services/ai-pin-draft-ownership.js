/**
 * AI-PINS-03 — validate draft website/article ownership before any ai_pins.create.
 * PocketBase-free so tests can inject getOwnedWebsite / getOwnedWebsiteArticle.
 */

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

export function recordRelationId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

export function stripClientWorkspaceFields(item) {
	const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
	const {
		workspace: _workspace,
		workspaceKey: _workspaceKey,
		workspace_key: _workspace_key,
		...rest
	} = source;
	return rest;
}

export function articleWebsiteId(article) {
	if (!article || typeof article !== 'object') return '';
	return recordRelationId(article.websiteId || article.website_id || article.website);
}

export function articleBelongsToWebsite(article, websiteId) {
	const expected = recordRelationId(websiteId);
	const actual = articleWebsiteId(article);
	return Boolean(expected && actual && expected === actual);
}

export function applySessionWorkspace(payload, req) {
	const workspaceId = String(req?.workspace?.id || '').trim();
	const next = { ...(payload && typeof payload === 'object' ? payload : {}) };
	delete next.workspaceKey;
	delete next.workspace_key;
	next.workspace = workspaceId || undefined;
	return next;
}

/**
 * Validate every draft item against the authenticated workspace.
 * Must run to completion before the first ai_pins.create.
 */
export async function validateDraftItemsOwnership(items, {
	req,
	getOwnedWebsite,
	getOwnedWebsiteArticle,
} = {}) {
	if (typeof getOwnedWebsite !== 'function' || typeof getOwnedWebsiteArticle !== 'function') {
		throw httpError(500, 'Draft ownership validators are required');
	}

	const list = Array.isArray(items) ? items : [];
	const validated = [];

	for (const item of list) {
		const websiteId = recordRelationId(item?.websiteId || item?.website_id);
		const articleId = recordRelationId(item?.articleId || item?.article_id);
		if (!websiteId) {
			throw httpError(422, 'websiteId is required');
		}
		if (!articleId) {
			throw httpError(422, 'articleId is required');
		}

		await getOwnedWebsite({ websiteId, req });
		const article = await getOwnedWebsiteArticle({ articleId, req });
		if (!articleBelongsToWebsite(article, websiteId)) {
			throw httpError(404, 'Article not found');
		}

		validated.push({
			item,
			websiteId,
			articleId,
			article,
		});
	}

	return validated;
}
