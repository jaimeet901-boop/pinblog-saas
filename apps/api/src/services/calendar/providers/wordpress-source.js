/**
 * Live PocketBase source for WordPress calendar projection.
 * Isolated so facade unit tests never import this module.
 */

import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { andWorkspaceScope } from '../../workspace-ownership.js';

/**
 * Fetch workspace-scoped WordPress publish_jobs that have a schedule time.
 * Status / date range filtering is applied by the facade (channel-agnostic).
 */
export async function fetchWordpressPublishJobsForCalendar(ctx = {}) {
	const req = ctx.req;
	if (!req) return [];

	const scope = andWorkspaceScope(req);
	const jobs = await pocketbaseClient.collection('publish_jobs').getFullList({
		filter: scope,
		sort: 'scheduled_at',
		expand: 'site',
		requestKey: null,
	}).catch(() => []);

	return (jobs || []).filter((job) => job?.scheduled_at);
}
