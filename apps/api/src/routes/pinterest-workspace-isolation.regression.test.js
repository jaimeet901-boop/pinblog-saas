import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const route = read('apps/api/src/routes/pinterest.js');
const boards = read('apps/api/src/services/pinterest-api.js');
const queue = read('apps/api/src/services/pinterest-publish-queue.js');
const history = read('apps/api/src/services/pinterest-publish-history.js');
const seam = read('apps/api/src/services/pinterest-workspace-isolation.js');

describe('Pinterest P0 workspace-isolation contract (static guards)', () => {
	it('wires publish/schedule creation through the workspace stamp seam', () => {
		assert.match(route, /function requireWorkspaceId/);
		assert.match(route, /createPublishJobs\([^]*requireWorkspaceId\(req\)/);
		assert.match(route, /mode: 'publish',\s*req,/);
		assert.match(route, /mode: 'schedule',\s*req,/);
		assert.match(route, /stampPinterestJobCreatePayload\(/);
		assert.match(seam, /export function stampPinterestJobCreatePayload/);
	});

	it('strictly authorizes every mutable job operation', () => {
		for (const marker of [
			"router.patch('/jobs/:jobId'",
			"router.post('/jobs/:jobId/cancel'",
			"router.post('/jobs/:jobId/retry'",
			"router.post('/jobs/:jobId/publish-now'",
		]) {
			const section = route.slice(route.indexOf(marker));
			assert.match(section, /assertStrictWorkspaceRecord/);
			assert.match(section, /assertStrictJobRelations/);
		}
		assert.match(route, /assertPinterestStrictWorkspaceRecord/);
		assert.match(route, /assertPinterestJobRelationConsistency/);
	});

	it('requires same-workspace account and board targets', () => {
		assert.match(route, /assertStrictWorkspaceRecord\(account, req, 'Pinterest account not found'\)/);
		assert.match(route, /assertStrictWorkspaceRecord\(board, req, 'Pinterest board not found'\)/);
		assert.match(route, /getOwnedPinterestBoard\(\{ owner, boardId: nextBoardId, accountId: account.id, req \}\)/);
	});

	it('stamps and scopes synchronized boards by account workspace via seam', () => {
		assert.match(boards, /assertPinterestAccountWorkspaceBound/);
		assert.match(boards, /buildPinterestBoardSyncFilterParams/);
		assert.match(boards, /buildPinterestSyncedBoardPayload/);
		assert.match(seam, /export function assertPinterestAccountWorkspaceBound/);
	});

	it('rejects queue jobs with missing or inconsistent workspace relations via seam', () => {
		assert.match(queue, /assertPinterestQueueWorkspaceIsolation/);
		assert.match(seam, /export function assertPinterestQueueWorkspaceIsolation/);
		assert.match(seam, /Pinterest publish job workspace is missing/);
		assert.match(seam, /Associated AI pin was not found/);
	});

	it('records publish history in the job workspace via seam', () => {
		assert.match(history, /buildPinterestHistoryCreatePayload/);
		assert.match(seam, /export function buildPinterestHistoryCreatePayload/);
		assert.match(queue, /workspaceId,\s*title: pin\.title/);
	});
});
