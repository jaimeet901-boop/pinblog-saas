/**
 * Publishing History list — Option B aggregation over specialized jobs.
 * Pure helpers live in list-pure.js; I/O lives in listPublishingHistory().
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import { andWorkspaceScope } from '../workspace-ownership.js';
import { PUBLISHING_JOB_COLLECTIONS } from './constants.js';
import { normalizePinterestPublishJob } from './normalize-pinterest.js';
import { normalizeWordpressPublishJob } from './normalize-wordpress.js';
import {
	assemblePublishingHistoryResponse,
	computeSourceFetchCap,
	matchesPublishingHistoryFilters,
	nativeStatusExtraFilter,
	parsePublishingHistoryQuery,
	sortPublishingHistoryItems,
} from './list-pure.js';

export {
	PUBLISHING_HISTORY_API_VERSION,
	MIN_SOURCE_FETCH_CAP,
	MAX_SOURCE_FETCH_CAP,
	activityTimestamp,
	assemblePublishingHistoryResponse,
	buildPublishingHistoryCounts,
	computeSourceFetchCap,
	matchesPublishingHistoryFilters,
	nativeStatusExtraFilter,
	paginatePublishingHistoryItems,
	parsePublishingHistoryQuery,
	sortPublishingHistoryItems,
} from './list-pure.js';

async function fetchSourceJobs({
	collection,
	req,
	fetchCap,
	sort,
	expand,
	extraFilter,
}) {
	const filter = andWorkspaceScope(req, extraFilter || '');
	const result = await pocketbaseClient.collection(collection).getList(1, fetchCap, {
		filter,
		sort,
		expand,
		requestKey: null,
	});
	return {
		items: Array.isArray(result?.items) ? result.items : [],
		fetched: Array.isArray(result?.items) ? result.items.length : 0,
		totalItems: Number(result?.totalItems) || 0,
	};
}

/**
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} query
 */
export async function listPublishingHistory(req, query = {}) {
	const parsed = parsePublishingHistoryQuery(query);
	const fetchCap = computeSourceFetchCap(parsed.page, parsed.perPage);
	const warnings = [];
	const normalized = [];
	let truncated = false;
	let anySourceAttempted = false;
	let anySourceSucceeded = false;

	for (const channel of parsed.channels) {
		anySourceAttempted = true;
		const nativeFilter = nativeStatusExtraFilter(channel, parsed.filters.status);
		if (nativeFilter === null) {
			continue;
		}

		try {
			if (channel === 'pinterest') {
				const { items, fetched, totalItems } = await fetchSourceJobs({
					collection: PUBLISHING_JOB_COLLECTIONS.pinterest,
					req,
					fetchCap,
					sort: '-updated,-scheduled_at',
					expand: 'ai_pin,account',
					extraFilter: nativeFilter,
				});
				anySourceSucceeded = true;
				if (fetched >= fetchCap || (totalItems > fetchCap && fetched >= fetchCap)) {
					truncated = true;
				}
				for (const job of items) {
					normalized.push(normalizePinterestPublishJob(job, {
						pin: job.expand?.ai_pin || null,
						sourceModule: 'unknown',
					}));
				}
			} else if (channel === 'wordpress') {
				const { items, fetched, totalItems } = await fetchSourceJobs({
					collection: PUBLISHING_JOB_COLLECTIONS.wordpress,
					req,
					fetchCap,
					sort: '-updated,-created',
					expand: 'site',
					extraFilter: nativeFilter,
				});
				anySourceSucceeded = true;
				if (fetched >= fetchCap || (totalItems > fetchCap && fetched >= fetchCap)) {
					truncated = true;
				}
				for (const job of items) {
					normalized.push(normalizeWordpressPublishJob(job, {
						site: job.expand?.site || null,
						sourceModule: 'unknown',
					}));
				}
			}
		} catch (error) {
			warnings.push({
				channel,
				message: 'Source unavailable',
			});
		}
	}

	if (anySourceAttempted && !anySourceSucceeded && warnings.length > 0) {
		throw httpError(503, 'Publishing history sources unavailable', 'PUBLISHING_HISTORY_UNAVAILABLE');
	}

	const filtered = normalized.filter((item) => matchesPublishingHistoryFilters(item, parsed.filters));
	const sorted = sortPublishingHistoryItems(filtered, parsed.sort);

	return assemblePublishingHistoryResponse({
		items: sorted,
		page: parsed.page,
		perPage: parsed.perPage,
		sort: parsed.sort,
		filters: parsed.filters,
		warnings,
		truncated,
	});
}
