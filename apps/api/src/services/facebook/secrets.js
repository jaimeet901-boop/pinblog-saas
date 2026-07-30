import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { decryptFacebookSecret, encryptFacebookSecret } from '../../utils/secretCrypto.js';
import logger from '../../utils/logger.js';

function relationId(value) {
	if (!value) return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') {
		return String(value.id || value.accountId || value.value || '').trim();
	}
	return String(value).trim();
}

export async function getFacebookAccountSecretRecord(accountId) {
	if (!accountId) return null;
	try {
		return await pocketbaseClient.collection('facebook_account_secrets').getFirstListItem(
			pocketbaseClient.filter('account = {:accountId}', { accountId }),
			{ sort: '-updated', requestKey: null },
		);
	} catch {
		return null;
	}
}

/**
 * Hydrate account row with encrypted token fields (never decrypt here for list APIs).
 */
export async function hydrateFacebookAccountSecrets(account) {
	if (!account?.id) return account;
	const secret = await getFacebookAccountSecretRecord(account.id);
	if (!secret) {
		return {
			...account,
			access_token: '',
			refresh_token: '',
			page_tokens: {},
			_tokenSource: 'none',
		};
	}
	return {
		...account,
		access_token: secret.access_token || '',
		refresh_token: secret.refresh_token || '',
		page_tokens: secret.page_tokens || {},
		_secretRecordId: secret.id,
		_tokenSource: 'facebook_account_secrets',
		_tokensUpdatedAt: secret.updated || secret.created || '',
	};
}

export function decryptAccountAccessToken(account) {
	return decryptFacebookSecret(account?.access_token || '');
}

export function decryptAccountRefreshToken(account) {
	return decryptFacebookSecret(account?.refresh_token || '');
}

export function decryptPageTokenMap(account) {
	const raw = account?.page_tokens;
	if (!raw || typeof raw !== 'object') return {};
	const out = {};
	for (const [pageId, cipher] of Object.entries(raw)) {
		try {
			const plain = decryptFacebookSecret(String(cipher || ''));
			if (plain) out[String(pageId)] = plain;
		} catch {
			// skip undecryptable page token
		}
	}
	return out;
}

/**
 * Upsert encrypted user tokens + optional page token map.
 * Plain tokens never persist on facebook_accounts.
 */
export async function replaceFacebookAccountSecrets({
	owner,
	workspaceId = '',
	accountId,
	accessToken,
	refreshToken = '',
	pageTokens = null,
}) {
	const id = relationId(accountId);
	if (!id) {
		const error = new Error('accountId is required');
		error.status = 422;
		throw error;
	}

	const accessCipher = accessToken ? encryptFacebookSecret(String(accessToken)) : '';
	const refreshCipher = refreshToken ? encryptFacebookSecret(String(refreshToken)) : '';

	let pageTokenCipher = {};
	if (pageTokens && typeof pageTokens === 'object') {
		for (const [pageId, token] of Object.entries(pageTokens)) {
			const plain = String(token || '').trim();
			if (!pageId || !plain) continue;
			pageTokenCipher[String(pageId)] = encryptFacebookSecret(plain);
		}
	}

	const existing = await getFacebookAccountSecretRecord(id);
	const payload = {
		owner,
		account: id,
		access_token: accessCipher || (existing?.access_token || ''),
		refresh_token: refreshCipher || (existing?.refresh_token || ''),
		page_tokens: Object.keys(pageTokenCipher).length
			? pageTokenCipher
			: (existing?.page_tokens || {}),
	};
	if (workspaceId) payload.workspace = workspaceId;

	if (!payload.access_token) {
		const error = new Error('Facebook access token is required');
		error.status = 422;
		throw error;
	}

	const saved = existing
		? await pocketbaseClient.collection('facebook_account_secrets').update(existing.id, payload)
		: await pocketbaseClient.collection('facebook_account_secrets').create(payload);

	logger.info('[facebook-secrets] replaced account secrets', {
		accountId: id,
		hasAccess: Boolean(payload.access_token),
		hasRefresh: Boolean(payload.refresh_token),
		pageTokenCount: Object.keys(payload.page_tokens || {}).length,
	});

	return saved;
}

export async function deleteFacebookAccountSecrets(accountId) {
	const id = relationId(accountId);
	if (!id) return;
	const existing = await getFacebookAccountSecretRecord(id);
	if (existing) {
		await pocketbaseClient.collection('facebook_account_secrets').delete(existing.id).catch(() => null);
	}
}
