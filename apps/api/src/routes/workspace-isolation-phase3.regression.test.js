/**
 * Phase 3 — PocketBase security hardening regression (static + rule audit).
 * Run: node apps/api/src/routes/workspace-isolation-phase3.regression.test.js
 *
 * Verifies:
 * - API-only rules migration exists and locks legacy owner-scoped collections
 * - Template visibility backfill migration exists
 * - Frontend still has no tenant pb.collection CRUD
 * - users auth collection is not locked by Phase 3
 * - Phase 1 / Phase 2 isolation gates still hold
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const results = [];

function check(name, pass, detail = '') {
	results.push({ name, pass: Boolean(pass), detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

function read(rel) {
	return readFileSync(path.join(root, rel), 'utf8');
}

const RULES_MIGRATION = 'apps/pocketbase/pb_migrations/1783995000_workspace_isolation_api_only_rules.js';
const BACKFILL_MIGRATION = 'apps/pocketbase/pb_migrations/1783995100_backfill_ai_pin_template_visibility.js';

const LEGACY_OWNER_COLLECTIONS = [
	'websites',
	'website_articles',
	'ai_pins',
	'ai_pin_templates',
	'ai_pin_image_jobs',
	'ai_pin_generation_history',
	'brand_kits',
	'pinterest_boards',
	'pinterest_publish_events',
	'pinterest_oauth_states',
	'articles',
	'pins',
	'user_settings',
	'pinterest_accounts',
	'pinterest_publish_jobs',
];

const FACEBOOK_CHANNEL_COLLECTIONS = [
	'facebook_accounts',
	'facebook_account_secrets',
	'facebook_pages',
	'facebook_oauth_states',
	'facebook_publish_jobs',
	'facebook_publish_events',
	'facebook_publish_history',
];

// --- Migrations exist ---
{
	check('API-only rules migration file exists', existsSync(path.join(root, RULES_MIGRATION)));
	check('Visibility backfill migration file exists', existsSync(path.join(root, BACKFILL_MIGRATION)));
	check(
		'Facebook channel pack migration file exists',
		existsSync(path.join(root, 'apps/pocketbase/pb_migrations/1785400000_facebook_channel_pack.js')),
	);
}

// --- Rules migration content ---
{
	const src = read(RULES_MIGRATION);
	check('Rules migration sets listRule null', /listRule\s*=\s*null/.test(src));
	check('Rules migration sets viewRule null', /viewRule\s*=\s*null/.test(src));
	check('Rules migration sets createRule null', /createRule\s*=\s*null/.test(src));
	check('Rules migration sets updateRule null', /updateRule\s*=\s*null/.test(src));
	check('Rules migration sets deleteRule null', /deleteRule\s*=\s*null/.test(src));

	const missing = LEGACY_OWNER_COLLECTIONS.filter((name) => !src.includes(`"${name}"`));
	check('All legacy owner-scoped collections listed', missing.length === 0, missing.join(', ') || 'all present');

	const lockedBlock = src.slice(src.indexOf('LEGACY_CLIENT_RULE_COLLECTIONS'), src.indexOf('PLATFORM_AND_TENANT_COLLECTIONS'));
	const platformBlock = src.slice(src.indexOf('PLATFORM_AND_TENANT_COLLECTIONS'), src.indexOf('WORKSPACE_RELATION_INDEXES'));
	const mentionsUsers = /"users"/.test(lockedBlock) || /"users"/.test(platformBlock);
	check('users auth collection excluded from API-only harden lists', !mentionsUsers);

	check('Adds workspace isolation indexes', src.includes('idx_isolation_websites_workspace'));
	check('Down migration does not restore owner rules', /does not restore weaker|Security harden is additive/.test(src));
}

// --- Backfill migration content ---
{
	const src = read(BACKFILL_MIGRATION);
	check('Backfill targets ai_pin_templates', src.includes('ai_pin_templates'));
	check('Backfill maps official meta → official', src.includes('"official"') && src.includes('marketplace_meta'));
	check('Backfill maps blank → private by default', src.includes('"private"'));
	check('Backfill skips non-blank visibility', /if\s*\(\s*current\s*\)\s*continue/.test(src));
}

// --- Facebook channel pack F1-Apply ---
{
	const src = read('apps/pocketbase/pb_migrations/1785400000_facebook_channel_pack.js');
	const missing = FACEBOOK_CHANNEL_COLLECTIONS.filter((name) => !src.includes(`"${name}"`));
	check('Facebook migration creates all approved collections', missing.length === 0, missing.join(', ') || 'all present');
	check('Facebook migration sets API-only rules', /listRule:\s*null/.test(src) && /createRule:\s*null/.test(src));
	check('Facebook migration does not touch pinterest collections', !/pinterest_/.test(src.replace(/pinterest twin|Pinterest/gi, '')));
	check('Facebook migration includes workspace isolation indexes', src.includes('idx_isolation_facebook_publish_jobs_workspace'));
	check('Facebook migration has no OAuth Graph client code', !/graph\.facebook|oauth\/access_token/i.test(src));
}

// --- Earlier rules migration still documents old owner rules (historical) ---
{
	const legacy = read('apps/pocketbase/pb_migrations/1737465001_pinblog_api_rules.js');
	check('Historical owner rules migration still present (compat)', legacy.includes('FULL_OWNER_RULES'));
	const harden = read(RULES_MIGRATION);
	check('Phase 3 overrides historical owner rules', harden.includes('LEGACY_CLIENT_RULE_COLLECTIONS'));
}

// --- Frontend: no tenant PB CRUD (Phase 1 still holds) ---
{
	const tenantCollections = [
		'ai_pins',
		'websites',
		'articles',
		'pins',
		'website_articles',
		'brand_kits',
		'ai_pin_templates',
		'user_settings',
		'pinterest_accounts',
	];
	const webDir = path.join(root, 'apps/web/src');
	const leaked = [];

	function walk(dir) {
		for (const name of readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, name.name);
			if (name.isDirectory()) {
				if (name.name === 'node_modules') continue;
				walk(full);
			} else if (/\.(jsx?|tsx?)$/.test(name.name)) {
				const src = readFileSync(full, 'utf8');
				for (const col of tenantCollections) {
					const re = new RegExp(`pb\\.collection\\(['"]${col}['"]\\)`);
					if (re.test(src)) leaked.push(`${path.relative(root, full)} → ${col}`);
				}
			}
		}
	}
	walk(webDir);
	check('Frontend has no tenant pb.collection access', leaked.length === 0, leaked.join('; ') || 'clean');
}

// --- Phase 1 / 2 gates ---
{
	const aiPins = read('apps/api/src/routes/ai-pins.js');
	check('Orphan website claim still blocked', aiPins.includes('cannot be claimed'));
	const ownership = read('apps/api/src/services/workspace-ownership.js');
	check('Workspace ownership helpers present', ownership.includes('recordBelongsToWorkspace'));
	const gallery = read('apps/api/src/services/template-gallery.js');
	check('Gallery blank visibility not global shared', !gallery.includes("visibility === 'official' || visibility === ''"));
}

// --- Migration ordering ---
{
	const migDir = path.join(root, 'apps/pocketbase/pb_migrations');
	const files = readdirSync(migDir).filter((f) => f.endsWith('.js')).sort();
	const rulesIdx = files.indexOf('1783995000_workspace_isolation_api_only_rules.js');
	const backfillIdx = files.indexOf('1783995100_backfill_ai_pin_template_visibility.js');
	const ownershipIdx = files.indexOf('1783994000_workspace_ownership_onboarding.js');
	check('Rules migration after ownership onboarding', rulesIdx > ownershipIdx && ownershipIdx >= 0);
	check('Backfill migration after rules migration', backfillIdx > rulesIdx && rulesIdx >= 0);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== Phase 3 Summary: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
	for (const f of failed) console.log(' -', f.name, f.detail);
	process.exit(1);
}
console.log('Phase 3 gate: PASS — stop for review before Phase 4');
process.exit(0);
