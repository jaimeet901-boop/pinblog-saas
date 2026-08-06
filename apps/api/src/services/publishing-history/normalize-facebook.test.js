/**
 * F7-2 — Facebook publishing history normalizer tests.
 * Run: node --test src/services/publishing-history/normalize-facebook.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPublishingHistoryId } from './constants.js';
import { normalizeFacebookPublishJob } from './normalize-facebook.js';

describe('normalizeFacebookPublishJob', () => {
	it('produces a complete normalized item from a Facebook job + ai_pin', () => {
		const item = normalizeFacebookPublishJob(
			{
				id: 'fbjob1',
				ai_pin: 'pin1',
				account: 'acc1',
				account_label: 'Chef Business',
				page_id: '123456789',
				page_name: 'Chef IA Page',
				status: 'published',
				scheduled_at: '2026-07-01T10:00:00.000Z',
				published_at: '2026-07-01T10:05:00.000Z',
				timezone: 'UTC',
				attempt_count: 1,
				max_attempts: 3,
				facebook_post_id: '123456789_999',
				facebook_post_url: 'https://www.facebook.com/123456789_999',
				message: 'Try this pasta tonight!',
				websiteId: 'web1',
				created: '2026-07-01T09:00:00.000Z',
				updated: '2026-07-01T10:05:00.000Z',
				performance: { impressions: 120, clicks: 8 },
				analytics_synced_at: '2026-07-02T08:00:00.000Z',
			},
			{
				pin: {
					id: 'pin1',
					title: 'Pasta Post',
					description: 'Delicious pasta',
					overlay_text: 'Try it',
					image_url: 'https://cdn.example/post.png',
					source_url: 'https://blog.example/pasta',
					status: 'published',
				},
				sourceModule: 'ai_pins',
			},
		);

		assert.equal(item.id, 'facebook:fbjob1');
		assert.equal(item.jobId, 'fbjob1');
		assert.equal(item.channel, 'facebook');
		assert.equal(item.jobCollection, 'facebook_publish_jobs');
		assert.equal(item.status, 'published');
		assert.equal(item.title, 'Pasta Post');
		assert.equal(item.subtitle, 'Chef IA Page');
		assert.equal(item.contentType, 'ai_pin');
		assert.equal(item.contentId, 'pin1');
		assert.equal(item.destination.kind, 'page');
		assert.equal(item.destination.targetId, '123456789');
		assert.equal(item.destination.targetLabel, 'Chef IA Page');
		assert.equal(item.destination.externalId, '123456789_999');
		assert.equal(item.destination.externalUrl, 'https://www.facebook.com/123456789_999');
		assert.equal(item.actions.canRetry, false);
		assert.equal(item.actions.canOpenExternal, true);
		assert.equal(item.actions.retryPath, null);
		assert.equal(item.sourceModule, 'ai_pins');
		assert.equal(item.channelPayload.facebookPostId, '123456789_999');
		assert.equal(item.channelPayload.performance.impressions, 120);
		assert.equal(item.channelPayload.analyticsSyncedAt, '2026-07-02T08:00:00.000Z');
		assert.equal(buildPublishingHistoryId('facebook', 'fbjob1'), item.id);
	});

	it('maps failed status to retryable Facebook job actions', () => {
		const item = normalizeFacebookPublishJob({
			id: 'j2',
			status: 'failed',
			last_error: 'Graph API timeout',
			page_id: '123456789',
			created: '2026-07-01T09:00:00.000Z',
			updated: '2026-07-01T09:01:00.000Z',
		});

		assert.equal(item.status, 'failed');
		assert.equal(item.actions.canRetry, true);
		assert.equal(item.actions.canPublishNow, true);
		assert.equal(item.actions.retryPath, '/facebook/jobs/j2/retry');
		assert.equal(item.actions.cancelPath, null);
		assert.equal(item.actions.publishNowPath, '/facebook/jobs/j2/publish-now');
		assert.equal(item.lastError, 'Graph API timeout');
	});

	it('maps scheduled status to cancelable actions', () => {
		const item = normalizeFacebookPublishJob({
			id: 'j3',
			status: 'scheduled',
			page_id: '123456789',
			scheduled_at: '2026-08-01T00:00:00.000Z',
			created: '2026-07-01T09:00:00.000Z',
			updated: '2026-07-01T09:00:00.000Z',
		});

		assert.equal(item.actions.canCancel, true);
		assert.equal(item.actions.cancelPath, '/facebook/jobs/j3/cancel');
		assert.equal(item.actions.canPublishNow, true);
	});

	it('falls back to job title and message when ai_pin is absent', () => {
		const item = normalizeFacebookPublishJob({
			id: 'j4',
			title: 'Standalone Post',
			message: 'Hello Facebook',
			page_name: 'Brand Page',
			status: 'publishing',
			created: '2026-07-01T09:00:00.000Z',
			updated: '2026-07-01T09:00:00.000Z',
		});

		assert.equal(item.title, 'Standalone Post');
		assert.equal(item.description, 'Hello Facebook');
		assert.equal(item.contentType, 'unknown');
		assert.equal(item.status, 'publishing');
	});
});
