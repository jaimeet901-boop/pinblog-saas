import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import {
	decryptAccountAccessToken,
	decryptAccountRefreshToken,
	describePinterestTokenState,
	hydratePinterestAccountSecrets,
	replacePinterestAccountSecrets,
	upsertPinterestAccountSecrets,
	relationId,
} from './pinterest-secrets.js';
import {
	assertPinterestOAuthReady,
	getPinterestAppCredentials,
} from './pinterest-app-credentials.js';
import { DEFAULT_SCOPES, analyzeGrantedScopes, mergeRequiredScopes } from './pinterest-scopes.js';
import { ensureUserWorkspace } from './workspace-context.js';
import logger from '../utils/logger.js';

const PINTEREST_API_BASE = 'https://api.pinterest.com/v5';
const PINTEREST_AUTH_BASE = 'https://www.pinterest.com/oauth';
const STATE_TTL_MS = 10 * 60 * 1000;

function httpError(status, message, extras = {}) {
	const error = new Error(message);
	error.status = status;
	Object.assign(error, extras);
	return error;
}

export function isPinterestTrialAccessError(errorOrMessage) {
	const text = String(
		errorOrMessage?.rawResponseBody
		|| errorOrMessage?.originalMessage
		|| errorOrMessage?.message
		|| (typeof errorOrMessage?.responseBody === 'object'
			? JSON.stringify(errorOrMessage.responseBody)
			: errorOrMessage?.responseBody)
		|| errorOrMessage
		|| '',
	).toLowerCase();
	if (!text.includes('trial access')) {
		return false;
	}
	return text.includes('create pin')
		|| text.includes('may not create')
		|| text.includes('production');
}

function normalizeDate(value) {
	if (!value) {
		return '';
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	return date.toISOString();
}

function isPlaceholderWebUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return true;
	// Substring guard first — catches quoted/malformed env values before URL parsing.
	if (/your-domain\.com|example\.com/i.test(raw)) return true;
	try {
		const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
		return !host
			|| host === 'your-domain.com'
			|| host.endsWith('.your-domain.com')
			|| host === 'example.com'
			|| host.endsWith('.example.com');
	} catch {
		return true;
	}
}

function normalizeWebAppBase(value) {
	return String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
}

function deriveWebAppBaseFromApiUrl() {
	const candidates = [
		process.env.API_PUBLIC_URL,
		process.env.PINTEREST_REDIRECT_URI,
	];
	for (const candidate of candidates) {
		const raw = normalizeWebAppBase(candidate);
		if (!raw || isPlaceholderWebUrl(raw)) continue;
		try {
			return new URL(raw.includes('://') ? raw : `https://${raw}`).origin;
		} catch {
			// keep looking
		}
	}
	return '';
}

/** Canonical production frontend origin fallback (post-OAuth browser return). */
export const PINTEREST_OAUTH_FRONTEND_BASE = 'https://tbuy.store';

function collectEnvWebAppCandidates() {
	return [
		process.env.WEB_APP_URL,
		process.env.APP_WEB_URL,
		process.env.PUBLIC_APP_URL,
		process.env.APP_PUBLIC_URL,
		...(String(process.env.CORS_ORIGIN || '').split(',')),
		deriveWebAppBaseFromApiUrl(),
	]
		.map(normalizeWebAppBase)
		.filter(Boolean);
}

function firstValidWebAppOrigin(candidates = []) {
	for (const candidate of candidates) {
		if (!candidate || isPlaceholderWebUrl(candidate)) continue;
		try {
			return new URL(candidate.includes('://') ? candidate : `https://${candidate}`).origin;
		} catch {
			// keep looking
		}
	}
	return '';
}

/**
 * Frontend origin used for Pinterest OAuth browser redirects (/app/pinterest).
 * Chain: Environment → Platform Identity domains.appUrl → safe fallback.
 * Rejects template placeholders like your-domain.com.
 */
export async function getWebAppBaseUrl() {
	const fromEnv = firstValidWebAppOrigin(collectEnvWebAppCandidates());
	if (fromEnv) return fromEnv;

	try {
		const { getPublicPlatformIdentity } = await import('./platform-settings.js');
		const identity = await getPublicPlatformIdentity();
		const fromIdentity = firstValidWebAppOrigin([
			identity?.appUrl,
			identity?.canonicalUrl,
			identity?.primaryDomain ? `https://${String(identity.primaryDomain).replace(/^https?:\/\//i, '')}` : '',
		]);
		if (fromIdentity) return fromIdentity;
	} catch {
		/* keep fallback */
	}

	if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
		return PINTEREST_OAUTH_FRONTEND_BASE;
	}

	return 'http://localhost:3000';
}

/**
 * Absolute URL for post-OAuth browser return.
 * Prefer env, then Platform Identity domains.appUrl, then production fallback.
 * Never trusts WEB_APP_URL / CORS placeholders like your-domain.com.
 */
export async function buildPinterestOAuthAppRedirect(query = {}) {
	const resolved = await getWebAppBaseUrl();
	const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(resolved);
	let base = resolved || PINTEREST_OAUTH_FRONTEND_BASE;

	if (!localOrigin && (isPlaceholderWebUrl(base) || /your-domain\.com/i.test(base))) {
		base = PINTEREST_OAUTH_FRONTEND_BASE;
	}

	const url = new URL('/app/pinterest', base.endsWith('/') ? base : `${base}/`);
	for (const [key, value] of Object.entries(query || {})) {
		if (value == null || value === '') continue;
		url.searchParams.set(key, String(value));
	}

	const href = url.toString();
	if (/your-domain\.com/i.test(href)) {
		const safe = new URL('/app/pinterest', `${PINTEREST_OAUTH_FRONTEND_BASE}/`);
		for (const [key, value] of Object.entries(query || {})) {
			if (value == null || value === '') continue;
			safe.searchParams.set(key, String(value));
		}
		return safe.toString();
	}
	return href;
}

export async function getPinterestRedirectUri() {
	const credentials = await getPinterestAppCredentials();
	return credentials.redirectUri
		|| process.env.PINTEREST_REDIRECT_URI
		|| `${process.env.API_PUBLIC_URL || 'http://localhost:3001'}/pinterest/oauth/callback`;
}

export function mapBoard(record) {
	return {
		id: record.id,
		accountId: record.account,
		boardId: record.board_id,
		name: record.name,
		thumbnailUrl: record.thumbnail_url || '',
		description: record.description || '',
		privacy: record.privacy || '',
		accountLabel: record.account_label || '',
		accountUsername: record.account_username || '',
		isDefault: Boolean(record.is_default),
		updatedAt: record.updated,
	};
}

export function mapAccount(record) {
	if (!record) {
		return {
			connected: false,
		};
	}

	return {
		id: record.id,
		connected: Boolean(record.connected),
		label: record.label || '',
		accountName: record.account_name || '',
		username: record.username || '',
		profileImageUrl: record.profile_image_url || '',
		pinterestUserId: record.pinterest_user_id || '',
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

export async function getOwnedPinterestAccounts(owner, req = null) {
	const filter = req
		? (await import('./workspace-ownership.js')).andWorkspaceScope(req)
		: pocketbaseClient.filter('owner = {:owner}', { owner });
	const accounts = await pocketbaseClient.collection('pinterest_accounts').getFullList({
		sort: '-created',
		filter,
	});

	// Prefer defaults in-memory so missing is_default schema never breaks the API.
	return accounts.sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)));
}

export async function getOwnedPinterestAccount(owner, req = null) {
	const accounts = await getOwnedPinterestAccounts(owner, req);
	const isUsable = (account) => {
		if (!account?.connected) {
			return false;
		}
		const status = String(account.status || '').trim();
		return !status || status === 'connected';
	};

	const preferredDefault = accounts.find((account) => account.is_default && isUsable(account));
	if (preferredDefault) {
		return hydratePinterestAccountSecrets(preferredDefault);
	}
	const connected = accounts.find((account) => isUsable(account));
	const selected = connected || accounts.find((account) => account.is_default) || accounts[0] || null;
	return selected ? hydratePinterestAccountSecrets(selected) : null;
}

export async function getDefaultPinterestBoard({ owner, accountId, req = null }) {
	if (!accountId) {
		return null;
	}

	const { andWorkspaceScope } = await import('./workspace-ownership.js');
	const filter = req
		? andWorkspaceScope(req, pocketbaseClient.filter('account = {:account}', { account: accountId }))
		: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: accountId });

	const boards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		sort: 'name',
		filter,
	});

	return boards.find((board) => board.is_default) || boards[0] || null;
}

export async function setDefaultPinterestAccount({ owner, accountId, req = null }) {
	const account = await getOwnedPinterestAccountById({ owner, accountId, req });
	if (!account) {
		throw httpError(404, 'Pinterest account not found');
	}

	const accounts = await getOwnedPinterestAccounts(owner, req);
	await Promise.all(accounts.map((item) => (
		pocketbaseClient.collection('pinterest_accounts').update(item.id, {
			is_default: item.id === accountId,
		}).catch(() => null)
	)));

	return pocketbaseClient.collection('pinterest_accounts').getOne(accountId);
}

export async function setDefaultPinterestBoard({ owner, accountId, boardRecordId, req = null }) {
	const account = await getOwnedPinterestAccountById({ owner, accountId, req });
	if (!account) {
		throw httpError(404, 'Pinterest account not found');
	}

	const board = await pocketbaseClient.collection('pinterest_boards').getOne(boardRecordId).catch(() => null);
	const { recordBelongsToWorkspace } = await import('./workspace-ownership.js');
	const boardOwned = req
		? board && recordBelongsToWorkspace(board, req) && board.account === accountId
		: board && board.owner === owner && board.account === accountId;
	if (!boardOwned) {
		throw httpError(404, 'Pinterest board not found for this account');
	}

	const { andWorkspaceScope } = await import('./workspace-ownership.js');
	const boardsFilter = req
		? andWorkspaceScope(req, pocketbaseClient.filter('account = {:account}', { account: accountId }))
		: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: accountId });

	const boards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		filter: boardsFilter,
	});

	await Promise.all(boards.map((item) => (
		pocketbaseClient.collection('pinterest_boards').update(item.id, {
			is_default: item.id === boardRecordId,
		}).catch(() => null)
	)));

	return pocketbaseClient.collection('pinterest_boards').getOne(boardRecordId);
}

export async function getOwnedPinterestAccountById({ owner, accountId, req = null }) {
	const id = relationId(accountId);
	if (!id) {
		return null;
	}

	const record = await pocketbaseClient.collection('pinterest_accounts').getOne(id).catch(() => null);
	if (!record) {
		return null;
	}
	if (req) {
		const { recordBelongsToWorkspace } = await import('./workspace-ownership.js');
		if (!recordBelongsToWorkspace(record, req)) {
			return null;
		}
	} else if (record.owner !== owner) {
		return null;
	}
	return hydratePinterestAccountSecrets(record);
}

export async function getOwnedPinterestAccountByPinterestUserId({ owner, pinterestUserId, req = null }) {
	if (!pinterestUserId) {
		return null;
	}

	const { andWorkspaceScope } = await import('./workspace-ownership.js');
	const filter = req
		? andWorkspaceScope(req, pocketbaseClient.filter('pinterest_user_id = {:pinterestUserId}', { pinterestUserId }))
		: pocketbaseClient.filter('owner = {:owner} && pinterest_user_id = {:pinterestUserId}', { owner, pinterestUserId });

	const record = await pocketbaseClient.collection('pinterest_accounts').getFirstListItem(filter).catch(() => null);

	return record ? hydratePinterestAccountSecrets(record) : null;
}

export async function getOwnedPinterestBoard({ owner, boardId, accountId = '', req = null }) {
	const { andWorkspaceScope } = await import('./workspace-ownership.js');
	const boardExpr = accountId
		? pocketbaseClient.filter('board_id = {:boardId} && account = {:accountId}', { boardId, accountId })
		: pocketbaseClient.filter('board_id = {:boardId}', { boardId });
	const filter = req
		? andWorkspaceScope(req, boardExpr)
		: (accountId
			? pocketbaseClient.filter('owner = {:owner} && board_id = {:boardId} && account = {:accountId}', { owner, boardId, accountId })
			: pocketbaseClient.filter('owner = {:owner} && board_id = {:boardId}', { owner, boardId }));
	const board = await pocketbaseClient.collection('pinterest_boards').getFirstListItem(filter).catch(() => null);

	if (!board) {
		throw httpError(404, 'Pinterest board not found');
	}

	return board;
}

function readPinterestRequestId(response, payload) {
	return String(
		response.headers.get('x-pinterest-rid')
		|| response.headers.get('x-request-id')
		|| response.headers.get('pinterest-rid')
		|| payload?.request_id
		|| payload?.requestId
		|| '',
	).trim();
}

/**
 * Exact failure dump for logs + UI. Does not rewrite Pinterest's response body.
 */
export function formatPinterestApiFailureReport(diagnostics = {}) {
	const match = diagnostics.tokenBelongsToSameAppId;
	const matchLabel = match === true ? 'yes' : match === false ? 'no' : 'unknown';
	const body = diagnostics.responseBodyRaw != null && String(diagnostics.responseBodyRaw).length > 0
		? String(diagnostics.responseBodyRaw)
		: (diagnostics.responseBody != null
			? JSON.stringify(diagnostics.responseBody, null, 2)
			: '(empty)');

	return [
		`endpoint: ${diagnostics.endpoint || '(unknown)'}`,
		`http_status: ${diagnostics.httpStatus ?? '(unknown)'}`,
		`request_id: ${diagnostics.requestId || '(none)'}`,
		`client_id: ${diagnostics.clientId || '(none)'}`,
		`oauth_app_id: ${diagnostics.oauthAppId || '(none)'}`,
		`token_oauth_app_id: ${diagnostics.tokenAppId || '(none)'}`,
		`token_belongs_to_same_app_id: ${matchLabel}`,
		'response_body:',
		body,
	].join('\n');
}

async function resolvePinterestRequestDiagnosticsContext(context = {}) {
	const credentials = context.credentials || await getPinterestAppCredentials().catch(() => null);
	const oauthAppId = String(credentials?.appId || context.oauthAppId || '').trim();
	const clientId = String(context.clientId || oauthAppId || '').trim();
	const tokenAppId = String(
		context.tokenAppId
		|| context.account?.oauth_app_id
		|| context.account?.oauthAppId
		|| '',
	).trim();
	const tokenBelongsToSameAppId = tokenAppId && oauthAppId
		? tokenAppId === oauthAppId
		: null;

	return {
		credentials,
		clientId,
		oauthAppId,
		tokenAppId: tokenAppId || null,
		tokenBelongsToSameAppId,
	};
}

async function pinterestRequest({
	path,
	method = 'GET',
	accessToken,
	body,
	isForm = false,
	diagnosticsContext = {},
}) {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		Accept: 'application/json',
	};

	if (method !== 'GET') {
		headers['Content-Type'] = isForm ? 'application/x-www-form-urlencoded' : 'application/json';
	}

	const endpoint = `${PINTEREST_API_BASE}${path}`;
	const response = await fetch(endpoint, {
		method,
		headers,
		body: method === 'GET' ? undefined : (isForm ? body : JSON.stringify(body || {})),
	});

	if (!response.ok) {
		const text = await response.text();
		let payload;
		try {
			payload = JSON.parse(text);
		} catch {
			payload = text || response.statusText;
		}

		const ctx = await resolvePinterestRequestDiagnosticsContext(diagnosticsContext);
		const requestId = readPinterestRequestId(response, typeof payload === 'object' ? payload : null);
		const diagnostics = {
			endpoint: `${method} ${endpoint}`,
			httpStatus: response.status,
			responseBody: payload,
			responseBodyRaw: text,
			requestId,
			clientId: ctx.clientId,
			oauthAppId: ctx.oauthAppId,
			tokenAppId: ctx.tokenAppId,
			tokenBelongsToSameAppId: ctx.tokenBelongsToSameAppId,
		};

		logger.error('[pinterest-api] request failed — raw response', diagnostics);

		const report = formatPinterestApiFailureReport(diagnostics);
		const trial = isPinterestTrialAccessError(text) || isPinterestTrialAccessError(payload);
		throw httpError(response.status, report, {
			pinterestStatus: response.status,
			retryAfter: Number.parseInt(response.headers.get('retry-after') || '0', 10) || 0,
			retryable: trial ? false : true,
			errorCode: trial ? 'PINTEREST_TRIAL_ACCESS' : 'PINTEREST_API_ERROR',
			pinterestDiagnostics: diagnostics,
			rawResponseBody: text,
		});
	}

	if (response.status === 204) {
		return {};
	}

	return response.json();
}

async function pinterestTokenRequest(params) {
	const credentials = await assertPinterestOAuthReady();
	const basicToken = Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString('base64');
	const body = new URLSearchParams(params);

	const response = await fetch(`${PINTEREST_API_BASE}/oauth/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basicToken}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body,
	});

	if (!response.ok) {
		const text = await response.text();
		throw httpError(response.status, text || 'Pinterest OAuth token exchange failed');
	}

	return response.json();
}

export async function createPinterestOAuthState({ owner, accountId = '', requestedLabel = '', workspaceId = '', workspaceKey = '' }) {
	const credentials = await assertPinterestOAuthReady();
	const state = randomBytes(24).toString('hex');
	const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
	const redirectUri = credentials.redirectUri;
	const clientId = credentials.appId;
	const scopes = mergeRequiredScopes(credentials.scopes?.length ? credentials.scopes : DEFAULT_SCOPES);

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

	await pocketbaseClient.collection('pinterest_oauth_states').create({
		owner,
		state,
		account_id: accountId,
		requested_label: requestedLabel,
		expires_at: expiresAt,
		used: false,
		workspace_id: resolvedWorkspaceId,
		workspace_key: resolvedWorkspaceKey,
	}).catch(async () => {
		// Older schema without workspace fields.
		await pocketbaseClient.collection('pinterest_oauth_states').create({
			owner,
			state,
			account_id: accountId,
			requested_label: requestedLabel,
			expires_at: expiresAt,
			used: false,
		});
	});

	const query = new URLSearchParams({
		response_type: 'code',
		redirect_uri: redirectUri,
		scope: scopes.join(','),
		client_id: clientId,
		state,
	});

	const authUrl = `${PINTEREST_AUTH_BASE}/?${query.toString()}`;
	logger.info('[pinterest-oauth] authorization URL built', {
		requestedScopes: scopes,
		redirectUri,
		authUrl,
	});

	return {
		state,
		authUrl,
		redirectUri,
		requestedScopes: scopes,
		workspaceId: resolvedWorkspaceId,
		workspaceKey: resolvedWorkspaceKey,
	};
}

export async function exchangeOAuthCodeForTokens({ code, redirectUri }) {
	const credentials = await assertPinterestOAuthReady();
	return pinterestTokenRequest({
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri || credentials.redirectUri,
		continuous_refresh: 'true',
	});
}

export async function refreshPinterestAccessToken({ account }) {
	const hydrated = account?.access_token || account?.refresh_token
		? account
		: await hydratePinterestAccountSecrets(account);

	const refreshStartedAt = hydrated._tokensUpdatedAt || '';
	const before = describePinterestTokenState(hydrated, {
		accessToken: decryptAccountAccessToken(hydrated),
		refreshToken: decryptAccountRefreshToken(hydrated),
	});
	logger.info('[pinterest-token] refreshPinterestAccessToken before', before);

	const refreshToken = decryptAccountRefreshToken(hydrated);
	if (!refreshToken) {
		await markPinterestAccountStatus({ accountId: account.id, status: 'expired', statusError: 'Refresh token missing' });
		throw httpError(401, 'Pinterest refresh token is missing. Please reconnect your account.');
	}

	const payload = await pinterestTokenRequest({
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		continuous_refresh: 'true',
	});

	const nextAccessToken = String(payload.access_token || '').trim();
	if (!nextAccessToken) {
		await markPinterestAccountStatus({ accountId: account.id, status: 'expired', statusError: 'Refresh returned empty access token' });
		throw httpError(401, 'Pinterest access token refresh failed. Please reconnect your account.');
	}

	// If reconnect replaced secrets while this refresh was in flight, keep the newer tokens.
	const latest = await hydratePinterestAccountSecrets({ id: account.id, owner: account.owner });
	const latestUpdatedMs = latest._tokensUpdatedAt ? new Date(latest._tokensUpdatedAt).getTime() : 0;
	const startedMs = refreshStartedAt ? new Date(refreshStartedAt).getTime() : 0;
	if (latestUpdatedMs && startedMs && latestUpdatedMs > startedMs) {
		logger.warn('[pinterest-token] refresh aborted — secrets replaced during refresh (reconnect won)', {
			accountId: account.id,
			refreshStartedAt,
			tokensUpdatedAt: latest._tokensUpdatedAt,
			tokenSource: latest._tokenSource || null,
		});
		return latest;
	}

	const expiresAt = payload.expires_in
		? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
		: account.token_expires_at || '';
	const scope = String(payload.scope || account.scope || '').trim();

	const updated = await pocketbaseClient.collection('pinterest_accounts').update(account.id, {
		token_expires_at: expiresAt,
		connected: true,
		status: 'connected',
		status_error: '',
		scope: scope || account.scope || '',
		access_token: '',
		refresh_token: '',
		oauth_app_id: String((await getPinterestAppCredentials().catch(() => null))?.appId || account.oauth_app_id || '').trim(),
	}).catch(async () => pocketbaseClient.collection('pinterest_accounts').update(account.id, {
		token_expires_at: expiresAt,
		connected: true,
		status: 'connected',
		status_error: '',
		scope: scope || account.scope || '',
		access_token: '',
		refresh_token: '',
	}));

	// Always replace access ciphertext. Keep prior refresh only when Pinterest
	// does not rotate it in this response.
	await upsertPinterestAccountSecrets({
		owner: account.owner,
		accountId: account.id,
		accessToken: nextAccessToken,
		refreshToken: payload.refresh_token || '',
		preserveRefreshToken: true,
		expiresAt,
		replace: false,
	});

	const refreshed = await hydratePinterestAccountSecrets(updated);
	logger.info('[pinterest-token] refreshPinterestAccessToken after', describePinterestTokenState(refreshed, {
		accessToken: decryptAccountAccessToken(refreshed),
		refreshToken: decryptAccountRefreshToken(refreshed),
	}));
	return refreshed;
}

/**
 * Ensure a usable access token for publishing.
 * - Reloads secrets from DB (never trusts a stale in-memory account)
 * - Refreshes only when missing, status expired, forced, or expiry is imminent
 * - Does NOT refresh solely because expiry is unknown (that burned reconnect tokens)
 */
export async function ensureValidPinterestAccessToken({ account, forceRefresh = false }) {
	if (!account?.id) {
		throw httpError(401, 'Pinterest account is not connected');
	}

	// Always re-read account + secrets so publish never uses a pre-reconnect object.
	const freshRow = await pocketbaseClient.collection('pinterest_accounts').getOne(account.id).catch(() => account);
	const hydrated = await hydratePinterestAccountSecrets(freshRow);

	let accessToken = '';
	let refreshToken = '';
	try {
		accessToken = decryptAccountAccessToken(hydrated);
		refreshToken = decryptAccountRefreshToken(hydrated);
	} catch (error) {
		logger.error('[pinterest-token] decrypt failed during ensureValid', {
			accountId: hydrated.id,
			message: error?.message || 'decrypt failed',
			tokenSource: hydrated._tokenSource || null,
		});
		throw httpError(401, 'Pinterest token could not be decrypted. Please reconnect your account.');
	}

	const expiresAtMs = hydrated.token_expires_at ? new Date(hydrated.token_expires_at).getTime() : 0;
	const expiresSoon = Boolean(expiresAtMs) && expiresAtMs <= Date.now() + (5 * 60 * 1000);
	const expiryUnknown = !expiresAtMs;
	const statusExpired = String(hydrated.status || '').toLowerCase() === 'expired';
	// Never refresh only because expiry is unknown — that overwrote freshly reconnected
	// access tokens and left publish using a failed/stale refresh result.
	const shouldRefresh = Boolean(
		forceRefresh
		|| !accessToken
		|| statusExpired
		|| (Boolean(refreshToken) && expiresSoon),
	);

	logger.info('[pinterest-token] ensureValidPinterestAccessToken before', {
		...describePinterestTokenState(hydrated, { accessToken, refreshToken }),
		forceRefresh: Boolean(forceRefresh),
		shouldRefresh,
		expiresSoon,
		expiryUnknown,
		statusExpired,
	});

	if (shouldRefresh) {
		if (!refreshToken) {
			await markPinterestAccountStatus({ accountId: hydrated.id, status: 'expired', statusError: 'Access token missing and no refresh token' });
			throw httpError(401, 'Pinterest access token is missing. Please reconnect your account.');
		}

		let refreshed;
		try {
			refreshed = await refreshPinterestAccessToken({ account: hydrated });
		} catch (error) {
			await markPinterestAccountStatus({ accountId: hydrated.id, status: 'expired', statusError: error?.message || 'Token refresh failed' });
			throw error;
		}

		const nextAccess = decryptAccountAccessToken(refreshed);
		if (!nextAccess) {
			await markPinterestAccountStatus({ accountId: hydrated.id, status: 'expired', statusError: 'Refresh produced empty access token' });
			throw httpError(401, 'Pinterest access token refresh failed. Please reconnect your account.');
		}

		logger.info('[pinterest-token] ensureValidPinterestAccessToken after', {
			...describePinterestTokenState(refreshed, {
				accessToken: nextAccess,
				refreshToken: decryptAccountRefreshToken(refreshed),
			}),
			usedRefresh: true,
		});

		return {
			account: refreshed,
			accessToken: nextAccess,
			usedRefresh: true,
		};
	}

	logger.info('[pinterest-token] ensureValidPinterestAccessToken after', {
		...describePinterestTokenState(hydrated, { accessToken, refreshToken }),
		usedRefresh: false,
	});

	return { account: hydrated, accessToken, usedRefresh: false };
}

export async function fetchPinterestPinAnalytics({ accessToken, pinId, startDate, endDate }) {
	const query = new URLSearchParams({
		start_date: startDate,
		end_date: endDate,
		metric_types: 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK',
	});

	return pinterestRequest({
		path: `/pins/${encodeURIComponent(pinId)}/analytics?${query.toString()}`,
		accessToken,
	});
}

export async function fetchPinterestProfile({ accessToken }) {
	return pinterestRequest({ path: '/user_account', accessToken });
}

export async function fetchPinterestBoards({ accessToken }) {
	let bookmark = '';
	const boards = [];

	do {
		const query = new URLSearchParams({ page_size: '100' });
		if (bookmark) {
			query.set('bookmark', bookmark);
		}

		const payload = await pinterestRequest({
			path: `/boards?${query.toString()}`,
			accessToken,
		});

		boards.push(...(payload.items || []));
		bookmark = payload.bookmark || '';
	} while (bookmark);

	return boards;
}

function extractBoardThumbnail(board) {
	if (board.media?.image_cover_url) {
		return board.media.image_cover_url;
	}
	if (board.image_cover_url) {
		return board.image_cover_url;
	}
	return '';
}

export async function syncPinterestBoardsForOwner({ owner, account }) {
	let accessToken = '';
	let boards = [];

	try {
		({ accessToken } = await ensureValidPinterestAccessToken({ account }));
		boards = await fetchPinterestBoards({ accessToken });
	} catch (error) {
		const normalized = normalizePinterestError(error);
		if (normalized.status === 401) {
			await markPinterestAccountStatus({ accountId: account.id, status: 'expired', statusError: normalized.message });
		} else {
			await markPinterestAccountStatus({ accountId: account.id, status: 'error', statusError: normalized.message });
		}
		throw normalized;
	}

	const existingBoards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: account.id }),
	});

	const existingByBoardId = new Map(existingBoards.map((item) => [item.board_id, item]));
	const incomingIds = new Set();

	for (const board of boards) {
		const boardId = String(board.id || '').trim();
		if (!boardId) {
			continue;
		}
		incomingIds.add(boardId);

		const payload = {
			owner,
			account: account.id,
			account_label: account.label || account.account_name || account.username || '',
			account_username: account.username || '',
			board_id: boardId,
			name: String(board.name || '').trim() || 'Untitled board',
			thumbnail_url: extractBoardThumbnail(board),
			description: String(board.description || '').trim(),
			privacy: String(board.privacy || '').trim(),
		};

		const existing = existingByBoardId.get(boardId);
		if (existing) {
			await pocketbaseClient.collection('pinterest_boards').update(existing.id, payload);
		} else {
			await pocketbaseClient.collection('pinterest_boards').create(payload);
		}
	}

	for (const existing of existingBoards) {
		if (!incomingIds.has(existing.board_id)) {
			await pocketbaseClient.collection('pinterest_boards').delete(existing.id).catch(() => {});
		}
	}

	await pocketbaseClient.collection('pinterest_accounts').update(account.id, {
		last_sync_at: new Date().toISOString(),
		status: 'connected',
		status_error: '',
	});

	const refreshedBoards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		sort: 'name',
		filter: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: account.id }),
	});

	// Ensure every account has exactly one default board when boards exist.
	const hasDefaultBoard = refreshedBoards.some((board) => board.is_default);
	if (!hasDefaultBoard && refreshedBoards.length > 0) {
		await pocketbaseClient.collection('pinterest_boards').update(refreshedBoards[0].id, {
			is_default: true,
		}).catch(() => null);
		refreshedBoards[0].is_default = true;
	}

	refreshedBoards.sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)));

	return refreshedBoards.map(mapBoard);
}

export async function createPinterestPin({
	accessToken,
	boardId,
	title,
	description,
	imageUrl,
	link,
	account = null,
	credentials = null,
}) {
	const destination = String(link || '').trim();
	if (!destination) {
		const error = new Error('Pinterest pin destination URL (link) is required');
		error.status = 422;
		throw error;
	}

	const body = {
		board_id: boardId,
		title,
		description,
		link: destination,
		media_source: {
			source_type: 'image_url',
			url: imageUrl,
		},
	};

	return pinterestRequest({
		path: '/pins',
		method: 'POST',
		accessToken,
		body,
		diagnosticsContext: { account, credentials },
	});
}

export function getPinterestPinPublicUrl(pinterestPinId) {
	if (!pinterestPinId) {
		return '';
	}
	return `https://www.pinterest.com/pin/${encodeURIComponent(pinterestPinId)}/`;
}

export const PINTEREST_TRIAL_ACCESS_UI_MESSAGE = 'Your Pinterest developer app is still in Trial Access. Production publishing is not yet allowed.';

/** Pass-through — never rewrite Pinterest API error text. */
export function formatPinterestPublishError(message) {
	return message == null ? '' : String(message);
}

/**
 * Preserve the exact Pinterest failure report. Only annotate retryability.
 * Does not rewrite message / response body.
 */
export function normalizePinterestError(error) {
	if (!error) {
		return httpError(500, 'Pinterest request failed', { retryable: true });
	}

	if (error.pinterestDiagnostics) {
		if (error.retryable == null) {
			error.retryable = !isPinterestTrialAccessError(error);
		}
		if (!error.errorCode && isPinterestTrialAccessError(error)) {
			error.errorCode = 'PINTEREST_TRIAL_ACCESS';
		}
		return error;
	}

	if (isPinterestTrialAccessError(error)) {
		if (error.retryable == null) {
			error.retryable = false;
		}
		if (!error.errorCode) {
			error.errorCode = 'PINTEREST_TRIAL_ACCESS';
		}
		return error.status ? error : httpError(403, error.message, {
			retryable: false,
			errorCode: 'PINTEREST_TRIAL_ACCESS',
			rawResponseBody: error.message,
		});
	}

	if (error?.status === 429 || error?.pinterestStatus === 429) {
		if (error.retryable == null) {
			error.retryable = true;
		}
		return error;
	}

	if (error?.status) {
		if (error.retryable == null) {
			error.retryable = true;
		}
		return error;
	}
	return httpError(500, error?.message || 'Pinterest request failed', { retryable: true });
}

export async function markPinterestAccountStatus({ accountId, status, statusError = '' }) {
	if (!accountId) {
		return;
	}

	await pocketbaseClient.collection('pinterest_accounts').update(accountId, {
		status,
		connected: status === 'connected',
		status_error: statusError,
	}).catch(() => {});
}
