import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACEBOOK_CHANNEL_CAPABILITIES } from './channel-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F7-4 insights sync worker', () => {
	it('registers Facebook analytics sync worker in main startup/shutdown', () => {
		const main = readFileSync(path.join(root, 'apps/api/src/main.js'), 'utf8');

		assert.match(main, /startFacebookAnalyticsSync/);
		assert.match(main, /stopFacebookAnalyticsSync/);
		assert.match(main, /facebook-analytics-sync\.js/);
	});

	it('implements analytics modules without modifying graph publish flow', () => {
		const analytics = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/facebook-analytics.js'),
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

		assert.match(analytics, /fetchFacebookPostInsights/);
		assert.match(analytics, /extractFacebookPostInsightsMetrics/);
		assert.match(sync, /analytics_synced_at/);
		assert.match(sync, /facebook_publish_jobs/);
		assert.doesNotMatch(graph, /facebook-analytics/);
		assert.doesNotMatch(graph, /insights/);
	});

	it('does not expose analytics routes or flip insights capability flags in F7-4', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		const channelPack = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/channel-pack.js'),
			'utf8',
		);

		assert.doesNotMatch(route, /router\.get\(['"]\/analytics['"]/);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, false);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);
		assert.match(channelPack, /insights:\s*false/);
		assert.match(channelPack, /publishingHistory:\s*true/);
	});

	it('keeps frozen subsystems untouched for F7-4', () => {
		const queue = readFileSync(
			path.join(root, 'apps/api/src/services/queue/engine.js'),
			'utf8',
		);
		const calendarFacade = readFileSync(
			path.join(root, 'apps/api/src/services/calendar/facade.js'),
			'utf8',
		);
		const oauthRoute = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');

		assert.doesNotMatch(queue, /facebook-analytics-sync/);
		assert.doesNotMatch(calendarFacade, /facebook-analytics/);
		assert.doesNotMatch(oauthRoute, /facebook-analytics-sync/);
	});

	it('mirrors Pinterest analytics worker registration pattern', () => {
		const main = readFileSync(path.join(root, 'apps/api/src/main.js'), 'utf8');

		assert.match(main, /startPinterestAnalyticsSync\(\)/);
		assert.match(main, /startFacebookAnalyticsSync\(\)/);
		assert.match(main, /stopPinterestAnalyticsSync\(\)/);
		assert.match(main, /stopFacebookAnalyticsSync\(\)/);
	});
});
