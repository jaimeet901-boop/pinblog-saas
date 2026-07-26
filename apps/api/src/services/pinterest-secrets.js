import { createHash } from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptPinterestSecret, encryptPinterestSecret } from '../utils/secretCrypto.js';
import logger from '../utils/logger.js';

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function relationId(value) {
	if (!value) return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') {
		return String(value.id || value.accountId || value.value || '').trim();
	}
	return String(value).trim();
}

function tokenFingerprint(plainToken) {
	if (!plainToken) return null;
	try {
		return createHash('sha256').update(String(plainToken)).digest('hex').slice(0, 12);
	} catch {
		return 'hash_error';
	}
}

export async function getPinterestAccountSecretRecord(accountId) {
	if (!accountId) {
		return null;
	}

	try {
		return await pocketbaseClient.collection('pinterest_account_secrets').getFirstListItem(
			pocketbaseClient.filter('account = {:accountId}', { accountId }),
			{ sort: '-updated' },
		);
	} catch (error) {
		// Missing collection / missing row / locked rules must never break account listing.
		return null;
	}
}

async function listPinterestAccountSecretRecords(accountId) {
	if (!accountId) return [];
	try {
		return await pocketbaseClient.collection('pinterest_account_secrets').getFullList({
			filter: pocketbaseClient.filter('account = {:accountId}', { accountId }),
			sort: '-updated',
		});
	} catch {
		return [];
	}
}

async function getPinterestTokenRecord(accountId) {
	if (!accountId) return null;
	try {
		return await pocketbaseClient.collection('pinterest_tokens').getFirstListItem(
			pocketbaseClient.filter('account = {:accountId}', { accountId }),
			{ sort: '-updated' },
		);
	} catch {
		return null;
	}
}

async function listPinterestTokenRecords(accountId) {
	if (!accountId) return [];
	try {
		return await pocketbaseClient.collection('pinterest_tokens').getFullList({
			filter: pocketbaseClient.filter('account = {:accountId}', { accountId }),
			sort: '-updated',
		});
	} catch {
		return [];
	}
}

function hasCiphertext(value) {
	return typeof value === 'string' && value.trim().length > 0;
}

function updatedAtMs(value) {
	const ms = value ? new Date(value).getTime() : 0;
	return Number.isFinite(ms) ? ms : 0;
}

/**
 * Load encrypted tokens for an account.
 * Prefer the newest ciphertext source (secrets vs pinterest_tokens vs legacy).
 */
export async function hydratePinterestAccountSecrets(account) {
	if (!account?.id) {
		return account;
	}

	const secret = await getPinterestAccountSecretRecord(account.id);
	const token = await getPinterestTokenRecord(account.id);

	const secretCandidate = secret && (hasCiphertext(secret.access_token) || hasCiphertext(secret.refresh_token))
		? {
			...account,
			access_token: secret.access_token || '',
			refresh_token: secret.refresh_token || '',
			_secretRecordId: secret.id,
			_tokenSource: 'pinterest_account_secrets',
			_tokensUpdatedAt: secret.updated || secret.created || '',
			token_expires_at: account.token_expires_at || '',
		}
		: null;

	const tokenCandidate = token && (hasCiphertext(token.access_ciphertext) || hasCiphertext(token.refresh_ciphertext))
		? {
			...account,
			access_token: token.access_ciphertext || '',
			refresh_token: token.refresh_ciphertext || '',
			_tokenRecordId: token.id,
			_tokenSource: 'pinterest_tokens',
			_tokensUpdatedAt: token.rotated_at || token.updated || token.created || '',
			token_expires_at: account.token_expires_at || token.expires_at || '',
		}
		: null;

	if (secretCandidate && tokenCandidate) {
		const secretMs = updatedAtMs(secretCandidate._tokensUpdatedAt);
		const tokenMs = updatedAtMs(tokenCandidate._tokensUpdatedAt);
		// Prefer secrets when timestamps tie — that is the reconnect write target.
		return tokenMs > secretMs ? tokenCandidate : secretCandidate;
	}
	if (secretCandidate) return secretCandidate;
	if (tokenCandidate) return tokenCandidate;

	// Legacy fallback while migration is rolling out.
	return {
		...account,
		access_token: account.access_token || '',
		refresh_token: account.refresh_token || '',
		_tokenSource: 'pinterest_accounts_legacy',
		_tokensUpdatedAt: account.updated || '',
	};
}

async function upsertPinterestTokensRow({
	owner,
	accountId,
	accessCiphertext,
	refreshCiphertext,
	expiresAt,
	replace = false,
}) {
	const existing = await getPinterestTokenRecord(accountId);
	const payload = {
		owner,
		account: accountId,
		access_ciphertext: replace
			? (accessCiphertext || '')
			: (accessCiphertext || existing?.access_ciphertext || ''),
		refresh_ciphertext: replace
			? (refreshCiphertext || '')
			: (refreshCiphertext || existing?.refresh_ciphertext || ''),
		kek_version: 'v1',
		rotated_at: new Date().toISOString(),
		expires_at: expiresAt || (replace ? '' : (existing?.expires_at || '')),
	};

	if (!payload.access_ciphertext) return null;

	if (existing) {
		return pocketbaseClient.collection('pinterest_tokens').update(existing.id, payload).catch(() => null);
	}
	return pocketbaseClient.collection('pinterest_tokens').create(payload).catch(() => null);
}

export async function upsertPinterestAccountSecrets({
	owner,
	accountId,
	accessToken,
	refreshToken,
	preserveRefreshToken = true,
	expiresAt = '',
	replace = false,
}) {
	if (!owner || !accountId) {
		throw httpError(500, 'owner and accountId are required to store Pinterest secrets');
	}

	const existing = await getPinterestAccountSecretRecord(accountId);
	const nextAccess = accessToken
		? encryptPinterestSecret(accessToken)
		: (replace ? '' : (existing?.access_token || ''));
	const nextRefresh = refreshToken
		? encryptPinterestSecret(refreshToken)
		: (preserveRefreshToken && !replace ? (existing?.refresh_token || '') : '');

	if (!nextAccess) {
		throw httpError(500, 'Refusing to store Pinterest secrets without an access token');
	}

	const payload = {
		owner,
		account: accountId,
		access_token: nextAccess,
		refresh_token: nextRefresh,
	};

	if (existing) {
		await pocketbaseClient.collection('pinterest_account_secrets').update(existing.id, payload);
	} else {
		await pocketbaseClient.collection('pinterest_account_secrets').create(payload);
	}

	await upsertPinterestTokensRow({
		owner,
		accountId,
		accessCiphertext: nextAccess,
		refreshCiphertext: nextRefresh,
		expiresAt,
		replace: true,
	});

	// Keep legacy columns empty so client-readable account rows never expose tokens.
	await pocketbaseClient.collection('pinterest_accounts').update(accountId, {
		access_token: '',
		refresh_token: '',
		...(expiresAt ? { token_expires_at: expiresAt } : {}),
	}).catch(() => null);
}

/**
 * Wipe previous ciphertext then write the new OAuth tokens.
 * Guarantees reconnect never leaves a readable stale access token behind.
 */
export async function replacePinterestAccountSecrets({
	owner,
	accountId,
	accessToken,
	refreshToken,
	expiresAt = '',
}) {
	await deletePinterestAccountSecrets(accountId);
	await upsertPinterestAccountSecrets({
		owner,
		accountId,
		accessToken,
		refreshToken,
		preserveRefreshToken: false,
		expiresAt,
		replace: true,
	});

	const verified = await hydratePinterestAccountSecrets({ id: accountId, owner, token_expires_at: expiresAt });
	const access = decryptAccountAccessToken(verified);
	const refresh = decryptAccountRefreshToken(verified);
	if (!access) {
		throw httpError(500, 'Pinterest access token did not persist after reconnect');
	}
	if (!refresh) {
		throw httpError(500, 'Pinterest refresh token did not persist after reconnect');
	}

	logger.info('[pinterest-token] replacePinterestAccountSecrets verified', {
		accountId,
		tokenSource: verified._tokenSource || null,
		tokensUpdatedAt: verified._tokensUpdatedAt || null,
		tokenExpiresAt: expiresAt || null,
		hasAccessToken: true,
		hasRefreshToken: true,
		accessFingerprint: tokenFingerprint(access),
		refreshFingerprint: tokenFingerprint(refresh),
	});

	return verified;
}

export function decryptAccountAccessToken(account) {
	return decryptPinterestSecret(account?.access_token || '');
}

export function decryptAccountRefreshToken(account) {
	return decryptPinterestSecret(account?.refresh_token || '');
}

export async function deletePinterestAccountSecrets(accountId) {
	if (!accountId) return;

	const secrets = await listPinterestAccountSecretRecords(accountId);
	for (const secret of secrets) {
		if (secret?.id) {
			await pocketbaseClient.collection('pinterest_account_secrets').delete(secret.id).catch(() => null);
		}
	}

	const tokens = await listPinterestTokenRecords(accountId);
	for (const token of tokens) {
		if (token?.id) {
			await pocketbaseClient.collection('pinterest_tokens').delete(token.id).catch(() => null);
		}
	}
}

/** Safe diagnostics for logs — never includes raw tokens. */
export function describePinterestTokenState(account, {
	accessToken = null,
	refreshToken = null,
} = {}) {
	const expiresAt = account?.token_expires_at || '';
	const expiresMs = expiresAt ? new Date(expiresAt).getTime() : 0;
	const hasAccess = accessToken != null
		? Boolean(accessToken)
		: hasCiphertext(account?.access_token);
	const hasRefresh = refreshToken != null
		? Boolean(refreshToken)
		: hasCiphertext(account?.refresh_token);

	return {
		accountId: account?.id || null,
		status: account?.status || null,
		connected: Boolean(account?.connected),
		tokenSource: account?._tokenSource || null,
		tokensUpdatedAt: account?._tokensUpdatedAt || null,
		tokenExpiresAt: expiresAt || null,
		tokenExpiresInSec: expiresMs ? Math.round((expiresMs - Date.now()) / 1000) : null,
		hasAccessToken: hasAccess,
		hasRefreshToken: hasRefresh,
		accessFingerprint: accessToken != null ? tokenFingerprint(accessToken) : null,
		refreshFingerprint: refreshToken != null ? tokenFingerprint(refreshToken) : null,
		secretRecordId: account?._secretRecordId || null,
		tokenRecordId: account?._tokenRecordId || null,
	};
}

export { relationId, tokenFingerprint };
