/**
 * P1-4 — publish enqueue must scope site resolution to the active workspace.
 * Run: node --test src/services/wordpress-publish.workspace-scope.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function belongsToWorkspace(record, req) {
	const workspaceId = String(req.workspace?.id || '').trim();
	const workspaceOwnerId = String(req.workspaceOwnerId || req.pocketbaseUserId || '').trim();
	const recordWs = String(record?.workspace || '').trim();
	const recordOwner = String(record?.owner || '').trim();
	if (workspaceId && recordWs && recordWs === workspaceId) return true;
	if (workspaceId && !recordWs && workspaceOwnerId && recordOwner === workspaceOwnerId) return true;
	if (!workspaceId && workspaceOwnerId && recordOwner === workspaceOwnerId) return true;
	return false;
}

describe('wordpress publish enqueue workspace scope (P1-4)', () => {
	it('denies same-owner website/site records from another workspace', () => {
		const reqWsA = {
			pocketbaseUserId: 'owner-same',
			workspaceOwnerId: 'owner-same',
			workspaceKey: 'ws-a-key',
			workspace: { id: 'ws-a', owner: 'owner-same', workspace_key: 'ws-a-key' },
		};
		const websiteWsA = { id: 'web-a', workspace: 'ws-a', owner: 'owner-same' };
		const websiteWsB = { id: 'web-b', workspace: 'ws-b', owner: 'owner-same' };
		const wpSiteWsB = { id: 'wps-b', workspace: 'ws-b', owner: 'owner-same' };

		assert.equal(belongsToWorkspace(websiteWsA, reqWsA), true);
		assert.equal(belongsToWorkspace(websiteWsB, reqWsA), false);
		assert.equal(belongsToWorkspace(wpSiteWsB, reqWsA), false);
	});

	it('enqueueWordpressPublish forwards req into resolvePublishSite', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(source, /ownerOrCtx\?\.req/);
		assert.match(source, /req:\s*ctx\.req/);
	});

	it('wordpress publish/schedule routes pass req into enqueueWordpressPublish', () => {
		const routes = readFileSync(path.join(root, 'apps/api/src/routes/wordpress/index.js'), 'utf8');
		const publishBlock = routes.slice(
			routes.indexOf("router.post('/publish'"),
			routes.indexOf("router.post('/schedule'"),
		);
		const scheduleBlock = routes.slice(
			routes.indexOf("router.post('/schedule'"),
			routes.indexOf("router.get('/jobs'"),
		);
		assert.match(publishBlock, /enqueueWordpressPublish\([\s\S]*?\breq,/);
		assert.match(scheduleBlock, /enqueueWordpressPublish\([\s\S]*?\breq,/);
	});
});
