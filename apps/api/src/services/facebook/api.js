import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import logger from '../../utils/logger.js';
import { ensureUserWorkspace } from '../workspace-context.js';
import { writeAuditLog } from '../audit/write.js';
import {
	ensureFacebookChannelSchema,
	isMissingFacebookCollectionError,
} from '../../utils/ensure-facebook-oauth-schema.js';
import {
	assertFacebookOAuthReady,
	getFacebookAppCredentials,
} from './app-credentials.js';
import { DEFAULT_SCOPES, mergeRequiredScopes, analyzeGrantedScopes, scopesForLoginDialog } from './scopes.js';
import {
	decryptAccountAccessToken,
	deleteFacebookAccountSecrets,
	hydrateFacebookAccountSecrets,
	replaceFacebookAccountSecrets,
} from './secrets.js';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG_BASE = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const STATE_TTL_MS = 15 * 60 * 1000;
const FACEBOOK_OAUTH_FRONTEND_BASE = process.env.APP_WEB_URL || process.env.WEB_APP_URL || 'http://localhost:3000';

function normalizeOAuthRedirectUri(value) {
	return String(value || '').trim();
}

function assertValidFacebookAppId(appId) {
	const id = String(appId || '').trim();
	if (!/^\d{5,}$/.test(id)) {
		throw httpError(
			422,
			'Facebook App ID is invalid. Use the numeric App ID from Meta Developers → App settings.',
			'FACEBOOK_APP_ID_INVALID',
		);
	}
	return id;
}

function httpError(status, message, errorCode = 'FACEBOOK_API_ERROR') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function normalizeString(value, _name, { max = 255, required = false } = {}) {
	const next = String(value ?? '').trim();
	if (required && !next) {
		throw httpError(422, 'Required field missing');
	}
	return next.slice(0, max);
}

function normalizeDate(value) {
	if (!value) return '';
	const ms = new Date(value).getTime();
	return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function relationId(value) {
	if (!value) return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || '').trim();
	return String(value).trim();
}

function isPlaceholderWebUrl(value) {
	return /your-domain\.com|example\.com|localhost/i.test(String(value || '')) && !/localhost|127\.0\.0\.1/i.test(String(value || ''));
}

async function getWebAppBaseUrl() {
	const env = String(process.env.APP_WEB_URL || process.env.WEB_APP_URL || '').trim();
	if (env && !isPlaceholderWebUrl(env)) return env.replace(/\/$/, '');
	return FACEBOOK_OAUTH_FRONTEND_BASE.replace(/\/$/, '');
}

export async function buildFacebookOAuthAppRedirect(query = {}) {
	const base = await getWebAppBaseUrl();
	const url = new URL('/app/facebook', `${base}/`);
	for (const [key, value] of Object.entries(query || {})) {
		if (value == null || value === '') continue;
		url.searchParams.set(key, String(value));
	}
	return url.toString();
}

export async function getFacebookRedirectUri() {
	const credentials = await getFacebookAppCredentials();
	return String(
		credentials.redirectUri
		|| process.env.FACEBOOK_REDIRECT_URI
		|| `${process.env.API_PUBLIC_URL || 'http://localhost:3001'}/facebook/oauth/callback`,
	).trim();
}

export function mapPage(record) {
	return {
		id: record.id,
		accountId: record.account,
		pageId: record.page_id,
		name: record.name,
		category: record.category || '',
		thumbnailUrl: record.thumbnail_url || '',
		fanCount: Number(record.fan_count) || 0,
		isDefault: Boolean(record.is_default),
		connected: record.connected !== false,
		websiteId: record.websiteId || '',
		updatedAt: record.updated,
	};
}

export function mapAccount(record) {
	if (!record) {
		return { connected: false };
	}
	return {
		id: record.id,
		connected: Boolean(record.connected),
		label: record.label || '',
		accountName: record.account_name || '',
		username: record.username || '',
		profileImageUrl: record.profile_image_url || '',
		facebookUserId: record.facebook_user_id || '',
		workspaceId: record.workspace || record.workspace_id || '',
		workspaceKey: record.workspace_key || '',
		scope: record.scope || '',
		scopes: record.scope || '',
		accountStatus: record.status || (record.connected ? 'connected' : 'error'),
		status: record.status || (record.connected ? 'connected' : 'error'),
		statusError: record.status_error || '',
		isDefault: Boolean(record.is_default),
		connectedAt: normalizeDate(record.connected_at || record.created),
		expiresAt: normalizeDate(record.token_expires_at),
		tokenExpiresAt: normalizeDate(record.token_expires_at),
		oauthAppId: record.oauth_app_id || '',
		lastSyncAt: normalizeDate(record.last_sync_at),
		createdAt: normalizeDate(record.created),
		updatedAt: normalizeDate(record.updated),
	};
}

async function graphGet(path, accessToken, query = {}) {
	const url = new URL(path.startsWith('http') ? path : `${GRAPH_BASE}${path}`);
	url.searchParams.set('access_token', accessToken);
	for (const [key, value] of Object.entries(query)) {
		if (value == null || value === '') continue;
		url.searchParams.set(key, String(value));
	}
	const response = await fetch(url.toString(), { method: 'GET' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload.error) {
		const message = payload?.error?.message || `Facebook Graph error (${response.status})`;
		const err = httpError(response.status === 401 ? 401 : 502, message, 'FACEBOOK_GRAPH_ERROR');
		err.raw = payload;
		throw err;
	}
	return payload;
}

export async function createFacebookOAuthState({
	owner,
	accountId = '',
	requestedLabel = '',
	workspaceId = '',
	workspaceKey = '',
	returnPath = '',
	websiteId = '',
}) {
	const credentials = await assertFacebookOAuthReady();
	await ensureFacebookChannelSchema(pocketbaseClient);
	const clientId = assertValidFacebookAppId(credentials.appId);
	const redirectUri = normalizeOAuthRedirectUri(credentials.redirectUri);
	if (!redirectUri) {
		throw httpError(500, 'Facebook redirect URI is not configured.', 'FACEBOOK_REDIRECT_MISSING');
	}

	const state = randomBytes(24).toString('hex');
	const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
	const scopes = scopesForLoginDialog(credentials.scopes?.length ? credentials.scopes : DEFAULT_SCOPES);
	const scopeParam = scopes.join(',');

	let resolvedWorkspaceId = workspaceId;
	let resolvedWorkspaceKey = workspaceKey;
	if (!resolvedWorkspaceId || !resolvedWorkspaceKey) {
		try {
			const ctx = await ensureUserWorkspace(owner);
			resolvedWorkspaceId = resolvedWorkspaceId || ctx.workspace?.id || '';
			resolvedWorkspaceKey = resolvedWorkspaceKey || ctx.workspaceKey || ctx.workspace?.workspace_key || owner;
		} catch {
			resolvedWorkspaceKey = resolvedWorkspaceKey || owner;
		}
	}

	if (!resolvedWorkspaceId) {
		throw httpError(422, 'Workspace is required to start Facebook OAuth.', 'FACEBOOK_WORKSPACE_REQUIRED');
	}

	const body = {
		owner,
		state,
		expires_at: expiresAt,
		used: false,
		account_id: accountId || '',
		requested_label: requestedLabel || '',
		workspace_id: resolvedWorkspaceId || '',
		workspace_key: resolvedWorkspaceKey || '',
		return_path: returnPath || '',
		workspace: resolvedWorkspaceId,
	};
	if (websiteId) body.websiteId = websiteId;

	try {
		await pocketbaseClient.collection('facebook_oauth_states').create(body);
	} catch (error) {
		// Older / partial schemas may reject optional fields — retry minimal required set.
		await pocketbaseClient.collection('facebook_oauth_states').create({
			owner,
			state,
			expires_at: expiresAt,
			used: false,
			workspace: resolvedWorkspaceId,
		}).catch(() => {
			throw error;
		});
	}

	const url = new URL(DIALOG_BASE);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('state', state);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', scopeParam);
	const authUrl = url.toString();

	logger.info('[facebook-oauth] authorization URL built', {
		authUrl,
		clientId,
		redirectUri,
		responseType: 'code',
		scope: scopeParam,
		scopes,
		state,
		dialogBase: DIALOG_BASE,
		graphVersion: GRAPH_VERSION,
	});

	return {
		authUrl,
		state,
		expiresAt,
		redirectUri,
		clientId,
		scopes,
		responseType: 'code',
	};
}

export async function exchangeFacebookCodeForTokens({ code, redirectUri }) {
	const credentials = await assertFacebookOAuthReady();
	const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
	url.searchParams.set('client_id', credentials.appId);
	url.searchParams.set('client_secret', credentials.appSecret);
	url.searchParams.set('redirect_uri', redirectUri || normalizeOAuthRedirectUri(credentials.redirectUri));
	url.searchParams.set('code', code);

	const response = await fetch(url.toString(), { method: 'GET' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload.error || !payload.access_token) {
		throw httpError(502, payload?.error?.message || 'Facebook token exchange failed', 'FACEBOOK_TOKEN_EXCHANGE');
	}
	return payload;
}

/** Exchange short-lived user token for long-lived (~60 days). */
export async function exchangeFacebookLongLivedToken(shortLivedToken) {
	const credentials = await assertFacebookOAuthReady();
	const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
	url.searchParams.set('grant_type', 'fb_exchange_token');
	url.searchParams.set('client_id', credentials.appId);
	url.searchParams.set('client_secret', credentials.appSecret);
	url.searchParams.set('fb_exchange_token', shortLivedToken);

	const response = await fetch(url.toString(), { method: 'GET' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload.error || !payload.access_token) {
		throw httpError(502, payload?.error?.message || 'Facebook long-lived token exchange failed', 'FACEBOOK_TOKEN_REFRESH');
	}
	return payload;
}

export async function fetchFacebookProfile({ accessToken }) {
	return graphGet('/me', accessToken, { fields: 'id,name,picture.type(large)' });
}

export async function fetchFacebookPages({ accessToken }) {
	const pages = [];
	let next = null;
	let path = '/me/accounts';
	const query = { fields: 'id,name,access_token,category,tasks,picture.type(large),fan_count', limit: '100' };

	do {
		const payload = next
			? await graphGet(next, accessToken)
			: await graphGet(path, accessToken, query);
		pages.push(...(payload.data || []));
		next = payload.paging?.next || null;
		path = null;
	} while (next);

	return pages;
}

export async function getOwnedFacebookAccounts(owner, req = null) {
	await ensureFacebookChannelSchema(pocketbaseClient).catch(() => null);
	const filter = req
		? (await import('../workspace-ownership.js')).andWorkspaceScope(req)
		: pocketbaseClient.filter('owner = {:owner}', { owner });
	try {
		const accounts = await pocketbaseClient.collection('facebook_accounts').getFullList({
			sort: '-created',
			filter,
		});
		return accounts.sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)));
	} catch (error) {
		if (isMissingFacebookCollectionError(error)) return [];
		throw error;
	}
}

export async function getOwnedFacebookAccountById({ owner, accountId, req = null }) {
	const id = relationId(accountId);
	if (!id) return null;
	const record = await pocketbaseClient.collection('facebook_accounts').getOne(id).catch(() => null);
	if (!record) return null;
	if (req) {
		const { recordBelongsToWorkspace } = await import('../workspace-ownership.js');
		if (!recordBelongsToWorkspace(record, req)) return null;
	} else if (record.owner !== owner) {
		return null;
	}
	return hydrateFacebookAccountSecrets(record);
}

export async function getOwnedFacebookAccountByFacebookUserId({ owner, facebookUserId, req = null }) {
	if (!facebookUserId) return null;
	const { andWorkspaceScope } = await import('../workspace-ownership.js');
	const base = pocketbaseClient.filter('facebook_user_id = {:uid}', { uid: facebookUserId });
	const filter = req ? andWorkspaceScope(req, base) : pocketbaseClient.filter('owner = {:owner} && facebook_user_id = {:uid}', { owner, uid: facebookUserId });
	const row = await pocketbaseClient.collection('facebook_accounts').getFirstListItem(filter, { requestKey: null }).catch(() => null);
	return row ? hydrateFacebookAccountSecrets(row) : null;
}

export async function setDefaultFacebookAccount({ owner, accountId, req = null }) {
	const account = await getOwnedFacebookAccountById({ owner, accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');
	const accounts = await getOwnedFacebookAccounts(owner, req);
	await Promise.all(accounts.map((item) => (
		pocketbaseClient.collection('facebook_accounts').update(item.id, {
			is_default: item.id === accountId,
		}).catch(() => null)
	)));
	return pocketbaseClient.collection('facebook_accounts').getOne(accountId);
}

export async function setDefaultFacebookPage({ owner, accountId, pageRecordId, req = null }) {
	const account = await getOwnedFacebookAccountById({ owner, accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');

	const page = await pocketbaseClient.collection('facebook_pages').getOne(pageRecordId).catch(() => null);
	const { recordBelongsToWorkspace } = await import('../workspace-ownership.js');
	const owned = req
		? page && recordBelongsToWorkspace(page, req) && page.account === accountId
		: page && page.owner === owner && page.account === accountId;
	if (!owned) throw httpError(404, 'Facebook Page not found for this account');

	const { andWorkspaceScope } = await import('../workspace-ownership.js');
	const pagesFilter = req
		? andWorkspaceScope(req, pocketbaseClient.filter('account = {:account}', { account: accountId }))
		: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: accountId });

	const pages = await pocketbaseClient.collection('facebook_pages').getFullList({ filter: pagesFilter });
	await Promise.all(pages.map((item) => (
		pocketbaseClient.collection('facebook_pages').update(item.id, {
			is_default: item.id === pageRecordId,
		}).catch(() => null)
	)));
	return pocketbaseClient.collection('facebook_pages').getOne(pageRecordId);
}

export async function markFacebookAccountStatus({ accountId, status, statusError = '' }) {
	if (!accountId) return null;
	return pocketbaseClient.collection('facebook_accounts').update(accountId, {
		status,
		status_error: String(statusError || '').slice(0, 2000),
		connected: status === 'connected',
	}).catch(() => null);
}

export async function syncFacebookPagesForOwner({ owner, account }) {
	const hydrated = account.access_token
		? account
		: await hydrateFacebookAccountSecrets(account);
	const accessToken = decryptAccountAccessToken(hydrated);
	if (!accessToken) {
		await markFacebookAccountStatus({ accountId: account.id, status: 'expired', statusError: 'Access token missing' });
		throw httpError(401, 'Facebook access token is missing. Please reconnect.');
	}

	let pages = [];
	try {
		pages = await fetchFacebookPages({ accessToken });
	} catch (error) {
		const status = error.status === 401 ? 'expired' : 'error';
		await markFacebookAccountStatus({ accountId: account.id, status, statusError: error.message });
		throw error;
	}

	// Prefer workspace scope when present on account
	const existingFilter = account.workspace
		? pocketbaseClient.filter('account = {:account}', { account: account.id })
		: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: account.id });

	const existingPages = await pocketbaseClient.collection('facebook_pages').getFullList({
		filter: existingFilter,
	});
	const existingByPageId = new Map(existingPages.map((item) => [item.page_id, item]));
	const incomingIds = new Set();
	const pageTokens = {};

	for (const page of pages) {
		const pageId = String(page.id || '').trim();
		if (!pageId) continue;
		incomingIds.add(pageId);
		if (page.access_token) pageTokens[pageId] = page.access_token;

		const payload = {
			owner,
			account: account.id,
			page_id: pageId,
			name: String(page.name || '').trim() || 'Untitled Page',
			category: String(page.category || '').trim(),
			thumbnail_url: page.picture?.data?.url || '',
			fan_count: Number(page.fan_count) || 0,
			tasks: page.tasks || [],
			connected: true,
		};
		if (account.workspace) payload.workspace = account.workspace;

		const existing = existingByPageId.get(pageId);
		if (existing) {
			await pocketbaseClient.collection('facebook_pages').update(existing.id, payload);
		} else {
			payload.is_default = existingPages.length === 0 && incomingIds.size === 1;
			await pocketbaseClient.collection('facebook_pages').create(payload);
		}
	}

	for (const existing of existingPages) {
		if (!incomingIds.has(existing.page_id)) {
			await pocketbaseClient.collection('facebook_pages').update(existing.id, { connected: false }).catch(() => null);
		}
	}

	await replaceFacebookAccountSecrets({
		owner,
		workspaceId: account.workspace || '',
		accountId: account.id,
		accessToken,
		refreshToken: '',
		pageTokens,
	}).catch(() => null);

	await pocketbaseClient.collection('facebook_accounts').update(account.id, {
		last_sync_at: new Date().toISOString(),
		status: 'connected',
		status_error: '',
		connected: true,
	}).catch(() => null);

	return pocketbaseClient.collection('facebook_pages').getFullList({
		filter: existingFilter,
		sort: 'name',
	});
}

/**
 * Refresh long-lived user token (Meta: re-exchange current token).
 */
export async function refreshFacebookAccessToken({ account }) {
	const hydrated = await hydrateFacebookAccountSecrets(account);
	const current = decryptAccountAccessToken(hydrated);
	if (!current) {
		await markFacebookAccountStatus({ accountId: account.id, status: 'expired', statusError: 'Access token missing' });
		throw httpError(401, 'Facebook access token is missing. Please reconnect.');
	}

	const payload = await exchangeFacebookLongLivedToken(current);
	const nextAccess = String(payload.access_token || '').trim();
	if (!nextAccess) {
		await markFacebookAccountStatus({ accountId: account.id, status: 'expired', statusError: 'Token refresh returned empty token' });
		throw httpError(401, 'Facebook token refresh failed. Please reconnect.');
	}

	const expiresAt = payload.expires_in
		? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
		: '';

	await replaceFacebookAccountSecrets({
		owner: account.owner,
		workspaceId: account.workspace || '',
		accountId: account.id,
		accessToken: nextAccess,
		refreshToken: '',
	});

	const updated = await pocketbaseClient.collection('facebook_accounts').update(account.id, {
		token_expires_at: expiresAt,
		status: 'connected',
		status_error: '',
		connected: true,
	});

	logger.info('[facebook-token] refreshed long-lived user token', { accountId: account.id, expiresAt });
	return hydrateFacebookAccountSecrets(updated);
}

export async function disconnectFacebookAccount({ owner, accountId, req = null, actor = {} }) {
	const account = await getOwnedFacebookAccountById({ owner, accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');

	const { andWorkspaceScope } = await import('../workspace-ownership.js');
	const pagesFilter = req
		? andWorkspaceScope(req, pocketbaseClient.filter('account = {:account}', { account: account.id }))
		: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: account.id });

	const pages = await pocketbaseClient.collection('facebook_pages').getFullList({ filter: pagesFilter }).catch(() => []);
	await Promise.all(pages.map((page) => pocketbaseClient.collection('facebook_pages').delete(page.id).catch(() => null)));
	await deleteFacebookAccountSecrets(account.id);

	await pocketbaseClient.collection('facebook_accounts').update(account.id, {
		connected: false,
		status: 'disconnected',
		status_error: '',
		is_default: false,
		token_expires_at: '',
	});

	await writeAuditLog({
		category: 'workspace',
		uiCategory: 'Facebook',
		action: 'Disconnected Facebook account',
		actorUserId: actor.id || owner,
		actorLabel: actor.email || actor.name || owner,
		resourceType: 'facebook_accounts',
		resourceId: account.id,
		result: 'ok',
		metadata: { facebookUserId: account.facebook_user_id || '' },
	}).catch(() => null);

	return true;
}

export async function completeFacebookOAuthCallback({ code, state }) {
	const stateRecord = await pocketbaseClient.collection('facebook_oauth_states').getFirstListItem(
		pocketbaseClient.filter('state = {:state}', { state }),
	).catch(() => null);

	if (!stateRecord) throw httpError(400, 'Invalid OAuth state');
	if (stateRecord.used) throw httpError(400, 'OAuth state already used');
	if (new Date(stateRecord.expires_at).getTime() < Date.now()) throw httpError(400, 'OAuth state expired');

	await pocketbaseClient.collection('facebook_oauth_states').update(stateRecord.id, { used: true });

	const redirectUri = await getFacebookRedirectUri();
	const shortLived = await exchangeFacebookCodeForTokens({ code, redirectUri });
	const longLived = await exchangeFacebookLongLivedToken(shortLived.access_token).catch(() => shortLived);
	const accessToken = normalizeString(longLived.access_token || shortLived.access_token, 'access_token', { required: true, max: 4000 });
	const expiresAt = longLived.expires_in || shortLived.expires_in
		? new Date(Date.now() + Number(longLived.expires_in || shortLived.expires_in) * 1000).toISOString()
		: '';
	const scope = normalizeString(longLived.scope || shortLived.scope || '', 'scope', { max: 2000 });

	const credentials = await getFacebookAppCredentials();
	const scopeCheck = analyzeGrantedScopes({
		requested: credentials.scopes?.length ? credentials.scopes : DEFAULT_SCOPES,
		granted: scope,
	});
	// Meta often omits scope echo on exchange — do not hard-fail if empty; warn only.
	if (scope && !scopeCheck.ok) {
		logger.warn('[facebook-oauth] granted scopes missing some requested', {
			missing: scopeCheck.missing,
			granted: scopeCheck.granted,
		});
	}

	const profile = await fetchFacebookProfile({ accessToken });
	const facebookUserId = normalizeString(profile?.id || '', 'facebook_user_id', { required: true, max: 120 });
	const accountName = normalizeString(profile?.name || '', 'account_name', { max: 255 });
	const profileImageUrl = normalizeString(profile?.picture?.data?.url || '', 'profile_image_url', { max: 1000 });

	const reconnectAccountId = normalizeString(stateRecord.account_id, 'account_id', { max: 80 });
	const reconnectAccount = reconnectAccountId
		? await getOwnedFacebookAccountById({ owner: stateRecord.owner, accountId: reconnectAccountId })
		: null;
	const existingByUser = await getOwnedFacebookAccountByFacebookUserId({
		owner: stateRecord.owner,
		facebookUserId,
	});

	if (existingByUser && !reconnectAccountId) {
		throw httpError(409, 'This Facebook account is already connected. Use reconnect instead.');
	}
	if (existingByUser && reconnectAccount && existingByUser.id !== reconnectAccount.id) {
		throw httpError(409, 'Another connected account already uses this Facebook profile.');
	}

	let workspaceId = normalizeString(stateRecord.workspace_id || '', 'workspace_id', { max: 80 });
	let workspaceKey = normalizeString(stateRecord.workspace_key || '', 'workspace_key', { max: 120 });
	if (!workspaceId || !workspaceKey) {
		try {
			const ctx = await ensureUserWorkspace(stateRecord.owner);
			workspaceId = workspaceId || ctx.workspace?.id || '';
			workspaceKey = workspaceKey || ctx.workspaceKey || ctx.workspace?.workspace_key || stateRecord.owner;
		} catch {
			workspaceKey = workspaceKey || stateRecord.owner;
		}
	}

	const requestedLabel = normalizeString(stateRecord.requested_label, 'requested_label', { max: 255 });
	const payload = {
		owner: stateRecord.owner,
		facebook_user_id: facebookUserId,
		username: accountName,
		account_name: accountName,
		profile_image_url: profileImageUrl,
		token_expires_at: expiresAt,
		scope,
		connected: true,
		status: 'connected',
		status_error: '',
		connected_at: reconnectAccount?.connected_at || new Date().toISOString(),
		label: requestedLabel || reconnectAccount?.label || existingByUser?.label || accountName || 'Facebook Account',
		workspace_id: workspaceId,
		workspace_key: workspaceKey,
		oauth_app_id: String(credentials.appId || '').trim(),
	};
	if (workspaceId) payload.workspace = workspaceId;

	const target = reconnectAccount || existingByUser;
	const accounts = await getOwnedFacebookAccounts(stateRecord.owner);
	if (!target && accounts.every((item) => !item.is_default)) {
		payload.is_default = true;
	}

	const saved = target
		? await pocketbaseClient.collection('facebook_accounts').update(target.id, payload)
		: await pocketbaseClient.collection('facebook_accounts').create(payload);

	await replaceFacebookAccountSecrets({
		owner: stateRecord.owner,
		workspaceId,
		accountId: saved.id,
		accessToken,
		refreshToken: '',
	});

	let pagesSyncWarning = '';
	try {
		await syncFacebookPagesForOwner({ owner: stateRecord.owner, account: saved });
	} catch (error) {
		pagesSyncWarning = error.message || 'Page sync failed';
		logger.warn('[facebook-oauth] page sync failed after connect', { accountId: saved.id, message: pagesSyncWarning });
	}

	await writeAuditLog({
		category: 'workspace',
		uiCategory: 'Facebook',
		action: reconnectAccount ? 'Reconnected Facebook account' : 'Connected Facebook account',
		actorUserId: stateRecord.owner,
		resourceType: 'facebook_accounts',
		resourceId: saved.id,
		result: 'ok',
		metadata: { facebookUserId, pagesSyncWarning: pagesSyncWarning || undefined },
	}).catch(() => null);

	return {
		account: saved,
		pagesSyncWarning,
		returnPath: stateRecord.return_path || '',
	};
}

export { analyzeGrantedScopes, mergeRequiredScopes, DEFAULT_SCOPES };
