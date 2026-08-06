import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACEBOOK_CHANNEL_CAPABILITIES } from './channel-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F7-3 publishing history API', () => {
	it('registers GET /facebook/history wired to the facebook history service', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		const historyService = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/history.js'),
			'utf8',
		);

		assert.match(route, /router\.get\('\/history'/);
		assert.match(route, /listFacebookPublishingHistory/);
		assert.match(historyService, /listPublishingHistory/);
		assert.match(historyService, /buildFacebookPublishingHistoryQuery/);
	});

	it('reuses unified publishing history pipeline without a parallel read path', () => {
		const historyService = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/history.js'),
			'utf8',
		);
		const list = readFileSync(
			path.join(root, 'apps/api/src/services/publishing-history/list.js'),
			'utf8',
		);

		assert.doesNotMatch(historyService, /facebook_publish_history/);
		assert.doesNotMatch(historyService, /safeGetList/);
		assert.match(
			readFileSync(path.join(root, 'apps/api/src/services/facebook/history-query.js'), 'utf8'),
			/channel:\s*'facebook'/,
		);
		assert.match(list, /normalizeFacebookPublishJob/);
	});

	it('does not expose analytics or flip insights capability flags in F7-3', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		const channelPack = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/channel-pack.js'),
			'utf8',
		);

		assert.doesNotMatch(route, /router\.get\(['"]\/analytics['"]/);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, false);
		assert.match(channelPack, /insights:\s*false/);
	});

	it('preserves Pinterest history route and unified publishing history route', () => {
		const pinterest = readFileSync(path.join(root, 'apps/api/src/routes/pinterest.js'), 'utf8');
		const publishing = readFileSync(path.join(root, 'apps/api/src/routes/publishing.js'), 'utf8');

		assert.match(pinterest, /router\.get\('\/history'/);
		assert.match(publishing, /listPublishingHistory/);
		assert.doesNotMatch(publishing, /listFacebookPublishingHistory/);
	});

	it('keeps frozen subsystems untouched for F7-3', () => {
		const queue = readFileSync(
			path.join(root, 'apps/api/src/services/queue/engine.js'),
			'utf8',
		);
		const graph = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/graph-publish.js'),
			'utf8',
		);
		const calendarFacade = readFileSync(
			path.join(root, 'apps/api/src/services/calendar/facade.js'),
			'utf8',
		);

		assert.doesNotMatch(queue, /listFacebookPublishingHistory/);
		assert.doesNotMatch(graph, /history\.js/);
		assert.doesNotMatch(calendarFacade, /facebook\/history/);
	});
});
