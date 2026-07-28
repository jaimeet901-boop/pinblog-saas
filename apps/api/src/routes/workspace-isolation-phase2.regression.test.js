/**
 * Phase 2 workspace isolation regression (static).
 * Run: node apps/api/src/routes/workspace-isolation-phase2.regression.test.js
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	getWorkspaceActor,
	workspaceScopeFilter,
	andWorkspaceScope,
	recordBelongsToWorkspace,
	stampCreateOwnership,
} from '../services/workspace-ownership.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const results = [];

function check(name, pass, detail = '') {
	results.push({ name, pass: Boolean(pass), detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

function read(rel) {
	return readFileSync(path.join(root, rel), 'utf8');
}

function walkJs(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) {
			if (name === 'node_modules' || name === 'admin') continue;
			walkJs(full, out);
		} else if (name.endsWith('.js') && !name.includes('.test.') && !name.includes('regression')) {
			out.push(full);
		}
	}
	return out;
}

// Unit: ownership helpers
{
	const reqA = {
		pocketbaseUserId: 'user-a',
		workspace: { id: 'ws-a', owner: 'owner-a', workspace_key: 'key-a' },
		workspaceKey: 'key-a',
		workspaceOwnerId: 'owner-a',
	};
	const reqB = {
		pocketbaseUserId: 'user-b',
		workspace: { id: 'ws-b', owner: 'owner-b', workspace_key: 'key-b' },
		workspaceKey: 'key-b',
		workspaceOwnerId: 'owner-b',
	};

	const stamped = stampCreateOwnership(reqA, { title: 'x' });
	check('stampCreateOwnership uses workspace owner', stamped.owner === 'owner-a' && stamped.workspace === 'ws-a');

	const recordWsA = { id: '1', workspace: 'ws-a', owner: 'owner-a' };
	const recordWsB = { id: '2', workspace: 'ws-b', owner: 'owner-b' };
	const legacyA = { id: '3', workspace: '', owner: 'owner-a' };

	check('WS-A record visible to WS-A', recordBelongsToWorkspace(recordWsA, reqA) === true);
	check('WS-B record hidden from WS-A', recordBelongsToWorkspace(recordWsB, reqA) === false);
	check('Legacy empty workspace + owner visible', recordBelongsToWorkspace(legacyA, reqA) === true);
	check('Legacy empty workspace + owner hidden from other WS', recordBelongsToWorkspace(legacyA, reqB) === false);

	const filter = String(workspaceScopeFilter(reqA));
	check('workspaceScopeFilter includes workspace predicate', filter.includes('workspace') && !/^owner\s*=/.test(filter.trim()));
	check('andWorkspaceScope combines extras', String(andWorkspaceScope(reqA, 'status = "draft"')).includes('status'));
	check('getWorkspaceActor returns workspaceOwnerId', getWorkspaceActor(reqA).workspaceOwnerId === 'owner-a');
}

// Static: critical routes no longer use bare owner = pocketbaseUserId filters for lists
{
	const files = [
		'apps/api/src/routes/ai-pins.js',
		'apps/api/src/routes/tenant-content.js',
		'apps/api/src/routes/workspace/queue.js',
		'apps/api/src/routes/websites.js',
	];
	let leaks = [];
	for (const file of files) {
		const src = read(file);
		if (/owner = \{:owner\}.*pocketbaseUserId|filter\('owner = \{:owner\}',\s*\{\s*owner:\s*req\.pocketbaseUserId/.test(src)) {
			leaks.push(file);
		}
		if (/needsOwnerFix/.test(src)) leaks.push(`${file}:needsOwnerFix`);
	}
	check('No owner=pocketbaseUserId list filters in core routes', leaks.length === 0, leaks.join(', ') || 'clean');
}

// Static: helpers adopted
{
	const ownership = read('apps/api/src/services/workspace-ownership.js');
	check('Helpers export assert/get/andWorkspaceScope', ownership.includes('assertWorkspaceOwnedRecord') && ownership.includes('andWorkspaceScope'));
	const pinGen = read('apps/api/src/services/pin-generation.js');
	check('Template snapshot rejects blank as public', /visibility === 'official'\s*;/.test(pinGen.replace(/\s+/g, ' ')) || pinGen.includes("visibility === 'official'") && !pinGen.includes("visibility === 'official' || visibility === ''"));
	const gallery = read('apps/api/src/services/template-gallery.js');
	check('Gallery no longer ORs blank visibility as global', !gallery.includes("'visibility = \"\"'") || gallery.includes('legacy private'));
	check('Gallery getPinTemplate blank not shared', !gallery.includes("visibility === 'official' || visibility === ''"));
}

// Phase 1 still holds
{
	const aiPins = read('apps/api/src/routes/ai-pins.js');
	check('Orphan claim still blocked', aiPins.includes('cannot be claimed'));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== Phase 2 Summary: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
	for (const f of failed) console.log(' -', f.name, f.detail);
	process.exit(1);
}
console.log('Phase 2 gate: PASS — stop for review before Phase 3');
process.exit(0);
