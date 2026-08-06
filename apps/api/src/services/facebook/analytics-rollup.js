/**
 * Pure Facebook analytics rollup helpers (F7-6).
 * No PocketBase or route dependencies — safe for unit tests.
 */

import { mapFacebookPublishJobDto } from './publish.js';

export function defaultFacebookJobPerformance() {
	return {
		impressions: null,
		engagedUsers: null,
		clicks: null,
		reactions: null,
		readyForAnalyticsSync: true,
	};
}

/**
 * @param {object[]} publishedJobs
 * @param {{ failed?: number, scheduled?: number }} [counts]
 */
export function buildFacebookAnalyticsSummary(publishedJobs = [], counts = {}) {
	const published = Array.isArray(publishedJobs) ? publishedJobs : [];
	const first = published[0] || null;

	return {
		published: published.length,
		failed: Number(counts.failed) || 0,
		scheduled: Number(counts.scheduled) || 0,
		impressions: published.reduce(
			(sum, item) => sum + Number(item?.performance?.impressions || 0),
			0,
		),
		clicks: published.reduce(
			(sum, item) => sum + Number(item?.performance?.clicks || 0),
			0,
		),
		engagedUsers: published.reduce(
			(sum, item) => sum + Number(item?.performance?.engagedUsers || 0),
			0,
		),
		reactions: published.reduce(
			(sum, item) => sum + Number(item?.performance?.reactions || 0),
			0,
		),
		bestPage: String(first?.page_name || first?.page_label || '').trim(),
		bestPost: String(
			first?.expand?.ai_pin?.title
			|| first?.title
			|| first?.facebook_post_url
			|| '',
		).trim(),
	};
}

/**
 * @param {object} record
 * @param {object|null} [pinRecord]
 */
export function mapFacebookAnalyticsJobItem(record, pinRecord = null) {
	const dto = mapFacebookPublishJobDto(record);
	return {
		...dto,
		performance: record?.performance && typeof record.performance === 'object'
			? record.performance
			: defaultFacebookJobPerformance(),
		analyticsSyncedAt: record?.analytics_synced_at || record?.analyticsSyncedAt || null,
		post: pinRecord
			? {
				id: pinRecord.id,
				title: pinRecord.title,
				description: pinRecord.description,
				imageUrl: pinRecord.image_url || '',
				status: pinRecord.status,
			}
			: null,
	};
}
