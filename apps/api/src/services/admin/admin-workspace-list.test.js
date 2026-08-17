/**
 * Admin workspace list identity + search helpers for Assign Plan.
 * Run: node --test src/services/admin/admin-workspace-list.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	adminWorkspaceDtoKey,
	adminWorkspaceMatchesQuery,
	canonicalAdminWorkspaceKey,
} from './admin-workspace-identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspacesSource = readFileSync(join(__dirname, 'workspaces.js'), 'utf8');
const assignSource = readFileSync(
	join(__dirname, '../billing/assign-workspace-plan.js'),
	'utf8',
);

function buildCatalog(count = 120) {
	return Array.from({ length: count }, (_, index) => ({
		name: `Workspace ${index + 1}`,
		owner: `Owner ${index + 1}`,
		ownerEmail: `owner${index + 1}@example.com`,
		workspaceKey: `ws-key-${String(index + 1).padStart(3, '0')}`,
		slug: `workspace-${index + 1}`,
	}));
}

describe('admin workspace DTO canonical key', () => {
	it('always exposes workspace.workspace_key', () => {
		assert.equal(
			canonicalAdminWorkspaceKey({ workspace_key: 'real-workspace' }),
			'real-workspace',
		);
		assert.equal(
			adminWorkspaceDtoKey({ workspace_key: 'real-workspace' }, null),
			'real-workspace',
		);
	});

	it('does not let subscription.workspace_key override the canonical workspace key', () => {
		assert.equal(
			adminWorkspaceDtoKey(
				{ workspace_key: 'canonical-ws' },
				{ workspace_key: 'other-owner-ws' },
			),
			'canonical-ws',
		);
		assert.notEqual(
			adminWorkspaceDtoKey(
				{ workspace_key: 'canonical-ws' },
				{ workspace_key: 'other-owner-ws' },
			),
			'other-owner-ws',
		);
	});

	it('list mapping uses canonicalAdminWorkspaceKey instead of subscription identity', () => {
		assert.match(workspacesSource, /workspaceKey: canonicalAdminWorkspaceKey\(workspace\)/);
		assert.match(
			workspacesSource,
			/workspaceKey: canonicalAdminWorkspaceKey\(workspace\) \|\| workspaceKey/,
		);
		assert.doesNotMatch(
			workspacesSource,
			/base\.workspaceKey = subscription\?\.workspace_key \|\| workspace\.workspace_key/,
		);
		assert.doesNotMatch(
			workspacesSource,
			/workspaceKey: subscription\?\.workspace_key \|\| workspaceKey/,
		);
		assert.doesNotMatch(
			workspacesSource,
			/workspaceKey: subscription\?\.workspace_key \|\| workspace\.workspace_key/,
		);
	});
});

describe('admin workspace search beyond the first 100', () => {
	it('matches a workspace that is not in the first 100 unfiltered rows', () => {
		const catalog = buildCatalog(120);
		const first100 = catalog.slice(0, 100);
		const target = catalog[114];
		assert.equal(first100.some((ws) => ws.workspaceKey === target.workspaceKey), false);
		const byKey = catalog.filter((ws) => adminWorkspaceMatchesQuery(ws, 'ws-key-115'));
		const byEmail = catalog.filter((ws) => adminWorkspaceMatchesQuery(ws, 'owner115@example.com'));
		const byName = catalog.filter((ws) => adminWorkspaceMatchesQuery(ws, 'workspace 115'));
		assert.equal(byKey.length, 1);
		assert.equal(byKey[0].workspaceKey, 'ws-key-115');
		assert.equal(byEmail[0].workspaceKey, 'ws-key-115');
		assert.equal(byName[0].workspaceKey, 'ws-key-115');
	});

	it('reuses GET /admin/v1/workspaces q/page/perPage instead of a new endpoint', () => {
		assert.match(
			workspacesSource,
			/name ~ \{:q\} \|\| billing_email ~ \{:q\} \|\| slug ~ \{:q\} \|\| workspace_key ~ \{:q\}/,
		);
		assert.match(workspacesSource, /adminWorkspaceMatchesQuery\(ws, query\.q\)/);
		assert.match(workspacesSource, /normalizePage\(query, 6\)/);
		assert.doesNotMatch(workspacesSource, /export async function listAssignWorkspaces/);
	});
});

describe('stale assign selection remains fail-closed', () => {
	it('still returns WORKSPACE_NOT_FOUND before any write', () => {
		assert.match(assignSource, /WORKSPACE_NOT_FOUND/);
		const resolveIdx = assignSource.indexOf('resolveExistingWorkspace');
		const createIdx = assignSource.indexOf("collection('workspace_subscriptions').create");
		const updateIdx = assignSource.indexOf("collection('workspace_subscriptions').update");
		assert.ok(resolveIdx > 0 && createIdx > resolveIdx && updateIdx > resolveIdx);
	});
});
