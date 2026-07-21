import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptSecret, encryptSecret } from '../utils/secretCrypto.js';

const PINTEREST_API_BASE = 'https://api.pinterest.com/v5';
const PINTEREST_AUTH_BASE = 'https://www.pinterest.com/oauth';
const DEFAULT_SCOPES = ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'];
const STATE_TTL_MS = 10 * 60 * 1000;

function httpError(status, message, extras = {}) {
	const error = new Error(message);
	error.status = status;
	Object.assign(error, extras);
	return error;
}

function getRequiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw httpError(500, `${name} is not configured`);
	}
	return value;
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

export function getWebAppBaseUrl() {
	const fromEnv = process.env.WEB_APP_URL || process.env.APP_WEB_URL || process.env.CORS_ORIGIN;
	if (!fromEnv) {
		return 'http://localhost:3000';
	}
	return fromEnv.split(',')[0].trim().replace(/\/$/, '');
}

export function getPinterestRedirectUri() {
	return process.env.PINTEREST_REDIRECT_URI || `${process.env.API_PUBLIC_URL || 'http://localhost:3001'}/pinterest/oauth/callback`;
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
		scope: record.scope || '',
		status: record.status || (record.connected ? 'connected' : 'error'),
		statusError: record.status_error || '',
		isDefault: Boolean(record.is_default),
		connectedAt: normalizeDate(record.connected_at || record.created),
		tokenExpiresAt: normalizeDate(record.token_expires_at),
		lastSyncAt: normalizeDate(record.last_sync_at),
		createdAt: normalizeDate(record.created),
		updatedAt: normalizeDate(record.updated),
	};
}

export async function getOwnedPinterestAccounts(owner) {
	return pocketbaseClient.collection('pinterest_accounts').getFullList({
		sort: '-is_default,-created',
		filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
	});
}

export async function getOwnedPinterestAccount(owner) {
	const accounts = await getOwnedPinterestAccounts(owner);
	const preferredDefault = accounts.find((account) => account.is_default && account.connected && account.status === 'connected');
	if (preferredDefault) {
		return preferredDefault;
	}
	const connected = accounts.find((account) => account.connected && account.status === 'connected');
	return connected || accounts.find((account) => account.is_default) || accounts[0] || null;
}

export async function getDefaultPinterestBoard({ owner, accountId }) {
	if (!accountId) {
		return null;
	}

	const boards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		sort: '-is_default,name',
		filter: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: accountId }),
	});

	return boards.find((board) => board.is_default) || boards[0] || null;
}

export async function setDefaultPinterestAccount({ owner, accountId }) {
	const account = await getOwnedPinterestAccountById({ owner, accountId });
	if (!account) {
		throw httpError(404, 'Pinterest account not found');
	}

	const accounts = await getOwnedPinterestAccounts(owner);
	await Promise.all(accounts.map((item) => (
		pocketbaseClient.collection('pinterest_accounts').update(item.id, {
			is_default: item.id === accountId,
		}).catch(() => null)
	)));

	return pocketbaseClient.collection('pinterest_accounts').getOne(accountId);
}

export async function setDefaultPinterestBoard({ owner, accountId, boardRecordId }) {
	const account = await getOwnedPinterestAccountById({ owner, accountId });
	if (!account) {
		throw httpError(404, 'Pinterest account not found');
	}

	const board = await pocketbaseClient.collection('pinterest_boards').getOne(boardRecordId).catch(() => null);
	if (!board || board.owner !== owner || board.account !== accountId) {
		throw httpError(404, 'Pinterest board not found for this account');
	}

	const boards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: accountId }),
	});

	await Promise.all(boards.map((item) => (
		pocketbaseClient.collection('pinterest_boards').update(item.id, {
			is_default: item.id === boardRecordId,
		}).catch(() => null)
	)));

	return pocketbaseClient.collection('pinterest_boards').getOne(boardRecordId);
}

export async function getOwnedPinterestAccountById({ owner, accountId }) {
	if (!accountId) {
		return null;
	}

	const record = await pocketbaseClient.collection('pinterest_accounts').getOne(accountId).catch(() => null);
	if (!record) {
		return null;
	}
	if (record.owner !== owner) {
		return null;
	}
	return record;
}

export async function getOwnedPinterestAccountByPinterestUserId({ owner, pinterestUserId }) {
	if (!pinterestUserId) {
		return null;
	}

	return pocketbaseClient.collection('pinterest_accounts').getFirstListItem(
		pocketbaseClient.filter('owner = {:owner} && pinterest_user_id = {:pinterestUserId}', { owner, pinterestUserId }),
	).catch(() => null);
}

export async function getOwnedPinterestBoard({ owner, boardId, accountId = '' }) {
	const board = await pocketbaseClient.collection('pinterest_boards').getFirstListItem(
		accountId
			? pocketbaseClient.filter('owner = {:owner} && board_id = {:boardId} && account = {:accountId}', { owner, boardId, accountId })
			: pocketbaseClient.filter('owner = {:owner} && board_id = {:boardId}', { owner, boardId }),
	).catch(() => null);

	if (!board) {
		throw httpError(404, 'Pinterest board not found');
	}

	return board;
}

async function pinterestRequest({ path, method = 'GET', accessToken, body, isForm = false }) {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		Accept: 'application/json',
	};

	if (method !== 'GET') {
		headers['Content-Type'] = isForm ? 'application/x-www-form-urlencoded' : 'application/json';
	}

	const response = await fetch(`${PINTEREST_API_BASE}${path}`, {
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
			payload = { message: text || response.statusText };
		}

		const message = payload?.message || payload?.error || response.statusText || 'Pinterest API request failed';
		throw httpError(response.status, message, {
			pinterestStatus: response.status,
			retryAfter: Number.parseInt(response.headers.get('retry-after') || '0', 10) || 0,
		});
	}

	if (response.status === 204) {
		return {};
	}

	return response.json();
}

async function pinterestTokenRequest(params) {
	const clientId = getRequiredEnv('PINTEREST_CLIENT_ID');
	const clientSecret = getRequiredEnv('PINTEREST_CLIENT_SECRET');
	const basicToken = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
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

export async function createPinterestOAuthState({ owner, accountId = '', requestedLabel = '' }) {
	const state = randomBytes(24).toString('hex');
	const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
	const redirectUri = getPinterestRedirectUri();
	const clientId = getRequiredEnv('PINTEREST_CLIENT_ID');
	const scopes = (process.env.PINTEREST_SCOPES || DEFAULT_SCOPES.join(',')).split(',').map((item) => item.trim()).filter(Boolean);

	await pocketbaseClient.collection('pinterest_oauth_states').create({
		owner,
		state,
		account_id: accountId,
		requested_label: requestedLabel,
		expires_at: expiresAt,
		used: false,
	});

	const query = new URLSearchParams({
		response_type: 'code',
		redirect_uri: redirectUri,
		scope: scopes.join(','),
		client_id: clientId,
		state,
	});

	return {
		state,
		authUrl: `${PINTEREST_AUTH_BASE}/?${query.toString()}`,
	};
}

export async function exchangeOAuthCodeForTokens({ code, redirectUri }) {
	return pinterestTokenRequest({
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
	});
}

export async function refreshPinterestAccessToken({ account }) {
	const refreshToken = decryptSecret(account.refresh_token || '');
	if (!refreshToken) {
		await markPinterestAccountStatus({ accountId: account.id, status: 'expired', statusError: 'Refresh token missing' });
		throw httpError(401, 'Pinterest refresh token is missing. Please reconnect your account.');
	}

	const payload = await pinterestTokenRequest({
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
	});

	const expiresAt = payload.expires_in
		? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
		: account.token_expires_at || '';

	const updated = await pocketbaseClient.collection('pinterest_accounts').update(account.id, {
		access_token: encryptSecret(payload.access_token || ''),
		refresh_token: payload.refresh_token ? encryptSecret(payload.refresh_token) : account.refresh_token,
		token_expires_at: expiresAt,
		connected: true,
		status: 'connected',
		status_error: '',
	});

	return updated;
}

export async function ensureValidPinterestAccessToken({ account }) {
	if (!account) {
		throw httpError(401, 'Pinterest account is not connected');
	}

	const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
	const withinOneMinute = expiresAt > 0 && expiresAt <= Date.now() + 60 * 1000;

	if (withinOneMinute) {
		let refreshed;
		try {
			refreshed = await refreshPinterestAccessToken({ account });
		} catch (error) {
			await markPinterestAccountStatus({ accountId: account.id, status: 'expired', statusError: error?.message || 'Token refresh failed' });
			throw error;
		}
		return {
			account: refreshed,
			accessToken: decryptSecret(refreshed.access_token || ''),
		};
	}

	const accessToken = decryptSecret(account.access_token || '');
	if (!accessToken) {
		await markPinterestAccountStatus({ accountId: account.id, status: 'expired', statusError: 'Access token missing' });
		throw httpError(401, 'Pinterest access token is missing. Please reconnect your account.');
	}

	return { account, accessToken };
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
		sort: '-is_default,name',
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

	return refreshedBoards.map(mapBoard);
}

export async function createPinterestPin({ accessToken, boardId, title, description, imageUrl, link }) {
	const body = {
		board_id: boardId,
		title,
		description,
		media_source: {
			source_type: 'image_url',
			url: imageUrl,
		},
	};

	if (link) {
		body.link = link;
	}

	return pinterestRequest({
		path: '/pins',
		method: 'POST',
		accessToken,
		body,
	});
}

export function getPinterestPinPublicUrl(pinterestPinId) {
	if (!pinterestPinId) {
		return '';
	}
	return `https://www.pinterest.com/pin/${encodeURIComponent(pinterestPinId)}/`;
}

export function normalizePinterestError(error) {
	if (error?.status === 401 || error?.pinterestStatus === 401) {
		return httpError(401, 'Pinterest token expired. Please reconnect your account.');
	}
	if (error?.status === 429 || error?.pinterestStatus === 429) {
		return httpError(429, 'Pinterest API rate limit reached. The job will retry automatically.', {
			retryAfter: error?.retryAfter || 0,
		});
	}
	if (error?.status) {
		return error;
	}
	return httpError(500, error?.message || 'Pinterest request failed');
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
