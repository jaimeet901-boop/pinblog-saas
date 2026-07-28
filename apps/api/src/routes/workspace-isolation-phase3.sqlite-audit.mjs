/**
 * Read-only SQLite audit of PocketBase collection rules after Phase 3 migrate.
 * Usage: node apps/api/src/routes/workspace-isolation-phase3.sqlite-audit.mjs [path/to/pb_data]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dataDir = path.resolve(process.argv[2] || path.join(root, 'apps/pocketbase/pb_data'));
const dbPath = path.join(dataDir, 'data.db');

const results = [];
function check(name, pass, detail = '') {
	results.push({ name, pass: Boolean(pass), detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

if (!existsSync(dbPath)) {
	console.error('Missing', dbPath);
	process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

const TENANT = [
	'websites',
	'website_articles',
	'ai_pins',
	'ai_pin_templates',
	'articles',
	'pins',
	'user_settings',
	'brand_kits',
	'pinterest_accounts',
	'pinterest_boards',
	'pinterest_publish_jobs',
	'pinterest_oauth_states',
	'ai_pin_image_jobs',
	'ai_pin_generation_history',
	'workspaces',
	'workspace_members',
];

const cols = db.prepare('SELECT name, listRule, viewRule, createRule, updateRule, deleteRule FROM _collections').all();
const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

const notApiOnly = [];
for (const name of TENANT) {
	const c = byName[name];
	if (!c) {
		check(`Exists ${name}`, false, 'missing');
		continue;
	}
	const apiOnly = [c.listRule, c.viewRule, c.createRule, c.updateRule, c.deleteRule].every((r) => r == null || r === '');
	if (!apiOnly) {
		notApiOnly.push(
			`${name}(L=${c.listRule || '∅'},C=${c.createRule || '∅'})`,
		);
	}
}
check('Tenant collections API-only in SQLite', notApiOnly.length === 0, notApiOnly.join('; ') || 'all null');

const users = byName.users;
check('users collection present', Boolean(users));
const usersLocked =
	users &&
	[users.listRule, users.viewRule, users.createRule, users.updateRule, users.deleteRule].every((r) => r == null || r === '');
check('users not fully locked (auth usable)', !usersLocked, users ? `list=${users.listRule || 'null'}` : 'missing');

const mig = db
	.prepare("SELECT file FROM _migrations WHERE file LIKE '%1783995000%' OR file LIKE '%1783995100%' ORDER BY file")
	.all();
check('Phase 3 rules migration applied', mig.some((m) => String(m.file).includes('1783995000')), mig.map((m) => m.file).join(', ') || 'none');
check('Phase 3 backfill migration applied', mig.some((m) => String(m.file).includes('1783995100')), mig.map((m) => m.file).join(', ') || 'none');

try {
	const blank = db.prepare("SELECT COUNT(*) AS n FROM ai_pin_templates WHERE visibility IS NULL OR visibility = ''").get();
	check('Blank template visibility backfilled', Number(blank?.n || 0) === 0, `blank=${blank?.n}`);
} catch (error) {
	check('Blank template visibility query', false, error.message);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== SQLite Phase 3 Audit (${dataDir}): ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
	for (const f of failed) console.log(' -', f.name, f.detail);
	process.exit(1);
}
process.exit(0);
