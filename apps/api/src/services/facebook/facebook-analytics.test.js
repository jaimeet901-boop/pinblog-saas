import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	extractFacebookPostInsightsMetrics,
	FACEBOOK_POST_INSIGHT_METRICS,
	fetchFacebookPostInsights,
} from './facebook-analytics.js';

describe('facebook-analytics', () => {
	it('requests the approved post insight metrics', () => {
		assert.deepEqual(FACEBOOK_POST_INSIGHT_METRICS, [
			'post_impressions',
			'post_engaged_users',
			'post_clicks',
			'post_reactions_by_type_total',
		]);
	});

	it('extractFacebookPostInsightsMetrics maps Graph insight rows', () => {
		const metrics = extractFacebookPostInsightsMetrics({
			data: [
				{ name: 'post_impressions', values: [{ value: 1200 }] },
				{ name: 'post_engaged_users', values: [{ value: 45 }] },
				{ name: 'post_clicks', values: [{ value: 12 }] },
				{
					name: 'post_reactions_by_type_total',
					values: [{ value: { like: 8, love: 2, wow: 1 } }],
				},
			],
		});

		assert.deepEqual(metrics, {
			impressions: 1200,
			engagedUsers: 45,
			clicks: 12,
			reactions: 11,
		});
	});

	it('extractFacebookPostInsightsMetrics returns nulls for empty payloads', () => {
		assert.deepEqual(extractFacebookPostInsightsMetrics(null), {
			impressions: null,
			engagedUsers: null,
			clicks: null,
			reactions: null,
		});
	});

	it('fetchFacebookPostInsights calls Graph insights endpoint with page token', async () => {
		const calls = [];
		const payload = {
			data: [
				{ name: 'post_impressions', values: [{ value: 500 }] },
			],
		};

		await fetchFacebookPostInsights({
			postId: '123456789_987654321',
			accessToken: 'page-token-plain',
			fetchImpl: async (url) => {
				calls.push(url);
				return {
					ok: true,
					status: 200,
					json: async () => payload,
				};
			},
		});

		assert.equal(calls.length, 1);
		assert.match(calls[0], /\/123456789_987654321\/insights\?/);
		assert.match(calls[0], /metric=post_impressions%2Cpost_engaged_users%2Cpost_clicks%2Cpost_reactions_by_type_total/);
		assert.match(calls[0], /access_token=page-token-plain/);
	});

	it('fetchFacebookPostInsights normalizes Graph errors', async () => {
		await assert.rejects(
			() => fetchFacebookPostInsights({
				postId: '123456789_987654321',
				accessToken: 'page-token-plain',
				fetchImpl: async () => ({
					ok: false,
					status: 403,
					json: async () => ({
						error: {
							message: 'Insufficient permission',
							code: 200,
						},
					}),
				}),
			}),
			(err) => {
				assert.equal(err.status, 403);
				assert.equal(err.errorCode, 'FACEBOOK_GRAPH_PERMISSION_DENIED');
				return true;
			},
		);
	});

	it('fetchFacebookPostInsights requires post id and page token', async () => {
		await assert.rejects(
			() => fetchFacebookPostInsights({ postId: '', accessToken: 'token' }),
			/Facebook post id is required/,
		);
		await assert.rejects(
			() => fetchFacebookPostInsights({ postId: '123_456', accessToken: '' }),
			/Facebook Page access token is required/,
		);
	});
});
