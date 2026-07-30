/**
 * Live PocketBase source for Facebook calendar projection.
 * Isolated so facade unit tests never import this module.
 *
 * Collection may not exist until Facebook publish pipeline ships —
 * always catch and return [] (backward compatible empty feed).
 */

import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { andWorkspaceScope } from '../../workspace-ownership.js';
import { FACEBOOK_JOB_REF_TYPE } from './facebook.js';

/**
 * Fetch workspace-scoped facebook_publish_jobs that have a schedule time.
 * Status / date range filtering is applied by the facade (channel-agnostic).
 */
export async function fetchFacebookPublishJobsForCalendar(ctx = {}) {
	const req = ctx.req;
	if (!req) return [];

	const scope = andWorkspaceScope(req);
	const jobs = await pocketbaseClient.collection(FACEBOOK_JOB_REF_TYPE).getFullList({
		filter: scope,
		sort: 'scheduled_at',
		expand: 'page',
		requestKey: null,
	}).catch(() => []);

	return (jobs || []).filter((job) => job?.scheduled_at);
}
