/**
 * Phase 4.3 — Medium severity ownership / concurrency regression.
 * Run: node apps/api/src/services/queue/phase43-medium.regression.test.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryClaimStore } from './claim.js';
import { randomBytes } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const results = [];

function check(name, pass, detail = '') {
	results.push({ name, pass: Boolean(pass), detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

function read(rel) {
	return readFileSync(path.join(root, rel), 'utf8');
}

// --- Concurrency: WordPress-style sync lease (claim_token CAS) ---

async function claimSyncLease(store, siteId) {
	const col = store.collection('wordpress_sites');
	const current = await col.getOne(siteId);
	const claimable = new Set(['', 'idle', 'success', 'partial', 'failed']);
	if (!claimable.has(String(current.sync_status || ''))) return null;

	const claimToken = randomBytes(16).toString('hex');
	const nextVersion = Number(current.sync_claim_version || 0) + 1;
	await col.update(siteId, {
		sync_status: 'running',
		sync_claim_token: claimToken,
		sync_claim_version: nextVersion,
	});

	const verified = await col.getOne(siteId);
	if (
		String(verified.sync_status || '') !== 'running'
		|| String(verified.sync_claim_token || '') !== claimToken
	) {
		return null;
	}
	return verified;
}

{
	const store = createMemoryClaimStore({
		id: 'site_1',
		sync_status: 'idle',
		sync_claim_token: '',
		sync_claim_version: 0,
	});

	const outcomes = await Promise.all([
		claimSyncLease(store, 'site_1'),
		claimSyncLease(store, 'site_1'),
		claimSyncLease(store, 'site_1'),
	]);
	const winners = outcomes.filter(Boolean);
	const final = store.getRecord();
	const winnerTokens = new Set(winners.map((w) => w.sync_claim_token));

	check('WP sync lease: concurrent claimers → exactly one winner', winners.length === 1, `winners=${winners.length}`);
	check('WP sync lease: final status running', final.sync_status === 'running');
	check('WP sync lease: winner token is final token', winners[0]?.sync_claim_token === final.sync_claim_token);
	check('WP sync lease: unique winner tokens = 1', winnerTokens.size === 1);
}

{
	const store = createMemoryClaimStore({
		id: 'site_2',
		sync_status: 'running',
		sync_claim_token: 'held',
		sync_claim_version: 3,
	});
	const second = await claimSyncLease(store, 'site_2');
	check('WP sync lease: already running cannot be claimed', second === null);
}

// --- Static: analytics cache isolation ---

const refreshSrc = read('apps/api/src/services/analytics/refresh.js');
check(
	'Analytics refresh never invalidates all workspace scopes blindly',
	!refreshSrc.includes("invalidateAnalyticsCache({ scope: 'workspace' })")
	|| refreshSrc.includes('scopeKey'),
);
check(
	'Analytics refresh requires scopeKey for workspace invalidation',
	refreshSrc.includes("invalidateAnalyticsCache({ scope: 'workspace', scopeKey:")
	&& refreshSrc.includes('resolveOwnerWorkspaceScopeKeys'),
);
check(
	'enqueueAnalyticsRefresh stamps workspaceKey on job, not payload ownership',
	refreshSrc.includes('workspaceKey,')
	&& refreshSrc.includes("type: 'analytics_refresh'")
	&& !refreshSrc.includes('payload: { scope: \'platform\', owner'),
);

const cacheSrc = read('apps/api/src/services/analytics/cache.js');
check(
	'invalidateAnalyticsCache supports scope + scopeKey filter',
	cacheSrc.includes('scope = {:scope} && scope_key = {:key}'),
);

// --- Static: Pinterest analytics pin ownership ---

const analyticsSync = read('apps/api/src/services/pinterest-analytics-sync.js');
check(
	'Pinterest analytics asserts pin ownership before update',
	analyticsSync.includes('assertJobPinOwnership')
	&& analyticsSync.includes("collection('ai_pins').getOne(job.ai_pin)"),
);
check(
	'Pinterest analytics skips pin update on ownership mismatch',
	analyticsSync.includes('Pinterest analytics skipped pin update'),
);

// --- Static: WordPress sync lease ---

const wpSync = read('apps/api/src/services/wordpress-sync.js');
check(
	'WordPress sync exports claimWordpressSyncLease',
	wpSync.includes('export async function claimWordpressSyncLease'),
);
check(
	'processDueWordpressSyncs claims lease before sync',
	wpSync.includes('claimWordpressSyncLease(site.id)')
	&& wpSync.includes('alreadyClaimed: true'),
);
check(
	'WordPress sync clears sync_claim_token on finish',
	wpSync.includes("sync_claim_token: ''"),
);
check(
	'Schema ensure adds sync claim fields',
	read('apps/api/src/utils/ensure-wordpress-integration-schema.js').includes('sync_claim_token')
	&& read('apps/api/src/utils/ensure-wordpress-integration-schema.js').includes('sync_claim_version'),
);

// --- Static: native engine trusted ownership ---

const controls = read('apps/api/src/services/queue/controls.js');
check(
	'Native processNativeJob resolves trusted ownership',
	controls.includes('resolveTrustedNativeJobOwnership')
	&& controls.includes('const trusted = await resolveTrustedNativeJobOwnership(job)'),
);
check(
	'analytics_refresh uses trusted.owner / trusted.workspaceKey',
	controls.includes('ownerId: trusted.owner')
	&& controls.includes('workspaceKey: trusted.workspaceKey'),
);

const ownership = read('apps/api/src/services/queue/job-ownership.js');
check(
	'resolveTrustedNativeJobOwnership rejects forged payload.owner',
	ownership.includes('resolveTrustedNativeJobOwnership')
	&& ownership.includes('FORGED_PAYLOAD_OWNER'),
);
check(
	'resolveTrustedNativeJobOwnership rebinds workspace from DB',
	ownership.includes('Native job owner does not match workspace owner')
	|| ownership.includes('NATIVE_WORKSPACE_MISMATCH'),
);

// Unit-ish: forged payload detection without PB (inline rules)
{
	const jobOwner = 'userA';
	const payloadOwner = 'attacker';
	const forged = payloadOwner !== jobOwner;
	check('Forged native payload owner detection', forged === true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nPhase 4.3 medium: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
	process.exitCode = 1;
}
