import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACEBOOK_CHANNEL_CAPABILITIES } from './channel-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F7-6 analytics rollup & hub integration', () => {
	it('enables insights and analytics capability flags', () => {
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.analytics, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);

		const webCaps = readFileSync(
			path.join(root, 'apps/web/src/lib/facebook/channelCapabilities.js'),
			'utf8',
		);
		assert.match(webCaps, /insights:\s*true/);
		assert.match(webCaps, /analytics:\s*true/);
	});

	it('registers GET /facebook/analytics wired to rollup service', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		const analyticsService = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/analytics.js'),
			'utf8',
		);

		assert.match(route, /router\.get\('\/analytics'/);
		assert.match(route, /getFacebookPublishingAnalytics/);
		assert.match(analyticsService, /buildFacebookAnalyticsSummary/);
		assert.match(analyticsService, /getFacebookPublishingAnalytics/);
		assert.match(analyticsService, /analytics-rollup\.js/);
		assert.match(analyticsService, /FACEBOOK_JOB_COLLECTION/);
	});

	it('reuses F7-4 performance fields without modifying sync worker', () => {
		const rollup = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/analytics-rollup.js'),
			'utf8',
		);
		const sync = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/facebook-analytics-sync.js'),
			'utf8',
		);
		const graph = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/graph-publish.js'),
			'utf8',
		);

		assert.match(rollup, /engagedUsers/);
		assert.match(rollup, /reactions/);
		assert.match(sync, /analytics_synced_at/);
		assert.doesNotMatch(graph, /getFacebookPublishingAnalytics/);
	});

	it('integrates analytics summary into Facebook Hub', () => {
		const hub = readFileSync(
			path.join(root, 'apps/web/src/pages/app/FacebookPage.jsx'),
			'utf8',
		);

		assert.match(hub, /\/facebook\/analytics/);
		assert.match(hub, /capabilities\.analytics/);
		assert.match(hub, /liveAnalytics/);
		assert.match(hub, /tab === 'analytics'/);
	});

	it('keeps publishing history pipeline unchanged for F7-6', () => {
		const history = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/history.js'),
			'utf8',
		);
		const publishingList = readFileSync(
			path.join(root, 'apps/api/src/services/publishing-history/list.js'),
			'utf8',
		);

		assert.match(history, /listPublishingHistory/);
		assert.doesNotMatch(history, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(publishingList, /getFacebookPublishingAnalytics/);
	});

	it('keeps frozen subsystems untouched for F7-6', () => {
		const queue = readFileSync(
			path.join(root, 'apps/api/src/services/queue/engine.js'),
			'utf8',
		);
		const calendarFacade = readFileSync(
			path.join(root, 'apps/api/src/services/calendar/facade.js'),
			'utf8',
		);

		assert.doesNotMatch(queue, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(calendarFacade, /facebook\/analytics/);
	});
});
