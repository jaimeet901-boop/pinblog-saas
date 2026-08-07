import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStudioDeepLinks } from '../calendar/studio-links.js';
import { buildFacebookHistoryHref } from '../calendar/product-links.js';
import { mapFacebookJobToScheduledItem } from '../calendar/providers/facebook.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

function read(relativePath) {
	return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('facebook F8-4 naming aliases (cosmetic only)', () => {
	it('exposes studioItemId alongside studioPinId in studio deep links', () => {
		const links = buildStudioDeepLinks({ id: 'pin_42', websiteId: 'site_1' });
		assert.equal(links.studioPinId, 'pin_42');
		assert.equal(links.studioItemId, 'pin_42');
		assert.equal(links.studioHref, '/app/ai-pins?websiteId=site_1&pinId=pin_42');
	});

	it('builds Facebook history and studio deep links without breaking Pinterest defaults', () => {
		assert.equal(
			buildFacebookHistoryHref({ websiteId: 'site_1', jobId: 'job_1' }),
			'/app/facebook-history?websiteId=site_1&jobId=job_1',
		);

		const item = mapFacebookJobToScheduledItem({
			id: 'fb_job_1',
			status: 'scheduled',
			scheduled_at: '2026-08-01T12:00:00.000Z',
			websiteId: 'site_1',
			ai_pin: 'pin_fb_1',
			page_id: 'page_9',
			page_label: 'Kitchen Page',
		});

		assert.equal(item.deepLinks.studioPinId, 'pin_fb_1');
		assert.equal(item.deepLinks.studioItemId, 'pin_fb_1');
		assert.equal(item.deepLinks.boardId, 'page_9');
		assert.equal(item.deepLinks.pageName, 'Kitchen Page');
		assert.match(item.deepLinks.studioHref, /^\/app\/ai-facebook-pages\?/);
		assert.match(item.deepLinks.historyHref, /^\/app\/facebook-history\?/);
	});

	it('documents deferred studioItemId alias in architecture notes', () => {
		const architecture = read('docs/facebook-channel-pack-architecture.md');
		assert.match(architecture, /studioItemId/);
		assert.match(architecture, /studioPinId/);
	});

	it('keeps frozen subsystems untouched for F8-4', () => {
		const queue = read('apps/api/src/services/queue/engine.js');
		const graph = read('apps/api/src/services/facebook/graph-publish.js');
		const oauth = read('apps/api/src/services/facebook/oauth-readiness.js');
		const migration = read('apps/pocketbase/pb_migrations/1785400000_facebook_channel_pack.js');

		assert.doesNotMatch(queue, /studioItemId/);
		assert.doesNotMatch(graph, /buildFacebookHistoryHref/);
		assert.doesNotMatch(oauth, /studioItemId/);
		assert.doesNotMatch(migration, /studioItemId/);
	});
});
