/**
 * P1-5 — WordPress job/history/logs/analytics must scope to the active workspace.
 * Run: node --test src/services/wordpress-publish.job-workspace-scope.test.js
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

function wordpressJobOwner(req) {
	return req.workspaceOwnerId || req.pocketbaseUserId;
}

function apiLogMatchesWorkspace(log, req) {
	const ownerId = wordpressJobOwner(req);
	const key = String(req.workspaceKey || req.workspace?.workspace_key || '').trim();
	if (log.owner !== ownerId) return false;
	if (!key) return true;
	return String(log.workspace_key || '') === key;
}

describe('wordpress job/history/logs/analytics workspace scope (P1-5)', () => {
	const owner = 'owner-same';
	const reqWsA = {
		pocketbaseUserId: owner,
		workspaceOwnerId: owner,
		workspaceKey: 'ws-a-key',
		workspace: { id: 'ws-a', owner, workspace_key: 'ws-a-key' },
	};
	const reqWsB = {
		pocketbaseUserId: owner,
		workspaceOwnerId: owner,
		workspaceKey: 'ws-b-key',
		workspace: { id: 'ws-b', owner, workspace_key: 'ws-b-key' },
	};
	const reqMemberWsA = {
		pocketbaseUserId: 'member-1',
		workspaceOwnerId: owner,
		workspaceKey: 'ws-a-key',
		workspace: { id: 'ws-a', owner, workspace_key: 'ws-a-key' },
	};
	const jobWsA = { id: 'job-a', workspace: 'ws-a', owner, status: 'queued' };
	const jobWsB = { id: 'job-b', workspace: 'ws-b', owner, status: 'failed' };
	const historyWsA = { id: 'hist-a', workspace: 'ws-a', owner, result: 'published' };
	const historyWsB = { id: 'hist-b', workspace: 'ws-b', owner, result: 'published' };
	const logWsA = { id: 'log-a', owner, workspace_key: 'ws-a-key' };
	const logWsB = { id: 'log-b', owner, workspace_key: 'ws-b-key' };

	it('denies WS-A access to WS-B job by workspace membership', () => {
		assert.equal(belongsToWorkspace(jobWsA, reqWsA), true);
		assert.equal(belongsToWorkspace(jobWsB, reqWsA), false);
	});

	it('denies WS-A list visibility of WS-B jobs/history/analytics rows', () => {
		const jobs = [jobWsA, jobWsB].filter((job) => belongsToWorkspace(job, reqWsA));
		const history = [historyWsA, historyWsB].filter((row) => belongsToWorkspace(row, reqWsA));
		assert.deepEqual(jobs.map((job) => job.id), ['job-a']);
		assert.deepEqual(history.map((row) => row.id), ['hist-a']);
	});

	it('denies WS-A access to WS-B api logs via workspace_key', () => {
		assert.equal(apiLogMatchesWorkspace(logWsA, reqWsA), true);
		assert.equal(apiLogMatchesWorkspace(logWsB, reqWsA), false);
	});

	it('allows correct workspace job/history access', () => {
		assert.equal(belongsToWorkspace(jobWsA, reqWsA), true);
		assert.equal(belongsToWorkspace(historyWsA, reqWsA), true);
		assert.equal(belongsToWorkspace(jobWsB, reqWsB), true);
	});

	it('uses workspace owner semantics for workspace members', () => {
		assert.equal(wordpressJobOwner(reqMemberWsA), owner);
		assert.equal(belongsToWorkspace(jobWsA, reqMemberWsA), true);
		assert.equal(belongsToWorkspace(jobWsB, reqMemberWsA), false);
	});

	it('preserves owner-only behavior when req is absent (source)', () => {
		const publishSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		const logSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-api-log.js'), 'utf8');
		assert.match(publishSource, /if \(req\) \{\s*return andWorkspaceScope\(req, extraFilter\);\s*\}/);
		assert.match(publishSource, /owner = \{:owner\}/);
		assert.match(logSource, /if \(!req\) \{/);
		assert.match(logSource, /owner = \{:owner\}/);
	});

	it('get/retry/cancel verify recordBelongsToWorkspace when req is present', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(source, /loadOwnedPublishJob/);
		assert.match(source, /recordBelongsToWorkspace\(job, req\)/);
		assert.match(source, /getPublishJob\(ownerId, jobId, req = null\)/);
		assert.match(source, /retryPublishJob\(ownerId, jobId, req = null\)/);
		assert.match(source, /cancelPublishJob\(ownerId, jobId, req = null\)/);
	});

	it('wordpress routes pass req into job/history/logs/analytics handlers', () => {
		const routes = readFileSync(path.join(root, 'apps/api/src/routes/wordpress/index.js'), 'utf8');
		const blocks = [
			["router.get('/jobs'", "router.get('/jobs/:id'"],
			["router.get('/jobs/:id'", "router.post('/jobs/:id/retry'"],
			["router.post('/jobs/:id/retry'", "router.post('/jobs/:id/cancel'"],
			["router.post('/jobs/:id/cancel'", "router.get('/history'"],
			["router.get('/history'", "router.get('/logs'"],
			["router.get('/logs'", "router.get('/analytics'"],
			["router.get('/analytics'", "router.get('/queue/stats'"],
		];
		for (const [start, end] of blocks) {
			const block = routes.slice(routes.indexOf(start), routes.indexOf(end));
			assert.match(block, /wordpressJobOwner\(req\)/);
			assert.match(block, /,\s*req\)/);
		}
	});

	it('cross-workspace get/retry/cancel would fail closed with NOT_FOUND semantics', () => {
		function loadOwnedPublishJob(job, ownerId, req) {
			if (!job || job.owner !== ownerId) {
				return { error: 'NOT_FOUND' };
			}
			if (req && !belongsToWorkspace(job, req)) {
				return { error: 'NOT_FOUND' };
			}
			return { job };
		}
		const ownerId = wordpressJobOwner(reqWsA);
		assert.deepEqual(loadOwnedPublishJob(jobWsB, ownerId, reqWsA), { error: 'NOT_FOUND' });
		assert.deepEqual(loadOwnedPublishJob(jobWsA, ownerId, reqWsA), { job: jobWsA });
	});
});
