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

export {
	buildFacebookAnalyticsSummary,
	defaultFacebookJobPerformance,
	mapFacebookAnalyticsJobItem,
} from './analytics-rollup.js';

/**
 * Workspace-scoped Facebook publishing analytics rollup.
 *
 * @param {import('express').Request} req
 */
export async function getFacebookPublishingAnalytics(req) {
	const publishedFilter = await buildSchemaSafeFilter({
		collection: FACEBOOK_JOB_COLLECTION,
		context: 'facebook-analytics:published',
		parts: [
			{ field: 'owner', expression: andWorkspaceScope(req) },
			{
				field: 'status',
				expression: pocketbaseClient.filter('status = {:status}', { status: 'published' }),
			},
		],
	});
	const failedFilter = await buildSchemaSafeFilter({
		collection: FACEBOOK_JOB_COLLECTION,
		context: 'facebook-analytics:failed',
		parts: [
			{ field: 'owner', expression: andWorkspaceScope(req) },
			{
				field: 'status',
				expression: pocketbaseClient.filter('status = {:status}', { status: 'failed' }),
			},
		],
	});
	const scheduledFilter = await buildSchemaSafeFilter({
		collection: FACEBOOK_JOB_COLLECTION,
		context: 'facebook-analytics:scheduled',
		parts: [
			{ field: 'owner', expression: andWorkspaceScope(req) },
			{
				field: 'status',
				expression: pocketbaseClient.filter('status = {:status}', { status: 'scheduled' }),
			},
		],
	});

	const [published, failedCount, scheduledCount] = await Promise.all([
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

	const summary = buildFacebookAnalyticsSummary(published, {
		failed: failedCount.totalItems,
		scheduled: scheduledCount.totalItems,
	});

	return {
		summary,
		items: published.map((item) => mapFacebookAnalyticsJobItem(item, item.expand?.ai_pin || null)),
	};
}
