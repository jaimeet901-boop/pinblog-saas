/**
 * Inspect PocketBase users OAuth config + _externalAuths (superuser).
 * Never prints client secrets.
 *
 * Usage (local):
 *   $env:PB_BASE_URL='http://127.0.0.1:18111'
 *   node --env-file=.env scripts/inspect-oauth-auth-state.mjs
 *
 * Usage (on production API container / host with apps/api/.env):
 *   PB_BASE_URL=http://pocketbase:8090 node --env-file=.env scripts/inspect-oauth-auth-state.mjs
 */

const base = String(process.env.PB_BASE_URL || 'http://127.0.0.1:18111').replace(/\/+$/, '');
const email = process.env.PB_SUPERUSER_EMAIL;
const password = process.env.PB_SUPERUSER_PASSWORD;
const lookupEmail = String(process.env.OAUTH_INSPECT_EMAIL || 'jaimeet901@gmail.com').trim().toLowerCase();

async function main() {
	console.log('PB_BASE_URL', base);
	if (!email || !password) {
		console.error('Missing PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD');
		process.exit(1);
	}

	const authRes = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: email, password }),
	});
	const authBody = await authRes.json().catch(() => ({}));
	if (!authRes.ok) {
		console.error('Superuser auth failed', authRes.status, authBody?.message || authBody);
		process.exit(1);
	}
	const headers = { Authorization: authBody.token };

	const usersCol = await (await fetch(`${base}/api/collections/users`, { headers })).json();
	const oauth2 = usersCol?.oauth2 || {};
	console.log('\n=== users.oauth2.enabled ===', oauth2.enabled);
	console.log('=== users.oauth2.mappedFields ===');
	console.log(JSON.stringify(oauth2.mappedFields ?? null, null, 2));
	console.log('=== users.oauth2.providers ===');
	console.log(JSON.stringify((oauth2.providers || []).map((p) => ({
		name: p?.name,
		displayName: p?.displayName,
		hasClientId: Boolean(p?.clientId),
		clientIdSuffix: p?.clientId ? String(p.clientId).slice(-12) : '',
		hasSecret: Boolean(p?.clientSecret),
		authURL: p?.authURL || '',
		tokenURL: p?.tokenURL || '',
		pkce: p?.pkce,
	})), null, 2));
	console.log('=== users.createRule ===');
	console.log(usersCol?.createRule || null);
	console.log('=== users.updateRule ===');
	console.log(usersCol?.updateRule || null);

	const extRes = await fetch(
		`${base}/api/collections/_externalAuths/records?perPage=100&sort=-created`,
		{ headers },
	);
	const extBody = await extRes.json().catch(() => ({}));
	console.log('\n=== _externalAuths total ===', extBody.totalItems ?? (extBody.items || []).length);
	const byProvider = {};
	const byProviderId = {};
	for (const row of extBody.items || []) {
		const provider = String(row.provider || '');
		const providerId = String(row.providerId || '');
		byProvider[provider] = (byProvider[provider] || 0) + 1;
		const key = `${provider}::${providerId}`;
		byProviderId[key] = (byProviderId[key] || 0) + 1;
		console.log(JSON.stringify({
			id: row.id,
			provider: row.provider,
			providerId: row.providerId,
			recordRef: row.recordRef,
			collectionRef: row.collectionRef,
			created: row.created,
		}));
	}
	console.log('=== _externalAuths counts by provider ===', byProvider);
	const dupes = Object.entries(byProviderId).filter(([, n]) => n > 1);
	console.log('=== duplicate provider+providerId ===', dupes.length ? dupes : 'none');

	const filter = encodeURIComponent(`email = "${lookupEmail}"`);
	const found = await (await fetch(
		`${base}/api/collections/users/records?filter=${filter}&perPage=5`,
		{ headers },
	)).json().catch(() => ({}));
	console.log(`\n=== users where email=${lookupEmail} ===`, found.totalItems || 0);
	for (const row of found.items || []) {
		console.log(JSON.stringify({
			id: row.id,
			email: row.email,
			name: row.name,
			verified: row.verified,
			plan: row.plan,
			role: row.role,
			created: row.created,
			updated: row.updated,
		}));
		const linked = await (await fetch(
			`${base}/api/collections/users/records/${row.id}/external-auths`,
			{ headers },
		)).json().catch(() => ({}));
		console.log('  external-auths', JSON.stringify(linked?.items || linked || []));
	}

	// Recent auth-with-oauth2 request logs (if retained)
	const logFilter = encodeURIComponent('data.url ~ "auth-with-oauth2"');
	const logs = await (await fetch(
		`${base}/api/logs?perPage=20&sort=-created&filter=${logFilter}`,
		{ headers },
	)).json().catch(() => ({}));
	console.log('\n=== recent auth-with-oauth2 logs ===', (logs.items || []).length);
	for (const item of logs.items || []) {
		const data = item.data || {};
		console.log(JSON.stringify({
			created: item.created,
			level: item.level,
			message: item.message,
			status: data.status,
			error: data.error,
			details: data.details,
			meta: data.meta,
		}));
	}
}

main().catch((error) => {
	console.error('FATAL', error?.message || error);
	process.exit(1);
});
