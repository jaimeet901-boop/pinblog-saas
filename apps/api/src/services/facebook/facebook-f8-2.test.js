import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

function read(relativePath) {
	return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('facebook F8-2 frozen subsystem boundary guards', () => {
	it('keeps Queue Engine free of Facebook analytics and history coupling', () => {
		const queue = read('apps/api/src/services/queue/engine.js');
		const ownership = read('apps/api/src/services/queue/ownership.js');

		assert.doesNotMatch(queue, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(queue, /listFacebookPublishingHistory/);
		assert.doesNotMatch(queue, /facebook-analytics-sync/);
		assert.doesNotMatch(ownership, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(ownership, /listFacebookPublishingHistory/);
	});

	it('keeps Calendar core free of Facebook analytics and history routes', () => {
		const facade = read('apps/api/src/services/calendar/facade.js');
		const architecture = read('apps/api/src/services/calendar/calendar-architecture.js');

		assert.doesNotMatch(facade, /facebook\/analytics/);
		assert.doesNotMatch(facade, /facebook\/history/);
		assert.doesNotMatch(facade, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(architecture, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(architecture, /listFacebookPublishingHistory/);
	});

	it('keeps Graph publish free of analytics rollup and history services', () => {
		const graph = read('apps/api/src/services/facebook/graph-publish.js');

		assert.doesNotMatch(graph, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(graph, /listFacebookPublishingHistory/);
		assert.doesNotMatch(graph, /facebook-analytics-sync/);
		assert.doesNotMatch(graph, /normalizeFacebookPublishJob/);
	});

	it('keeps OAuth services free of analytics sync and history service imports', () => {
		const oauthReadiness = read('apps/api/src/services/facebook/oauth-readiness.js');
		const facebookApi = read('apps/api/src/services/facebook/api.js');
		const routes = read('apps/api/src/routes/facebook.js');

		assert.match(routes, /router\.(get|post)\('\/oauth/);
		assert.doesNotMatch(oauthReadiness, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(oauthReadiness, /listFacebookPublishingHistory/);
		assert.doesNotMatch(oauthReadiness, /facebook-analytics-sync/);
		assert.doesNotMatch(facebookApi, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(facebookApi, /listFacebookPublishingHistory/);
		assert.doesNotMatch(facebookApi, /facebook-analytics-sync/);
	});

	it('keeps Credits engine free of publishing history and analytics coupling', () => {
		const credits = read('apps/api/src/services/credits-engine.js');
		const facebookCredits = read('apps/api/src/services/facebook/facebook-publish-credits.js');

		assert.doesNotMatch(credits, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(credits, /listFacebookPublishingHistory/);
		assert.doesNotMatch(credits, /facebook-analytics-sync/);
		assert.doesNotMatch(facebookCredits, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(facebookCredits, /normalizeFacebookPublishJob/);
	});

	it('keeps committed schema migrations free of F7 analytics rollup imports', () => {
		const migration = read('apps/pocketbase/pb_migrations/1785400000_facebook_channel_pack.js');

		assert.doesNotMatch(migration, /getFacebookPublishingAnalytics/);
		assert.doesNotMatch(migration, /facebook-analytics-sync/);
		assert.doesNotMatch(migration, /analytics-rollup/);
		assert.match(migration, /facebook_publish_jobs/);
	});
});
