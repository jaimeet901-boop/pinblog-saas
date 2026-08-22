/**
 * Admin Assign Plan workspace picker helpers.
 * Run: npx vitest run src/pages/admin/assignWorkspacePicker.test.js
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ASSIGN_WORKSPACE_PER_PAGE,
	assignWorkspaceSelectValue,
	buildAssignWorkspaceListPath,
	mergeSelectedAssignWorkspace,
} from './assignWorkspacePicker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(path.join(here, 'AdminPlansPage.jsx'), 'utf8');

describe('assign workspace picker', () => {
	it('uses the canonical workspaceKey as the select value', () => {
		assert.equal(
			assignWorkspaceSelectValue({
				workspaceKey: 'canonical-ws',
				name: 'Sunday Kitchen',
			}),
			'canonical-ws',
		);
		assert.match(pageSource, /assignWorkspaceSelectValue/);
		assert.match(pageSource, /value=\{workspaceKey\}/);
		assert.doesNotMatch(pageSource, /subscription\?\.workspace_key/);
	});

	it('searches the existing workspaces endpoint instead of loading the first 100', () => {
		assert.equal(ASSIGN_WORKSPACE_PER_PAGE, 25);
		assert.equal(
			buildAssignWorkspaceListPath('sunday kitchen'),
			'/admin/v1/workspaces?page=1&perPage=25&q=sunday+kitchen',
		);
		assert.equal(
			buildAssignWorkspaceListPath(''),
			'/admin/v1/workspaces?page=1&perPage=25',
		);
		assert.match(pageSource, /buildAssignWorkspaceListPath/);
		assert.doesNotMatch(pageSource, /\/admin\/v1\/workspaces\?perPage=100/);
		assert.doesNotMatch(pageSource, /\/admin\/v1\/assign-workspaces/);
	});

	it('keeps the selected canonical workspace when search results change', () => {
		const selected = { id: 'ws-9', name: 'Kept', workspaceKey: 'canonical-ws' };
		const merged = mergeSelectedAssignWorkspace(
			[{ id: 'ws-1', name: 'Other', workspaceKey: 'other-ws' }],
			selected,
		);
		assert.equal(assignWorkspaceSelectValue(merged[0]), 'canonical-ws');
		assert.equal(merged.some((ws) => assignWorkspaceSelectValue(ws) === 'canonical-ws'), true);
	});
});
