/**
 * WS-10 Facebook setup progress uses Facebook history only.
 * Run: node --test src/lib/websites/facebookDashboardProgress.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildFacebookStudioHref,
	fetchFacebookStudioProgress,
} from './facebookDashboardProgress.js';

function mockClient(routes) {
	const calls = [];
	return {
		calls,
		async fetch(url, options) {
			calls.push({ url: String(url), method: options?.method || 'GET' });
			const match = routes.find((route) => String(url).startsWith(route.prefix));
			if (!match) {
				return {
					ok: false,
					json: async () => ({}),
				};
			}
			return {
				ok: true,
				json: async () => match.body,
			};
		},
	};
}

describe('WS-10 fetchFacebookStudioProgress', () => {
	it('returns true when Facebook history has totalItems > 0', async () => {
		const client = mockClient([
			{ prefix: '/facebook/history', body: { totalItems: 2, items: [{ id: 'job_1' }] } },
			{ prefix: '/ai-pins/pins', body: { items: [{ pinterest_board_id: 'page_1' }] } },
			{ prefix: '/facebook/accounts', body: { items: [{ id: 'acc_1' }] } },
			{ prefix: '/facebook/pages', body: { items: [{ pageId: 'page_1' }] } },
		]);

		assert.equal(await fetchFacebookStudioProgress(client, 'site_1'), true);
		assert.equal(client.calls.length, 1);
		assert.match(client.calls[0].url, /\/facebook\/history\?websiteId=site_1/);
		assert.equal(client.calls.some((call) => call.url.includes('/ai-pins/pins')), false);
	});

	it('returns false when Facebook history is empty', async () => {
		const client = mockClient([
			{ prefix: '/facebook/history', body: { totalItems: 0, items: [] } },
		]);

		assert.equal(await fetchFacebookStudioProgress(client, 'site_1'), false);
	});

	it('does not treat a Pinterest board ID that matches a Facebook page ID as Facebook progress', async () => {
		const client = mockClient([
			{ prefix: '/facebook/history', body: { totalItems: 0, items: [] } },
			{ prefix: '/ai-pins/pins', body: { items: [{ pinterest_board_id: '123456789', boardId: '123456789' }] } },
			{ prefix: '/facebook/accounts', body: { items: [{ id: 'acc_1' }] } },
			{ prefix: '/facebook/pages', body: { items: [{ pageId: '123456789' }] } },
		]);

		assert.equal(await fetchFacebookStudioProgress(client, 'site_1'), false);
		assert.equal(client.calls.some((call) => call.url.includes('/ai-pins/pins')), false);
		assert.equal(client.calls.some((call) => call.url.includes('/facebook/pages')), false);
	});

	it('returns false when there is no Facebook history and does not infer from connected accounts', async () => {
		const client = mockClient([
			{ prefix: '/facebook/history', body: { totalItems: 0, items: [] } },
			{ prefix: '/facebook/accounts', body: { items: [{ id: 'acc_1', status: 'connected' }] } },
		]);

		assert.equal(await fetchFacebookStudioProgress(client, 'site_1'), false);
		assert.equal(client.calls.some((call) => call.url.includes('/facebook/accounts')), false);
	});

	it('returns false when websiteId is missing', async () => {
		const client = mockClient([]);
		assert.equal(await fetchFacebookStudioProgress(client, ''), false);
		assert.equal(client.calls.length, 0);
	});
});

describe('WS-10 Facebook studio CTA helper', () => {
	it('keeps the existing Facebook studio href with websiteId', () => {
		assert.equal(
			buildFacebookStudioHref('site_1'),
			'/app/ai-facebook-pages?websiteId=site_1',
		);
	});
});
