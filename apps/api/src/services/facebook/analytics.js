/**
 * Facebook channel publishing analytics rollup (F7-6).
 * Reads synced performance from facebook_publish_jobs (F7-4 worker).
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { FACEBOOK_JOB_COLLECTION } from './channel-pack.js';
import { andWorkspaceScope } from '../workspace-ownership.js';
import {
	buildSchemaSafeFilter,
	safeGetFullList,
	safeGetList,
} from '../../utils/pocketbase-safe-query.js';
import {
	buildFacebookAnalyticsSummary,
	mapFacebookAnalyticsJobItem,
} from './analytics-rollup.js';
import {
	emptyFacebookPublishingAnalytics,
	hasFacebookWorkspaceReadScope,
} from './read-path.js';

export {
	buildFacebookAnalyticsSummary,
	defaultFacebookJobPerformance,
	mapFacebookAnalyticsJobItem,
} from './analytics-rollup.js';

function statusFilter(status) {
	return pocketbaseClient.filter('status = {:status}', { status });
}

/**
 * Workspace-scoped Facebook publishing analytics rollup.
 *
 * @param {import('express').Request} req
 */
export async function getFacebookPublishingAnalytics(req) {
	if (!hasFacebookWorkspaceReadScope(req)) {
		return emptyFacebookPublishingAnalytics();
	}

	const ownerPart = { field: 'owner', expression: andWorkspaceScope(req) };
	const [publishedFilter, failedFilter, scheduledFilter] = await Promise.all([
		buildSchemaSafeFilter({
			collection: FACEBOOK_JOB_COLLECTION,
			context: 'facebook-analytics:published',
			parts: [
				ownerPart,
				{ field: 'status', expression: statusFilter('published') },
			],
		}),
		buildSchemaSafeFilter({
			collection: FACEBOOK_JOB_COLLECTION,
			context: 'facebook-analytics:failed',
			parts: [
				ownerPart,
				{ field: 'status', expression: statusFilter('failed') },
			],
		}),
		buildSchemaSafeFilter({
			collection: FACEBOOK_JOB_COLLECTION,
			context: 'facebook-analytics:scheduled',
			parts: [
				ownerPart,
				{ field: 'status', expression: statusFilter('scheduled') },
			],
		}),
	]);

	const [publishedRows, failedCount, scheduledCount] = await Promise.all([
		safeGetFullList({
			collection: FACEBOOK_JOB_COLLECTION,
			context: 'facebook-analytics:published',
			sort: '-published_at,-updated',
			filter: publishedFilter.filter,
			expand: 'ai_pin,account',
		}),
		safeGetList({
			collection: FACEBOOK_JOB_COLLECTION,
			context: 'facebook-analytics:failed',
			page: 1,
			perPage: 1,
			filter: failedFilter.filter,
		}),
		safeGetList({
			collection: FACEBOOK_JOB_COLLECTION,
			context: 'facebook-analytics:scheduled',
			page: 1,
			perPage: 1,
			filter: scheduledFilter.filter,
		}),
	]);

	const published = Array.isArray(publishedRows) ? publishedRows : [];
	const summary = buildFacebookAnalyticsSummary(published, {
		failed: Number(failedCount?.totalItems) || 0,
		scheduled: Number(scheduledCount?.totalItems) || 0,
	});

	return {
		summary,
		items: published.map((item) => mapFacebookAnalyticsJobItem(item, item?.expand?.ai_pin || null)),
	};
}
