/**
 * Facebook read-path helpers (F8-3).
 * Shared workspace scope checks and empty read responses for history/analytics.
 * Pure helpers only — no PocketBase client imports (safe for unit tests).
 */

import {
	assemblePublishingHistoryResponse,
	parsePublishingHistoryQuery,
} from '../publishing-history/list-pure.js';
import { buildFacebookAnalyticsSummary } from './analytics-rollup.js';
import { buildFacebookPublishingHistoryQuery } from './history-query.js';

function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

/**
 * @param {import('express').Request} req
 */
export function hasFacebookWorkspaceReadScope(req) {
	const creatorId = String(req?.pocketbaseUserId || '').trim();
	const workspaceOwnerId = String(
		req?.workspaceOwnerId
		|| (typeof req?.workspace?.owner === 'string' ? req.workspace.owner : recordFieldId(req?.workspace?.owner))
		|| creatorId,
	).trim();
	return Boolean(workspaceOwnerId || creatorId);
}

export function emptyFacebookPublishingAnalytics() {
	return {
		summary: buildFacebookAnalyticsSummary([], { failed: 0, scheduled: 0 }),
		items: [],
	};
}

/**
 * @param {Record<string, unknown>} [query]
 */
export function emptyFacebookPublishingHistoryResponse(query = {}) {
	const parsed = parsePublishingHistoryQuery(buildFacebookPublishingHistoryQuery(query));
	return assemblePublishingHistoryResponse({
		items: [],
		page: parsed.page,
		perPage: parsed.perPage,
		sort: parsed.sort,
		filters: parsed.filters,
		warnings: [],
		truncated: false,
	});
}
