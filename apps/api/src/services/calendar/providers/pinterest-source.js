/**
 * Live PocketBase source for Pinterest calendar projection.
 * Isolated so facade unit tests never import this module.
 */

import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { andWorkspaceScope } from '../../workspace-ownership.js';

/**
 * Fetch workspace-scoped Pinterest publish jobs that have a schedule time.
 * Status / date range filtering is applied by the facade (channel-agnostic).
 */
export async function fetchPinterestPublishJobsForCalendar(ctx = {}) {
	const req = ctx.req;
	if (!req) return [];

	const scope = andWorkspaceScope(req);
	const jobs = await pocketbaseClient.collection('pinterest_publish_jobs').getFullList({
		filter: scope,
		sort: 'scheduled_at',
		expand: 'ai_pin',
		requestKey: null,
	}).catch(() => []);

	return (jobs || []).filter((job) => job?.scheduled_at);
}
