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
		assert.match(api, /import \{ ensureUserWorkspace \} from '\.\.\/workspace-context\.js'/);
		assert.match(oauthStart, /ensureUserWorkspace\(owner\)/);
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

	it('does not change OAuth start workspace fallback', () => {
		assert.match(oauthStart, /ensureUserWorkspace\(owner\)/);
		assert.match(oauthStart, /Workspace is required to start Facebook OAuth/);
		assert.doesNotMatch(oauthStart, /resolveFacebookOAuthCallbackWorkspace/);
	});

	it('surfaces the callback error through the existing Facebook reconnect redirect', () => {
		const marker = "router.get('/oauth/callback'";
		const section = route.slice(route.indexOf(marker), route.indexOf('router.use(pocketbaseAuth)'));
		assert.match(section, /completeFacebookOAuthCallback\(\{ code, state \}\)/);
		assert.match(section, /facebook_error: error\.message \|\| 'Facebook connect failed'/);
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
