/**
 * Facebook channel publishing history (F7-3).
 * Thin wrapper over the unified publishing history pipeline.
 */

import { buildFacebookPublishingHistoryQuery } from './history-query.js';
import { listPublishingHistory } from '../publishing-history/list.js';

export { buildFacebookPublishingHistoryQuery } from './history-query.js';

/**
 * List normalized Facebook publishing history for the active workspace.
 *
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} [query]
 */
export async function listFacebookPublishingHistory(req, query = {}) {
	return listPublishingHistory(req, buildFacebookPublishingHistoryQuery(query));
}
