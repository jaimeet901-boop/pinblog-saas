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

describe('Pinterest OAuth start fail-closed (P2-1 / P2-4 static)', () => {
	const oauthStart = (() => {
		const start = boards.indexOf('export async function createPinterestOAuthState');
		const end = boards.indexOf('export async function consumePinterestOAuthState');
		assert.ok(start >= 0 && end > start);
		return boards.slice(start, end);
	})();

	it('start and reconnect stamp req.workspace.id and req.workspaceKey, not req.workspaceId', () => {
		const startMarker = "router.post('/oauth/start'";
		const start = route.slice(route.indexOf(startMarker), route.indexOf("router.post('/accounts/:accountId/reconnect'"));
		assert.match(start, /workspaceId:\s*req\.workspace\?\.id/);
		assert.match(start, /workspaceKey:\s*req\.workspaceKey/);
		assert.doesNotMatch(start, /req\.workspaceId/);
		assert.doesNotMatch(start, /ensureUserWorkspace/);
		assert.doesNotMatch(start, /getWorkspaceActor/);

		const reconnectMarker = "router.post('/accounts/:accountId/reconnect'";
		const reconnect = route.slice(route.indexOf(reconnectMarker), route.indexOf("router.patch('/accounts/:accountId'"));
		assert.match(reconnect, /workspaceId:\s*req\.workspace\?\.id/);
		assert.match(reconnect, /workspaceKey:\s*req\.workspaceKey/);
		assert.match(reconnect, /accountId:\s*account\.id/);
		assert.doesNotMatch(reconnect, /req\.workspaceId/);
		assert.doesNotMatch(reconnect, /account\.workspace/);
		assert.doesNotMatch(reconnect, /ensureUserWorkspace/);
		assert.doesNotMatch(reconnect, /getWorkspaceActor/);
	});

	it('createPinterestOAuthState writes the full payload once and does not strip-retry', () => {
		assert.match(oauthStart, /buildPinterestOAuthStateCreatePayload\(/);
		assert.equal((oauthStart.match(/\.create\(/g) || []).length, 1);
		assert.doesNotMatch(oauthStart, /Older schema without workspace fields/);
		assert.doesNotMatch(oauthStart, /ensureUserWorkspace/);
		assert.doesNotMatch(boards, /import \{ ensureUserWorkspace \}/);
		assert.match(seam, /export function buildPinterestOAuthStateCreatePayload/);
		assert.match(seam, /export function resolvePinterestOAuthStartWorkspace/);
	});

	it('OAuth start logger never records state, authUrl, or secrets', () => {
		const logAt = oauthStart.indexOf("logger.info('[pinterest-oauth] authorization URL built'");
		assert.ok(logAt >= 0);
		const logBlock = oauthStart.slice(logAt, oauthStart.indexOf('return {', logAt));
		assert.match(logBlock, /pinterestOAuthStartLogFields\(/);
		assert.match(logBlock, /hasAuthUrl:/);
		assert.match(logBlock, /hasState:/);
		assert.match(logBlock, /stateLength:/);
		assert.match(logBlock, /hasClientId:/);
		assert.match(logBlock, /hasAccountId:/);
		assert.doesNotMatch(logBlock, /^\s*authUrl,/m);
		assert.doesNotMatch(logBlock, /^\s*state,/m);
		assert.doesNotMatch(logBlock, /^\s*clientId,/m);
		assert.doesNotMatch(logBlock, /^\s*requestedScopes,/m);
		assert.doesNotMatch(logBlock, /access_token|refresh_token|client_secret|cookie/i);
		assert.match(seam, /export function pinterestOAuthStartLogFields/);
	});

	it('does not change OAuth callback F5/F4/F3 wiring', () => {
		const marker = "router.get('/oauth/callback'";
		const callback = route.slice(route.indexOf(marker), route.indexOf('router.use(pocketbaseAuth)'));
		assert.match(callback, /resolvePinterestOAuthCallbackWorkspace\(stateRecord\)/);
		assert.match(callback, /buildPinterestOAuthCallbackScope\(/);
		assert.match(callback, /consumePinterestOAuthState\(stateRecord\)/);
		assert.match(callback, /exchangeOAuthCodeForTokens\(/);
		const resolveAt = callback.indexOf('resolvePinterestOAuthCallbackWorkspace(stateRecord)');
		const scopeAt = callback.indexOf('buildPinterestOAuthCallbackScope(');
		const consumeAt = callback.indexOf('consumePinterestOAuthState(stateRecord)');
		const exchangeAt = callback.indexOf('exchangeOAuthCodeForTokens(');
		assert.ok(resolveAt < scopeAt);
		assert.ok(scopeAt < consumeAt);
		assert.ok(consumeAt < exchangeAt);
	});
});

describe('Pinterest OAuth callback error sanitization (P2-3 static)', () => {
	const callbackRoute = (() => {
		const marker = "router.get('/oauth/callback'";
		return route.slice(route.indexOf(marker), route.indexOf('router.use(pocketbaseAuth)'));
	})();

	it('does not copy provider error_description or error.message into pinterest_error', () => {
		assert.match(callbackRoute, /pinterestOAuthProviderDeniedBrowserError\(\)/);
		assert.match(callbackRoute, /pinterestOAuthCallbackBrowserError\(error\)/);
		assert.doesNotMatch(callbackRoute, /pinterest_error: reason/);
		assert.doesNotMatch(callbackRoute, /pinterest_error: error\?\.message/);
		assert.doesNotMatch(callbackRoute, /pinterest_error: error\.message/);
		assert.doesNotMatch(callbackRoute, /error_description, 'error_description'/);
		assert.match(seam, /export function pinterestOAuthCallbackBrowserError/);
		assert.match(seam, /export function pinterestOAuthProviderDeniedBrowserError/);
	});

	it('wraps profile fetch after consume and keeps F3/F4/F5 order', () => {
		assert.match(callbackRoute, /PINTEREST_OAUTH_PROFILE_FAILED/);
		assert.match(callbackRoute, /fetchPinterestProfile\(\{ accessToken \}\)/);
		const resolveAt = callbackRoute.indexOf('resolvePinterestOAuthCallbackWorkspace(stateRecord)');
		const scopeAt = callbackRoute.indexOf('buildPinterestOAuthCallbackScope(');
		const consumeAt = callbackRoute.indexOf('consumePinterestOAuthState(stateRecord)');
		const exchangeAt = callbackRoute.indexOf('exchangeOAuthCodeForTokens(');
		const profileAt = callbackRoute.indexOf('fetchPinterestProfile({ accessToken })');
		assert.ok(resolveAt < scopeAt);
		assert.ok(scopeAt < consumeAt);
		assert.ok(consumeAt < exchangeAt);
		assert.ok(exchangeAt < profileAt);
		assert.match(callbackRoute, /PINTEREST_OAUTH_TOKEN_EXCHANGE_FAILED/);
		assert.match(callbackRoute, /PINTEREST_OAUTH_ALREADY_CONNECTED_MESSAGE/);
		assert.match(callbackRoute, /PINTEREST_OAUTH_PROFILE_IN_USE_MESSAGE/);
	});

	it('board sync warning is the fixed safe message, not error.message', () => {
		assert.match(callbackRoute, /boards_sync_warning: PINTEREST_OAUTH_BOARDS_SYNC_WARNING_MESSAGE/);
		assert.doesNotMatch(callbackRoute, /boards_sync_warning: error\.message/);
		assert.doesNotMatch(callbackRoute, /boards_sync_warning: '1'/);
		assert.match(callbackRoute, /pinterestOAuthBoardSyncFailureLog\(/);
		assert.match(seam, /PINTEREST_OAUTH_BOARDS_SYNC_WARNING_MESSAGE/);
	});

	it('callback failure logs do not interpolate error.message, state, code, or tokens', () => {
		assert.match(callbackRoute, /pinterestOAuthCallbackFailureLog\(error\)/);
		assert.match(callbackRoute, /pinterestOAuthProviderDeniedLog\(/);
		assert.doesNotMatch(callbackRoute, /\{ message: error\.message \}/);
		assert.doesNotMatch(callbackRoute, /pinterest_error: error\?\.message/);
		assert.doesNotMatch(callbackRoute, /error_description:/);
		const logAt = callbackRoute.indexOf("logger.warn('[pinterest-oauth] callback failed'");
		assert.ok(logAt >= 0);
		const catchLog = callbackRoute.slice(logAt, callbackRoute.indexOf('return res.redirect', logAt) + 180);
		assert.doesNotMatch(catchLog, /error\.message/);
		assert.doesNotMatch(catchLog, /access_token|refresh_token|client_secret|cookie/i);
		const deniedAt = callbackRoute.indexOf("logger.warn('[pinterest-oauth] provider denied'");
		const deniedLog = callbackRoute.slice(deniedAt, callbackRoute.indexOf('return res.redirect', deniedAt));
		assert.doesNotMatch(deniedLog, /error_description \|\|/);
		assert.doesNotMatch(deniedLog, /pinterest_error: reason/);
	});
});

describe('Pinterest analytics workspace isolation (P2-5 static)', () => {
	const analytics = read('apps/api/src/services/pinterest-analytics-sync.js');

	it('asserts workspace isolation before token use and Pinterest analytics API', () => {
		assert.match(analytics, /assertPinterestAnalyticsWorkspaceIsolation\(\{ job, account \}\)/);
		assert.match(seam, /export function assertPinterestAnalyticsWorkspaceIsolation/);
		assert.match(analytics, /Pinterest analytics skipped job/);
		const isolateAt = analytics.indexOf('assertPinterestAnalyticsWorkspaceIsolation({ job, account })');
		const tokenAt = analytics.indexOf('ensureToken({ account })');
		const fetchAt = analytics.indexOf('fetchAnalytics({');
		assert.ok(isolateAt >= 0);
		assert.ok(tokenAt > isolateAt);
		assert.ok(fetchAt > tokenAt);
	});
});
