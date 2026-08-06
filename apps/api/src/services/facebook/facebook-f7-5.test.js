import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACEBOOK_CHANNEL_CAPABILITIES } from './channel-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F7-5 publishing history studio integration', () => {
	it('enables publishingHistory capability while keeping insights disabled', () => {
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, false);

		const webCaps = readFileSync(
			path.join(root, 'apps/web/src/lib/facebook/channelCapabilities.js'),
			'utf8',
		);
		assert.match(webCaps, /publishingHistory:\s*true/);
		assert.match(webCaps, /insights:\s*false/);
		assert.match(webCaps, /analytics:\s*false/);
	});

	it('routes Facebook publishing history to /app/facebook-history', () => {
		const products = readFileSync(
			path.join(root, 'apps/web/src/lib/studio/products.js'),
			'utf8',
		);
		const app = readFileSync(path.join(root, 'apps/web/src/App.jsx'), 'utf8');
		const wrapper = readFileSync(
			path.join(root, 'apps/web/src/pages/app/AIFacebookPagesPublishingHistoryPage.jsx'),
			'utf8',
		);

		assert.match(products, /AI_FACEBOOK_PAGES_PRODUCT[\s\S]*publishingHistory:\s*'\/app\/facebook-history'/);
		assert.doesNotMatch(products, /AI_FACEBOOK_PAGES_PRODUCT[\s\S]*publishingHistory:\s*'\/app\/pinterest-history'/);
		assert.match(app, /\/app\/facebook-history/);
		assert.match(app, /AIFacebookPagesPublishingHistoryPage/);
		assert.match(wrapper, /PublishingHistoryPage/);
		assert.match(wrapper, /AI_FACEBOOK_PAGES_PRODUCT/);
	});

	it('productizes shared PublishingHistoryPage for facebook channel', () => {
		const page = readFileSync(
			path.join(root, 'apps/web/src/pages/app/PublishingHistoryPage.jsx'),
			'utf8',
		);
		const adapter = readFileSync(
			path.join(root, 'apps/web/src/services/publishing-history/uiAdapter.js'),
			'utf8',
		);

		assert.match(page, /product = AI_PINS_PRODUCT/);
		assert.match(page, /getPublishingHistoryViewConfig/);
		assert.match(page, /channel: view\.channel/);
		assert.match(page, /view\.jobBase/);
		assert.match(adapter, /toFacebookPublishingHistoryUiRow/);
	});

	it('gates Facebook Hub publishing history link on capability flag', () => {
		const hub = readFileSync(
			path.join(root, 'apps/web/src/pages/app/FacebookPage.jsx'),
			'utf8',
		);

		assert.match(hub, /capabilities\.publishingHistory/);
		assert.match(hub, /\/app\/facebook-history/);
	});

	it('preserves Pinterest publishing history behavior unchanged', () => {
		const products = readFileSync(
			path.join(root, 'apps/web/src/lib/studio/products.js'),
			'utf8',
		);
		const app = readFileSync(path.join(root, 'apps/web/src/App.jsx'), 'utf8');

		assert.match(products, /AI_PINS_PRODUCT[\s\S]*publishingHistory:\s*'\/app\/pinterest-history'/);
		assert.match(app, /\/app\/pinterest-history/);
		assert.match(app, /PublishingHistoryPage/);
	});

	it('keeps frozen subsystems untouched for F7-5', () => {
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

		assert.doesNotMatch(queue, /facebook-history/);
		assert.doesNotMatch(graph, /PublishingHistoryPage/);
		assert.doesNotMatch(calendarFacade, /facebook-history/);
	});
});
