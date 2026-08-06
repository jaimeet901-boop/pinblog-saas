/**
 * F7-3 — Facebook publishing history service tests.
 * Run: node --test src/services/facebook/history.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePublishingHistoryQuery } from '../publishing-history/list-pure.js';
import { normalizeFacebookPublishJob } from '../publishing-history/normalize-facebook.js';
import { buildFacebookPublishingHistoryQuery } from './history-query.js';

describe('buildFacebookPublishingHistoryQuery', () => {
	it('forces facebook channel while preserving pagination and filters', () => {
		const built = buildFacebookPublishingHistoryQuery({
			page: 2,
			perPage: 25,
			status: 'published',
			websiteId: 'web_1',
			sort: '-publishedAt',
		});

		assert.equal(built.channel, 'facebook');
		assert.equal(built.page, 2);
		assert.equal(built.perPage, 25);
		assert.equal(built.status, 'published');
		assert.equal(built.websiteId, 'web_1');
		assert.equal(built.sort, '-publishedAt');
	});

	it('overrides any client-supplied channel param', () => {
		const built = buildFacebookPublishingHistoryQuery({ channel: 'pinterest' });
		assert.equal(built.channel, 'facebook');
	});

	it('parses through the unified publishing history query parser', () => {
		const parsed = parsePublishingHistoryQuery(
			buildFacebookPublishingHistoryQuery({ status: 'published' }),
		);

		assert.deepEqual(parsed.channels, ['facebook']);
		assert.equal(parsed.filters.channel, 'facebook');
		assert.equal(parsed.filters.status, 'published');
	});
});

describe('listFacebookPublishingHistory contract', () => {
	it('uses normalizeFacebookPublishJob output shape for facebook jobs', () => {
		const item = normalizeFacebookPublishJob(
			{
				id: 'fbjob1',
				status: 'failed',
				page_id: '123456789',
				page_name: 'Chef IA Page',
				facebook_post_url: 'https://www.facebook.com/123456789_999',
				created: '2026-07-01T09:00:00.000Z',
				updated: '2026-07-01T10:05:00.000Z',
			},
			{ sourceModule: 'ai_pins' },
		);

		assert.equal(item.channel, 'facebook');
		assert.equal(item.destination.kind, 'page');
		assert.equal(item.actions.retryPath, '/facebook/jobs/fbjob1/retry');
	});
});
