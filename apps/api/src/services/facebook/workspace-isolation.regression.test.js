import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const api = read('apps/api/src/services/facebook/api.js');
const seam = read('apps/api/src/services/facebook/workspace-isolation.js');
const route = read('apps/api/src/routes/facebook.js');

function extractExport(source, signature, nextSignature) {
	const start = source.indexOf(signature);
	assert.ok(start >= 0, `missing ${signature}`);
	const end = nextSignature ? source.indexOf(nextSignature, start + signature.length) : source.length;
	assert.ok(end > start, `could not bound ${signature}`);
	return source.slice(start, end);
}

const callback = extractExport(
	api,
	'export async function completeFacebookOAuthCallback',
	'export { analyzeGrantedScopes',
);
const oauthStart = extractExport(
	api,
	'export async function createFacebookOAuthState',
	'export async function exchangeFacebookCodeForTokens',
);

describe('Facebook OAuth callback workspace fail-closed (F5 static)', () => {
	it('resolves callback workspace only from stored OAuth state', () => {
		assert.match(callback, /resolveFacebookOAuthCallbackWorkspace\(stateRecord\)/);
		assert.match(callback, /stampFacebookOAuthAccountWorkspace\(/);
		assert.match(seam, /export function resolveFacebookOAuthCallbackWorkspace/);
		assert.match(seam, /export function stampFacebookOAuthAccountWorkspace/);
		assert.match(seam, /FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE/);
	});

	it('does not call ensureUserWorkspace in the callback', () => {
		assert.doesNotMatch(callback, /ensureUserWorkspace/);
		assert.doesNotMatch(api, /ensureUserWorkspace/);
		assert.doesNotMatch(oauthStart, /ensureUserWorkspace/);
	});

	it('does not invent a workspace or strip workspace fields on account write failure', () => {
		assert.match(callback, /failClosedFacebookOAuthAccountWrite\(payload\)/);
		assert.match(seam, /export function failClosedFacebookOAuthAccountWrite/);
		assert.doesNotMatch(callback, /delete\s+\w+\.workspace/);
		assert.doesNotMatch(callback, /delete\s+\w+\.workspace_id/);
		assert.doesNotMatch(callback, /delete\s+\w+\.workspace_key/);
		assert.doesNotMatch(callback, /ensureUserWorkspace\(stateRecord\.owner\)/);
		assert.doesNotMatch(callback, /workspaceKey = workspaceKey \|\| stateRecord\.owner/);
	});

	it('resolves F5 workspace before atomic consume', () => {
		const resolveAt = callback.indexOf('resolveFacebookOAuthCallbackWorkspace(stateRecord)');
		const consumeAt = callback.indexOf('consumeFacebookOAuthState(stateRecord)');
		assert.ok(resolveAt >= 0);
		assert.ok(consumeAt > resolveAt);
	});

	it('OAuth start fails closed on the authenticated Hub workspace (P2-1)', () => {
		assert.match(oauthStart, /buildFacebookOAuthStateCreatePayload\(/);
		assert.match(seam, /export function resolveFacebookOAuthStartWorkspace/);
		assert.match(seam, /export function buildFacebookOAuthStateCreatePayload/);
		assert.match(oauthStart, /Workspace is required to start Facebook OAuth|buildFacebookOAuthStateCreatePayload/);
		assert.doesNotMatch(oauthStart, /ensureUserWorkspace/);
		assert.doesNotMatch(oauthStart, /resolveFacebookOAuthCallbackWorkspace/);
		assert.doesNotMatch(oauthStart, /req\.workspaceId/);
	});

	it('surfaces the callback error through the existing Facebook reconnect redirect', () => {
		const marker = "router.get('/oauth/callback'";
		const section = route.slice(route.indexOf(marker), route.indexOf('router.use(pocketbaseAuth)'));
		assert.match(section, /completeFacebookOAuthCallback\(\{ code, state \}\)/);
		assert.match(section, /facebook_error: facebookOAuthCallbackBrowserError\(error\)/);
		assert.match(section, /facebook_error: facebookOAuthProviderDeniedBrowserError\(\)/);
		assert.match(section, /FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE/);
		assert.doesNotMatch(section, /facebook_error: error\.message/);
		assert.doesNotMatch(section, /errorDescription \|\| errorParam/);
		assert.doesNotMatch(section, /ensureUserWorkspace/);
	});
});

describe('Facebook OAuth callback workspace scoping (F4 static)', () => {
	it('builds a synthetic callback scope from OAuth state owner + workspace', () => {
		assert.match(callback, /buildFacebookOAuthCallbackScope\(/);
		assert.match(callback, /workspaceId,\s*workspaceKey,\s*ownerId: stateRecord\.owner/);
		assert.match(seam, /export function buildFacebookOAuthCallbackScope/);
		assert.doesNotMatch(callback, /buildPinterestOAuthCallbackScope/);
	});

	it('scopes reconnect, duplicate, and default lookups to the callback workspace', () => {
		assert.match(callback, /requireFacebookOAuthReconnectAccount\(/);
		assert.match(callback, /bindFacebookOAuthAccountToStateWorkspace\(/);
		assert.match(callback, /req: oauthScope/);
		assert.match(callback, /getOwnedFacebookAccountById\(\{[\s\S]*req: oauthScope/);
		assert.match(callback, /getOwnedFacebookAccountByFacebookUserId\(\{[\s\S]*req: oauthScope/);
		assert.match(callback, /getOwnedFacebookAccounts\(stateRecord\.owner, oauthScope\)/);
		assert.match(callback, /setDefaultFacebookAccount\(\{[\s\S]*req: oauthScope/);
		assert.doesNotMatch(callback, /getOwnedFacebookAccountById\(\{ owner: stateRecord\.owner, accountId: reconnectAccountId \}\)/);
		assert.doesNotMatch(callback, /getOwnedFacebookAccounts\(stateRecord\.owner\);/);
		assert.doesNotMatch(callback, /setDefaultFacebookAccount\(\{ owner: stateRecord\.owner, accountId: saved\.id \}\)/);
		assert.match(seam, /export function requireFacebookOAuthReconnectAccount/);
		assert.match(seam, /export function bindFacebookOAuthAccountToStateWorkspace/);
	});

	it('keeps F5 fail-closed workspace resolution wired', () => {
		assert.match(callback, /resolveFacebookOAuthCallbackWorkspace\(stateRecord\)/);
		assert.match(callback, /stampFacebookOAuthAccountWorkspace\(/);
		assert.match(callback, /failClosedFacebookOAuthAccountWrite\(payload\)/);
		assert.doesNotMatch(callback, /ensureUserWorkspace/);
		assert.doesNotMatch(callback, /delete\s+\w+\.workspace/);
	});

	it('builds F4 oauthScope before atomic consume', () => {
		const scopeAt = callback.indexOf('buildFacebookOAuthCallbackScope(');
		const consumeAt = callback.indexOf('consumeFacebookOAuthState(stateRecord)');
		assert.ok(scopeAt >= 0);
		assert.ok(consumeAt > scopeAt);
	});
});

describe('Facebook OAuth state atomic consume (F3 static)', () => {
	it('wires consume helper through the superuser PocketBase endpoint', () => {
		assert.match(api, /export async function consumeFacebookOAuthState/);
		assert.match(api, /pocketbaseClient\.send\(FACEBOOK_OAUTH_STATE_CONSUME_PATH/);
		assert.match(api, /\/api\/facebook\/oauth-states\/consume/);
		assert.doesNotMatch(api, /better-sqlite3|pb_data\/data\.db|new Mutex|createMutex/);
		assert.match(seam, /export function applyFacebookOAuthStateCas/);
		assert.match(seam, /export function createFacebookOAuthStateCasStore/);
		assert.match(seam, /export function rejectFacebookOAuthStateConsume/);
	});

	it('consumes OAuth state atomically before Graph token exchange', () => {
		const consumeAt = callback.indexOf('consumeFacebookOAuthState(stateRecord)');
		const exchangeAt = callback.indexOf('exchangeFacebookCodeForTokens(');
		assert.ok(consumeAt >= 0, 'callback must call consumeFacebookOAuthState');
		assert.ok(exchangeAt > consumeAt, 'atomic consume must happen before token exchange');
		assert.doesNotMatch(callback, /update\(stateRecord\.id, \{ used: true \}\)/);
		assert.match(callback, /rejectFacebookOAuthStateConsume\(/);
	});

	it('enforces a superuser-protected conditional UPDATE with rowsAffected === 1', () => {
		const consumeHook = read('apps/pocketbase/pb_hooks/facebook-oauth-state-consume.pb.js');
		assert.match(consumeHook, /routerAdd\("POST", "\/api\/facebook\/oauth-states\/consume"/);
		assert.match(consumeHook, /\$apis\.requireSuperuserAuth\(\)/);
		assert.match(consumeHook, /\$app\.db\(\)/);
		assert.match(consumeHook, /newQuery\(/);
		assert.match(consumeHook, /UPDATE facebook_oauth_states SET used = true WHERE id = \{:id\}/);
		assert.match(consumeHook, /used = false/);
		assert.match(consumeHook, /expires_at/);
		assert.match(consumeHook, /rowsAffected/);
		assert.match(consumeHook, /affected !== 1/);
		assert.doesNotMatch(consumeHook, /graph\.facebook\.com|api\.pinterest\.com/);
		assert.doesNotMatch(consumeHook, /collection\(['"]facebook_oauth_states['"]\)\.update/);
	});

	it('keeps F5 workspace resolver and F4 oauthScope wired', () => {
		assert.match(callback, /resolveFacebookOAuthCallbackWorkspace\(stateRecord\)/);
		assert.match(callback, /buildFacebookOAuthCallbackScope\(/);
		assert.match(callback, /requireFacebookOAuthReconnectAccount\(/);
		assert.match(callback, /stampFacebookOAuthAccountWorkspace\(/);
		assert.match(callback, /failClosedFacebookOAuthAccountWrite\(payload\)/);
	});
});

describe('Facebook OAuth start fail-closed (P2-1 / P2-2 / P2-4 static)', () => {
	it('start and reconnect stamp req.workspace.id and req.workspaceKey, not req.workspaceId', () => {
		const startMarker = "router.post('/oauth/start'";
		const start = route.slice(route.indexOf(startMarker), route.indexOf("router.post('/accounts/:accountId/reconnect'"));
		assert.match(start, /workspaceId:\s*req\.workspace\?\.id/);
		assert.match(start, /workspaceKey:\s*req\.workspaceKey/);
		assert.doesNotMatch(start, /req\.workspaceId/);
		assert.doesNotMatch(start, /ensureUserWorkspace/);

		const reconnectMarker = "router.post('/accounts/:accountId/reconnect'";
		const reconnect = route.slice(route.indexOf(reconnectMarker), route.indexOf("router.get('/accounts'"));
		assert.match(reconnect, /workspaceId:\s*req\.workspace\?\.id/);
		assert.match(reconnect, /workspaceKey:\s*req\.workspaceKey/);
		assert.match(reconnect, /accountId:\s*account\.id/);
		assert.doesNotMatch(reconnect, /req\.workspaceId/);
		assert.doesNotMatch(reconnect, /account\.workspace/);
		assert.doesNotMatch(reconnect, /ensureUserWorkspace/);
	});

	it('createFacebookOAuthState writes the full payload once and does not strip-retry', () => {
		assert.match(oauthStart, /buildFacebookOAuthStateCreatePayload\(/);
		assert.equal((oauthStart.match(/\.create\(/g) || []).length, 1);
		assert.doesNotMatch(oauthStart, /Older \/ partial schemas/);
		assert.doesNotMatch(oauthStart, /retry minimal required set/);
		assert.doesNotMatch(oauthStart, /used: false,\s*workspace: resolvedWorkspaceId/);
		assert.doesNotMatch(oauthStart, /ensureUserWorkspace/);
	});

	it('OAuth start logger never records state or authUrl', () => {
		const logAt = oauthStart.indexOf("logger.info('[facebook-oauth] authorization URL built'");
		assert.ok(logAt >= 0);
		const logBlock = oauthStart.slice(logAt, oauthStart.indexOf('return {', logAt));
		assert.match(logBlock, /facebookOAuthStartLogFields\(/);
		assert.match(logBlock, /hasAuthUrl:/);
		assert.match(logBlock, /hasState:/);
		assert.match(logBlock, /stateLength:/);
		assert.doesNotMatch(logBlock, /^\s*authUrl,/m);
		assert.doesNotMatch(logBlock, /^\s*state,/m);
		assert.doesNotMatch(logBlock, /^\s*clientId,/m);
		assert.match(seam, /export function facebookOAuthStartLogFields/);
	});

	it('does not change OAuth callback F5/F4/F3 wiring', () => {
		assert.match(callback, /resolveFacebookOAuthCallbackWorkspace\(stateRecord\)/);
		assert.match(callback, /buildFacebookOAuthCallbackScope\(/);
		assert.match(callback, /consumeFacebookOAuthState\(stateRecord\)/);
		assert.match(callback, /exchangeFacebookCodeForTokens\(/);
		const resolveAt = callback.indexOf('resolveFacebookOAuthCallbackWorkspace(stateRecord)');
		const scopeAt = callback.indexOf('buildFacebookOAuthCallbackScope(');
		const consumeAt = callback.indexOf('consumeFacebookOAuthState(stateRecord)');
		const exchangeAt = callback.indexOf('exchangeFacebookCodeForTokens(');
		assert.ok(resolveAt < scopeAt);
		assert.ok(scopeAt < consumeAt);
		assert.ok(consumeAt < exchangeAt);
	});
});

describe('Facebook OAuth callback error sanitization (P2-3 static)', () => {
	const callbackRoute = (() => {
		const marker = "router.get('/oauth/callback'";
		return route.slice(route.indexOf(marker), route.indexOf('router.use(pocketbaseAuth)'));
	})();

	it('does not copy Meta error_description or error.message into facebook_error', () => {
		assert.match(callbackRoute, /facebookOAuthProviderDeniedBrowserError\(\)/);
		assert.match(callbackRoute, /facebookOAuthCallbackBrowserError\(error\)/);
		assert.doesNotMatch(callbackRoute, /facebook_error: errorDescription/);
		assert.doesNotMatch(callbackRoute, /facebook_error: error\.message/);
		assert.doesNotMatch(callbackRoute, /errorDescription \|\| errorParam/);
		assert.match(seam, /export function facebookOAuthCallbackBrowserError/);
		assert.match(seam, /export function facebookOAuthProviderDeniedBrowserError/);
	});

	it('wraps Graph profile fetch after consume and keeps F3/F4/F5 order', () => {
		assert.match(callback, /FACEBOOK_OAUTH_PROFILE_FAILED/);
		assert.match(callback, /fetchFacebookProfile\(\{ accessToken \}\)/);
		const consumeAt = callback.indexOf('consumeFacebookOAuthState(stateRecord)');
		const exchangeAt = callback.indexOf('exchangeFacebookCodeForTokens(');
		const profileAt = callback.indexOf('fetchFacebookProfile({ accessToken })');
		assert.ok(consumeAt < exchangeAt);
		assert.ok(exchangeAt < profileAt);
		assert.match(callback, /FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED/);
		assert.match(callback, /FACEBOOK_OAUTH_ALREADY_CONNECTED_MESSAGE/);
		assert.match(callback, /FACEBOOK_OAUTH_PROFILE_IN_USE_MESSAGE/);
	});

	it('page sync warning is the fixed safe message, not error.message', () => {
		assert.match(callback, /pagesSyncWarning = FACEBOOK_OAUTH_PAGES_SYNC_WARNING_MESSAGE/);
		assert.doesNotMatch(callback, /pagesSyncWarning = error\.message/);
		assert.match(callback, /facebookOAuthPageSyncFailureLog\(/);
		assert.match(seam, /FACEBOOK_OAUTH_PAGES_SYNC_WARNING_MESSAGE/);
	});

	it('callback failure logs do not interpolate error.message', () => {
		assert.match(callbackRoute, /facebookOAuthCallbackFailureLog\(error\)/);
		assert.match(callbackRoute, /facebookOAuthProviderDeniedLog\(/);
		assert.doesNotMatch(callbackRoute, /\{ message: error\.message \}/);
		assert.doesNotMatch(callback, /message: pagesSyncWarning/);
		assert.doesNotMatch(callbackRoute, /error_description:/);
	});
});

describe('Facebook queue/analytics workspace isolation (P2-5 / P2-7 static)', () => {
	const queue = read('apps/api/src/services/facebook/facebook-publish-queue.js');
	const analytics = read('apps/api/src/services/facebook/facebook-analytics-sync.js');

	it('queue processJob asserts workspace isolation before Graph publish', () => {
		assert.match(queue, /assertFacebookQueueWorkspaceIsolation\(\{ job, account, page \}\)/);
		assert.match(seam, /export function assertFacebookQueueWorkspaceIsolation/);
		assert.match(queue, /buildFacebookQueuePageFilterParams/);
		const isolateAt = queue.indexOf('assertFacebookQueueWorkspaceIsolation({ job, account, page })');
		const publishAt = queue.indexOf('publishFeed({');
		assert.ok(isolateAt >= 0);
		assert.ok(publishAt > isolateAt);
		assert.doesNotMatch(queue, /existingFilter/);
	});

	it('analytics sync asserts the same isolation helper and skips on failure', () => {
		assert.match(analytics, /assertFacebookQueueWorkspaceIsolation\(\{ job, account, page \}\)/);
		assert.match(analytics, /Facebook analytics skipped job/);
		const isolateAt = analytics.indexOf('assertFacebookQueueWorkspaceIsolation({ job, account, page })');
		const fetchAt = analytics.indexOf('fetchInsights({');
		assert.ok(isolateAt >= 0);
		assert.ok(fetchAt > isolateAt);
		assert.doesNotMatch(analytics, /existingFilter/);
	});
});

describe('Facebook page sync workspace lookup (P2-6 static)', () => {
	const pageSync = extractExport(
		api,
		'export async function syncFacebookPagesForOwner',
		'export async function refreshFacebookAccessToken',
	);

	it('existing page lookup is owner + workspace + account, then page_id', () => {
		assert.match(pageSync, /assertFacebookAccountWorkspaceBound\(\{ owner, account \}\)/);
		assert.match(pageSync, /buildFacebookPageSyncExistingFilterParams\(/);
		assert.match(pageSync, /selectFacebookExistingPageInWorkspace\(/);
		assert.match(pageSync, /owner = \{\:owner\} && workspace = \{\:workspace\} && account = \{\:account\}/);
		assert.match(pageSync, /pageId,/);
		assert.doesNotMatch(pageSync, /pocketbaseClient\.filter\('account = \{\:account\}'/);
		assert.doesNotMatch(pageSync, /Prefer workspace scope when present/);
		assert.match(seam, /export function assertFacebookAccountWorkspaceBound/);
		assert.match(seam, /export function selectFacebookExistingPageInWorkspace/);
	});

	it('fails closed on missing account workspace before Graph page fetch', () => {
		const boundAt = pageSync.indexOf('assertFacebookAccountWorkspaceBound({ owner, account })');
		const graphAt = pageSync.indexOf('fetchFacebookPages({ accessToken })');
		assert.ok(boundAt >= 0);
		assert.ok(graphAt > boundAt);
		assert.doesNotMatch(pageSync, /account\.workspace \|\| ''/);
	});

	it('always stamps page payload workspace from the bound account', () => {
		assert.match(pageSync, /workspace: workspaceId/);
		assert.doesNotMatch(pageSync, /if \(account\.workspace\) payload\.workspace/);
		assert.match(pageSync, /selectFacebookExistingPageInWorkspace\(existingPages/);
	});
});

describe('Facebook GET /accounts pageCount workspace isolation (FB-P0-1 static)', () => {
	const accountsGet = (() => {
		const marker = "router.get('/accounts'";
		return route.slice(route.indexOf(marker), route.indexOf("router.patch('/accounts/:accountId'"));
	})();

	it('scopes facebook_pages pageCount by active workspace, not account only', () => {
		assert.match(accountsGet, /andWorkspaceScope\(req,\s*pocketbaseClient\.filter\('account = \{\:account\}'/);
		assert.doesNotMatch(accountsGet, /filter:\s*pocketbaseClient\.filter\('account = \{\:account\}'/);
		assert.match(seam, /export function countFacebookAccountPagesInWorkspace/);
		assert.match(seam, /export function buildFacebookAccountsSummary/);
	});

	it('preserves mapAccount and summary response shape', () => {
		assert.match(accountsGet, /\.\.\.mapAccount\(account\)/);
		assert.match(accountsGet, /pageCount:/);
		assert.match(accountsGet, /buildFacebookAccountsSummary\(items\)/);
		assert.match(accountsGet, /items,/);
		assert.doesNotMatch(accountsGet, /syncFacebookPagesForOwner/);
	});
});
