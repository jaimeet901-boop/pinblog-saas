import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildFacebookAnalyticsSummary,
	defaultFacebookJobPerformance,
	mapFacebookAnalyticsJobItem,
} from './analytics-rollup.js';

describe('facebook analytics rollup', () => {
	it('defaultFacebookJobPerformance exposes F7-4 metric fields', () => {
		assert.deepEqual(defaultFacebookJobPerformance(), {
			impressions: null,
			engagedUsers: null,
			clicks: null,
			reactions: null,
			readyForAnalyticsSync: true,
		});
	});

	it('buildFacebookAnalyticsSummary aggregates published job performance', () => {
		const summary = buildFacebookAnalyticsSummary([
			{
				page_name: 'Chef Kitchen Page',
				title: 'Summer promo',
				facebook_post_url: 'https://facebook.com/post/1',
				performance: {
					impressions: 100,
					clicks: 5,
					engagedUsers: 12,
					reactions: 3,
				},
			},
			{
				page_name: 'Backup Page',
				performance: {
					impressions: 50,
					clicks: 2,
					engagedUsers: 4,
					reactions: 1,
				},
			},
		], { failed: 2, scheduled: 4 });

		assert.deepEqual(summary, {
			published: 2,
			failed: 2,
			scheduled: 4,
			impressions: 150,
			clicks: 7,
			engagedUsers: 16,
			reactions: 4,
			bestPage: 'Chef Kitchen Page',
			bestPost: 'Summer promo',
		});
	});

	it('mapFacebookAnalyticsJobItem includes performance and analyticsSyncedAt', () => {
		const item = mapFacebookAnalyticsJobItem({
			id: 'job_1',
			status: 'published',
			page_id: 'page_123',
			page_name: 'Chef Kitchen Page',
			facebook_post_id: '123_456',
			facebook_post_url: 'https://facebook.com/123_456',
			analytics_synced_at: '2026-08-01T12:00:00.000Z',
			performance: {
				impressions: 90,
				engagedUsers: 8,
				clicks: 2,
				reactions: 1,
				lastSyncedAt: '2026-08-01T12:00:00.000Z',
			},
		}, {
			id: 'pin_1',
			title: 'Summer promo',
			description: 'Offer details',
			image_url: 'https://cdn.example/post.jpg',
			status: 'ready',
		});

		assert.equal(item.id, 'job_1');
		assert.equal(item.pageName, 'Chef Kitchen Page');
		assert.equal(item.analyticsSyncedAt, '2026-08-01T12:00:00.000Z');
		assert.equal(item.performance.impressions, 90);
		assert.equal(item.post.title, 'Summer promo');
	});
});
