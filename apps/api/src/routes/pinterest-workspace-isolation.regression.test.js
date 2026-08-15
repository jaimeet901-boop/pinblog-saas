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

	it('scopes POST /token/refresh by owner + active workspace (F1)', () => {
		const marker = "router.post('/token/refresh'";
		const section = route.slice(route.indexOf(marker), route.indexOf("router.get('/providers'"));
		assert.match(section, /requireWorkspaceId\(req\)/);
		assert.match(section, /getOwnedPinterestAccountById\(\{ owner, accountId, req \}\)/);
		assert.match(section, /getOwnedPinterestAccount\(owner, req\)/);
		assert.match(section, /assertStrictWorkspaceRecord\(scopedAccount, req, 'Pinterest account not found'\)/);
		assert.match(section, /assertPinterestConnected\(owner, scopedAccount\.id, req\)/);
		assert.doesNotMatch(
			section,
			/assertPinterestConnected\(owner, normalizeString\(req\.body\?\.accountId/,
		);
	});

	it('scopes POST /boards/sync bulk enumeration by active workspace (F2)', () => {
		const marker = "router.post('/boards/sync'";
		const section = route.slice(route.indexOf(marker), route.indexOf("router.post('/publish'"));
		assert.match(section, /getOwnedPinterestAccounts\(owner, req\)/);
		assert.doesNotMatch(section, /getOwnedPinterestAccounts\(owner\);/);
		assert.match(section, /assertPinterestConnected\(owner, accountId, req\)/);
	});

	it('fails closed on OAuth callback when workspace identity is missing (F5)', () => {
		const marker = "router.get('/oauth/callback'";
		const section = route.slice(route.indexOf(marker), route.indexOf('router.use(pocketbaseAuth)'));
		assert.match(section, /resolvePinterestOAuthCallbackWorkspace\(stateRecord\)/);
		assert.match(section, /stampPinterestOAuthAccountWorkspace\(/);
		assert.match(section, /failClosedPinterestOAuthAccountWrite\(payload\)/);
		assert.doesNotMatch(section, /ensureUserWorkspace/);
		assert.doesNotMatch(section, /delete legacyPayload\.workspace/);
		assert.doesNotMatch(section, /delete legacyPayload\.workspace_id/);
		assert.doesNotMatch(section, /delete legacyPayload\.workspace_key/);
		assert.match(seam, /export function resolvePinterestOAuthCallbackWorkspace/);
		assert.match(seam, /export function failClosedPinterestOAuthAccountWrite/);
		assert.doesNotMatch(route, /import \{ ensureUserWorkspace \}/);
	});

	it('scopes OAuth callback account lookups to the state workspace (F4)', () => {
		const marker = "router.get('/oauth/callback'";
		const section = route.slice(route.indexOf(marker), route.indexOf('router.use(pocketbaseAuth)'));
		assert.match(section, /buildPinterestOAuthCallbackScope\(/);
		assert.match(section, /requirePinterestOAuthReconnectAccount\(/);
		assert.match(section, /bindPinterestOAuthAccountToStateWorkspace\(/);
		assert.match(section, /req: oauthScope/);
		assert.match(section, /getOwnedPinterestAccounts\(stateRecord\.owner, oauthScope\)/);
		assert.match(section, /setDefaultPinterestAccount\(\{[\s\S]*req: oauthScope/);
		assert.doesNotMatch(section, /getOwnedPinterestAccountById\(\{ owner: stateRecord\.owner, accountId: reconnectAccountId \}\)/);
		assert.doesNotMatch(section, /getOwnedPinterestAccounts\(stateRecord\.owner\);/);
		assert.match(seam, /export function requirePinterestOAuthReconnectAccount/);
		assert.match(seam, /export function bindPinterestOAuthAccountToStateWorkspace/);
	});

	it('consumes OAuth state atomically before Pinterest token exchange (F3)', () => {
		const marker = "router.get('/oauth/callback'";
		const section = route.slice(route.indexOf(marker), route.indexOf('router.use(pocketbaseAuth)'));
		const consumeHook = read('apps/pocketbase/pb_hooks/pinterest-oauth-state-consume.pb.js');
		const consumeAt = section.indexOf('consumePinterestOAuthState(stateRecord)');
		const exchangeAt = section.indexOf('exchangeOAuthCodeForTokens(');
		assert.ok(consumeAt >= 0, 'callback must call consumePinterestOAuthState');
		assert.ok(exchangeAt > consumeAt, 'atomic consume must happen before token exchange');
		assert.doesNotMatch(section, /update\(stateRecord\.id, \{ used: true \}\)/);
		assert.match(section, /rejectPinterestOAuthStateConsume\(/);
		assert.match(boards, /export async function consumePinterestOAuthState/);
		assert.match(boards, /pocketbaseClient\.send\(PINTEREST_OAUTH_STATE_CONSUME_PATH/);
		assert.doesNotMatch(boards, /better-sqlite3|pb_data\/data\.db|new Mutex|createMutex/);
		assert.match(consumeHook, /routerAdd\("POST", "\/api\/pinterest\/oauth-states\/consume"/);
		assert.match(consumeHook, /\$apis\.requireSuperuserAuth\(\)/);
		assert.match(consumeHook, /\$app\.db\(\)/);
		assert.match(consumeHook, /newQuery\(/);
		assert.match(consumeHook, /UPDATE pinterest_oauth_states SET used = true WHERE id = \{:id\}/);
		assert.match(consumeHook, /used = false/);
		assert.match(consumeHook, /expires_at/);
		assert.match(consumeHook, /rowsAffected/);
		assert.match(consumeHook, /affected !== 1/);
		assert.doesNotMatch(consumeHook, /api\.pinterest\.com/);
		assert.doesNotMatch(consumeHook, /collection\(['"]pinterest_oauth_states['"]\)\.update/);
		assert.match(seam, /export function applyPinterestOAuthStateCas/);
		assert.match(seam, /export function createPinterestOAuthStateCasStore/);
	});
});
