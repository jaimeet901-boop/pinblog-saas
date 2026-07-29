/**
 * Phase 1 unit tests — Publishing History normalizers.
 * Run: node --test src/services/publishing-history/publishing-history.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	PUBLISHING_CONTENT_TYPES,
	PUBLISHING_DESTINATION_KINDS,
	PUBLISHING_STATUSES,
	buildPublishingHistoryId,
	normalizePinterestPublishJob,
	normalizePublishingStatus,
	normalizeWordpressPublishJob,
} from './index.js';

describe('publishing-history contract', () => {
	it('exposes generic destination kinds and extended content types', () => {
		assert.ok(PUBLISHING_DESTINATION_KINDS.includes('board'));
		assert.ok(PUBLISHING_DESTINATION_KINDS.includes('website'));
		assert.ok(PUBLISHING_DESTINATION_KINDS.includes('profile'));
		assert.ok(!PUBLISHING_DESTINATION_KINDS.includes('pinterest_board'));
		assert.ok(PUBLISHING_CONTENT_TYPES.includes('recipe'));
		assert.ok(PUBLISHING_CONTENT_TYPES.includes('blog_post'));
		assert.ok(PUBLISHING_CONTENT_TYPES.includes('video'));
		assert.ok(PUBLISHING_CONTENT_TYPES.includes('product'));
	});

	it('maps native statuses including Pinterest waiting_provider', () => {
		assert.equal(normalizePublishingStatus('scheduled'), 'scheduled');
		assert.equal(normalizePublishingStatus('queued'), 'queued');
		assert.equal(
			normalizePublishingStatus('waiting_provider', { waiting_provider: 'publishing' }),
			'publishing',
		);
		assert.ok(PUBLISHING_STATUSES.includes('retrying'));
	});
});

describe('normalizePinterestPublishJob', () => {
	it('produces a complete normalized item from a Pinterest job + pin', () => {
		const item = normalizePinterestPublishJob(
			{
				id: 'pinjob1',
				ai_pin: 'pin1',
				account: 'acc1',
				account_label: 'Chef Acc',
				board_id: 'board1',
				board_name: 'Recipes',
				status: 'published',
				scheduled_at: '2026-07-01T10:00:00.000Z',
				published_at: '2026-07-01T10:05:00.000Z',
				timezone: 'UTC',
				attempt_count: 1,
				max_attempts: 3,
				pinterest_pin_id: 'pp_9',
				pinterest_pin_url: 'https://pinterest.com/pin/9',
				websiteId: 'web1',
				workflow_id: 'wf1',
				created: '2026-07-01T09:00:00.000Z',
				updated: '2026-07-01T10:05:00.000Z',
			},
			{
				pin: {
					id: 'pin1',
					title: 'Pasta Pin',
					description: 'Delicious pasta',
					overlay_text: 'Try it',
					image_url: 'https://cdn.example/pin.png',
					source_url: 'https://blog.example/pasta',
					status: 'published',
				},
				sourceModule: 'ai_pins',
			},
		);

		assert.equal(item.id, 'pinterest:pinjob1');
		assert.equal(item.jobId, 'pinjob1');
		assert.equal(item.channel, 'pinterest');
		assert.equal(item.jobCollection, 'pinterest_publish_jobs');
		assert.equal(item.status, 'published');
		assert.equal(item.title, 'Pasta Pin');
		assert.equal(item.contentType, 'ai_pin');
		assert.equal(item.contentId, 'pin1');
		assert.equal(item.destination.kind, 'board');
		assert.equal(item.destination.targetId, 'board1');
		assert.equal(item.destination.externalUrl, 'https://pinterest.com/pin/9');
		assert.equal(item.actions.canRetry, false);
		assert.equal(item.actions.canOpenExternal, true);
		assert.equal(item.actions.retryPath, null);
		assert.equal(item.workflowId, 'wf1');
		assert.equal(item.sourceModule, 'ai_pins');
		assert.equal(buildPublishingHistoryId('pinterest', 'pinjob1'), item.id);
	});

	it('maps failed status to retryable actions', () => {
		const item = normalizePinterestPublishJob({
			id: 'j2',
			status: 'failed',
			last_error: 'timeout',
			created: '2026-07-01T09:00:00.000Z',
			updated: '2026-07-01T09:01:00.000Z',
		});
		assert.equal(item.status, 'failed');
		assert.equal(item.actions.canRetry, true);
		assert.equal(item.actions.canPublishNow, true);
		assert.equal(item.actions.retryPath, '/pinterest/jobs/j2/retry');
		assert.equal(item.lastError, 'timeout');
	});

	it('maps waiting_provider to publishing', () => {
		const item = normalizePinterestPublishJob({
			id: 'j3',
			status: 'waiting_provider',
			created: '2026-07-01T09:00:00.000Z',
			updated: '2026-07-01T09:00:00.000Z',
		});
		assert.equal(item.status, 'publishing');
		assert.equal(item.nativeStatus, 'waiting_provider');
	});
});

describe('normalizeWordpressPublishJob', () => {
	it('produces a complete normalized item from a WordPress job', () => {
		const item = normalizeWordpressPublishJob(
			{
				id: 'wpjob1',
				site: 'site1',
				article_id: 'art1',
				title: 'My Article',
				excerpt: 'Hello',
				status: 'published',
				wp_status: 'publish',
				wp_post_id: 42,
				wp_post_url: 'https://blog.example/my-article',
				featured_image_url: 'https://cdn.example/feat.jpg',
				attempt_count: 1,
				max_attempts: 3,
				completed_at: '2026-07-02T12:00:00.000Z',
				created: '2026-07-02T11:00:00.000Z',
				updated: '2026-07-02T12:00:00.000Z',
				workflow_id: 'wf-wp',
			},
			{
				site: { id: 'site1', name: 'Food Blog', url: 'https://blog.example' },
				sourceModule: 'writer',
			},
		);

		assert.equal(item.id, 'wordpress:wpjob1');
		assert.equal(item.channel, 'wordpress');
		assert.equal(item.jobCollection, 'publish_jobs');
		assert.equal(item.status, 'published');
		assert.equal(item.title, 'My Article');
		assert.equal(item.contentType, 'article');
		assert.equal(item.contentId, 'art1');
		assert.equal(item.destination.kind, 'website');
		assert.equal(item.destination.targetId, 'site1');
		assert.equal(item.destination.externalId, '42');
		assert.equal(item.destination.externalUrl, 'https://blog.example/my-article');
		assert.equal(item.publishedAt, '2026-07-02T12:00:00.000Z');
		assert.equal(item.actions.canRetry, false);
		assert.equal(item.actions.publishNowPath, null);
		assert.equal(item.sourceModule, 'writer');
		assert.equal(item.channelPayload.wpPostId, 42);
	});

	it('uses blog_post when no article_id', () => {
		const item = normalizeWordpressPublishJob({
			id: 'wp2',
			site: 'site1',
			title: 'Standalone',
			status: 'queued',
			created: '2026-07-02T11:00:00.000Z',
			updated: '2026-07-02T11:00:00.000Z',
		});
		assert.equal(item.contentType, 'blog_post');
		assert.equal(item.status, 'queued');
	});

	it('maps scheduled WordPress job to cancelable actions', () => {
		const item = normalizeWordpressPublishJob({
			id: 'wp3',
			site: 'site1',
			title: 'Later',
			status: 'scheduled',
			scheduled_at: '2026-08-01T00:00:00.000Z',
			created: '2026-07-02T11:00:00.000Z',
			updated: '2026-07-02T11:00:00.000Z',
		});
		assert.equal(item.actions.canCancel, true);
		assert.equal(item.actions.cancelPath, '/wordpress/jobs/wp3/cancel');
		assert.equal(item.actions.canPublishNow, true);
	});
});
