import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CALENDAR_PROJECTION_HOOKS,
	applyChannelJobProjections,
	projectAnalyticsMetadata,
	projectNotificationState,
	projectQueueState,
	resolveNotificationPolicy,
	slimPerformanceSummary,
} from '../projections/index.js';
import { buildAnalyticsHref } from '../product-links.js';
import { mapPinterestJobToScheduledItem } from '../providers/pinterest.js';
import { mapWordpressJobToScheduledItem } from '../providers/wordpress.js';
import { CALENDAR_CONSOLIDATION_PHASE } from '../calendar-architecture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('calendar projections (C8)', () => {
	it('locks phase C10 and registers projection hooks', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		assert.deepEqual(
			CALENDAR_PROJECTION_HOOKS.map((hook) => hook.id).sort(),
			['analytics', 'notifications', 'queue'],
		);
		assert.equal(CALENDAR_PROJECTION_HOOKS.find((h) => h.id === 'queue').sourceOfTruth, false);
		assert.equal(CALENDAR_PROJECTION_HOOKS.find((h) => h.id === 'analytics').readOnly, true);
		assert.equal(CALENDAR_PROJECTION_HOOKS.find((h) => h.id === 'notifications').emits, false);

		const registry = readFileSync(
			path.join(__dirname, '../providers/registry.js'),
			'utf8',
		);
		assert.match(registry, /resolveQueueMirrorForSource/);
	});

	it('projects queue state without making queue the source of truth', () => {
		const queue = projectQueueState({
			sourceCollection: 'pinterest_publish_jobs',
			sourceId: 'job1',
			status: 'failed',
			attemptCount: 2,
			maxAttempts: 5,
			nextRetryAt: '2026-07-20T12:00:00.000Z',
			progress: 40,
			deadLetter: false,
			queueJobId: 'qj1',
			websiteId: 'site-1',
		});
		assert.equal(queue.queueRef, 'qj1');
		assert.equal(queue.state, 'failed');
		assert.equal(queue.attemptCount, 2);
		assert.equal(queue.sourceOfTruth, false);
		assert.equal(queue.projected, true);
		assert.match(queue.queueHref, /queueJobId=qj1/);
		assert.match(queue.queueHref, /websiteId=site-1/);
	});

	it('projects slim analytics metadata and preserves websiteId on href', () => {
		const { performance, analyticsHref, analytics } = projectAnalyticsMetadata({
			status: 'published',
			websiteId: 'site-9',
			pinId: 'pin9',
			jobId: 'job9',
			performance: {
				impressions: 10,
				saves: 2,
				outboundClicks: 1,
				closeups: 3,
				lastSyncedAt: '2026-07-21T00:00:00.000Z',
				hugeChartPayload: { series: [1, 2, 3] },
			},
		});
		assert.equal(performance.impressions, 10);
		assert.equal(performance.saves, 2);
		assert.equal(performance.hugeChartPayload, undefined);
		assert.equal(performance.readOnly, true);
		assert.equal(analytics.duplicated, false);
		assert.equal(
			analyticsHref,
			buildAnalyticsHref({ websiteId: 'site-9', pinId: 'pin9', jobId: 'job9' }),
		);
		assert.match(analyticsHref, /websiteId=site-9/);
		assert.equal(slimPerformanceSummary(null), null);
	});

	it('exposes notification state for failed and upcoming jobs without emitting', () => {
		const failed = projectNotificationState({ status: 'failed' });
		assert.equal(failed.kind, 'publishing_failed');
		assert.equal(failed.eligible, true);
		assert.equal(failed.emittedByCalendar, false);
		assert.equal(failed.subsystem, 'workspace_notifications');

		const upcoming = resolveNotificationPolicy(
			{ status: 'scheduled', scheduledAt: '2026-07-30T20:00:00.000Z' },
			{ now: new Date('2026-07-30T18:00:00.000Z'), upcomingHours: 24 },
		);
		assert.equal(upcoming.kind, 'upcoming_scheduled');
		assert.equal(upcoming.eligible, true);

		const far = resolveNotificationPolicy(
			{ status: 'scheduled', scheduledAt: '2026-08-15T20:00:00.000Z' },
			{ now: new Date('2026-07-30T18:00:00.000Z'), upcomingHours: 24 },
		);
		assert.equal(far.eligible, false);
	});

	it('attaches projections on Pinterest and WordPress Scheduled Items', () => {
		const pinItem = mapPinterestJobToScheduledItem({
			id: 'pj1',
			status: 'published',
			scheduled_at: '2026-07-10T10:00:00.000Z',
			websiteId: 'site-1',
			ai_pin: 'pin1',
			attempt_count: 1,
			performance: { impressions: 5, saves: 1 },
		}, {
			queueMirror: { id: 'mirror1', status: 'published', attempt_count: 1, progress: 100 },
		});
		assert.equal(pinItem.deepLinks.queue.queueRef, 'mirror1');
		assert.equal(pinItem.deepLinks.queue.sourceOfTruth, false);
		assert.equal(pinItem.deepLinks.analyticsHref.includes('websiteId=site-1'), true);
		assert.equal(pinItem.performance.impressions, 5);
		assert.equal(pinItem.deepLinks.notification.emittedByCalendar, false);

		const wpItem = mapWordpressJobToScheduledItem({
			id: 'wj1',
			status: 'failed',
			scheduled_at: '2026-07-11T10:00:00.000Z',
			website_id: 'site-2',
			title: 'Post',
			attempt_count: 3,
		});
		assert.equal(wpItem.deepLinks.notification.kind, 'publishing_failed');
		assert.equal(wpItem.deepLinks.queue.sourceCollection, 'publish_jobs');
		assert.equal(wpItem.deepLinks.queue.sourceOfTruth, false);
	});

	it('apply helper merges projections without dropping existing deepLinks', () => {
		const { deepLinks, performance } = applyChannelJobProjections(
			{ studioPinId: 'pinZ', liveUrl: 'https://pin.test/1' },
			{ id: 'jobZ', status: 'publishing', attempt_count: 0 },
			{
				sourceCollection: 'pinterest_publish_jobs',
				sourceId: 'jobZ',
				websiteId: 'w1',
				pinId: 'pinZ',
				status: 'publishing',
			},
		);
		assert.equal(deepLinks.studioPinId, 'pinZ');
		assert.equal(deepLinks.queue.state, 'running');
		assert.equal(deepLinks.analytics.href.includes('websiteId=w1'), true);
		assert.equal(performance, null);
	});
});
