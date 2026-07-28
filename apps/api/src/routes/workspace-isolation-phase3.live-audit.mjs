/**
 * Live Phase 3 PocketBase rule audit (local).
 * Usage (from repo root):
 *   node --env-file=apps/api/.env apps/api/src/routes/workspace-isolation-phase3.live-audit.mjs [PB_URL]
 *
 * Defaults to http://127.0.0.1:8090 (pb_data after migrate up).
 * Does not print secrets.
 */
import PocketBase from 'pocketbase';

const pbUrl = process.argv[2] || process.env.PB_AUDIT_URL || 'http://127.0.0.1:8090';
const email = process.env.PB_SUPERUSER_EMAIL;
const password = process.env.PB_SUPERUSER_PASSWORD;

const results = [];
function check(name, pass, detail = '') {
	results.push({ name, pass: Boolean(pass), detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

const TENANT_COLS = [
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
	'ai_pin_image_jobs',
	'ai_pin_generation_history',
	'workspaces',
	'workspace_members',
];

async function main() {
	if (!email || !password) {
		console.error('Missing PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD');
		process.exit(2);
	}

	const pb = new PocketBase(pbUrl);
	pb.autoCancellation(false);

	try {
		await pb.collection('_superusers').authWithPassword(email, password);
		check('Superuser auth', true, pbUrl);
	} catch (error) {
		check('Superuser auth', false, error?.message || String(error));
		process.exit(1);
	}

	const collections = await pb.collections.getFullList({ requestKey: null });
	const byName = Object.fromEntries(collections.map((c) => [c.name, c]));

	const notApiOnly = [];
	for (const name of TENANT_COLS) {
		const col = byName[name];
		if (!col) {
			check(`Collection ${name} exists`, false, 'missing');
			continue;
		}
		const apiOnly =
			col.listRule == null &&
			col.viewRule == null &&
			col.createRule == null &&
			col.updateRule == null &&
			col.deleteRule == null;
		if (!apiOnly) notApiOnly.push(`${name}[${[col.listRule, col.viewRule, col.createRule, col.updateRule, col.deleteRule].map((r) => (r == null ? '∅' : 'R')).join(',')}]`);
	}
	check('Tenant collections are API-only (null rules)', notApiOnly.length === 0, notApiOnly.join('; ') || 'all null');

	const users = byName.users;
	check('users collection still exists', Boolean(users));
	check(
		'users is NOT fully API-only (auth must remain usable)',
		!(users?.listRule == null && users?.viewRule == null && users?.createRule == null && users?.updateRule == null && users?.deleteRule == null),
		`list=${users?.listRule ?? 'null'} create=${users?.createRule ?? 'null'}`,
	);

	// Blank visibility backfill
	try {
		const blank = await pb.collection('ai_pin_templates').getList(1, 1, {
			filter: 'visibility = ""',
			requestKey: null,
		});
		check('No blank-visibility templates remain (superuser)', blank.totalItems === 0, `remaining=${blank.totalItems}`);
	} catch (error) {
		check('Blank visibility query', false, error?.message || String(error));
	}

	// Client SDK cannot list tenant data even when authenticated as a normal user (if any exist)
	pb.authStore.clear();
	let userAuthOk = false;
	try {
		const userList = await pb.collection('users').getList(1, 1, { requestKey: null });
		// unauthenticated list of users should fail or be empty depending on rules — skip
		void userList;
	} catch {
		// expected for locked list
	}

	// Re-auth as superuser to find a user email, then try password auth is hard without passwords.
	// Instead: unauthenticated client must not list ai_pins.
	pb.authStore.clear();
	let denied = false;
	try {
		await pb.collection('ai_pins').getList(1, 1, { requestKey: null });
	} catch (error) {
		denied = /403|401|404|Forbidden|unauthorized/i.test(String(error?.status || '') + String(error?.message || error));
		denied = denied || error?.status === 403 || error?.status === 401 || error?.status === 404;
	}
	check('Unauthenticated SDK cannot list ai_pins', denied, denied ? 'denied' : 'UNEXPECTED ACCESS');

	// Authenticated user path: create ephemeral user via superuser, auth as them, try tenant list
	await pb.collection('_superusers').authWithPassword(email, password);
	const stamp = Date.now();
	const testEmail = `phase3-audit-${stamp}@example.invalid`;
	const testPass = `Phase3Audit!${stamp}`;
	let testUser;
	try {
		testUser = await pb.collection('users').create({
			email: testEmail,
			password: testPass,
			passwordConfirm: testPass,
			emailVisibility: false,
		});
		userAuthOk = true;
	} catch (error) {
		check('Create ephemeral audit user', false, error?.message || String(error));
	}

	if (userAuthOk && testUser) {
		pb.authStore.clear();
		try {
			await pb.collection('users').authWithPassword(testEmail, testPass);
			check('Ephemeral user auth', true);
		} catch (error) {
			check('Ephemeral user auth', false, error?.message || String(error));
		}

		const probeCols = ['ai_pins', 'websites', 'articles', 'pins', 'ai_pin_templates', 'user_settings'];
		const leaks = [];
		for (const name of probeCols) {
			try {
				const list = await pb.collection(name).getList(1, 1, { requestKey: null });
				// If rules are null, PB returns 403 for non-superuser. Any successful list is a leak.
				leaks.push(`${name}:listed(${list.totalItems})`);
			} catch (error) {
				const status = error?.status;
				if (!(status === 403 || status === 401 || status === 404)) {
					leaks.push(`${name}:status=${status}:${error?.message || error}`);
				}
			}
		}
		check('Authenticated user SDK cannot list tenant collections', leaks.length === 0, leaks.join('; ') || 'all denied');

		// Cleanup
		pb.authStore.clear();
		await pb.collection('_superusers').authWithPassword(email, password);
		try {
			await pb.collection('users').delete(testUser.id);
			check('Cleanup ephemeral user', true);
		} catch (error) {
			check('Cleanup ephemeral user', false, error?.message || String(error));
		}
	}

	const failed = results.filter((r) => !r.pass);
	console.log(`\n=== Phase 3 Live Audit: ${results.length - failed.length}/${results.length} passed ===`);
	if (failed.length) {
		for (const f of failed) console.log(' -', f.name, f.detail);
		process.exit(1);
	}
	console.log('Live PB hardening: PASS');
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
