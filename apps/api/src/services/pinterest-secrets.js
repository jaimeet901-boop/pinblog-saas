import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptPinterestSecret, encryptPinterestSecret } from '../utils/secretCrypto.js';

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

export async function getPinterestAccountSecretRecord(accountId) {
	if (!accountId) {
		return null;
	}

	try {
		return await pocketbaseClient.collection('pinterest_account_secrets').getFirstListItem(
			pocketbaseClient.filter('account = {:accountId}', { accountId }),
		);
	} catch (error) {
		// Missing collection / missing row / locked rules must never break account listing.
		return null;
	}
}

export async function hydratePinterestAccountSecrets(account) {
	if (!account?.id) {
		return account;
	}

	const secret = await getPinterestAccountSecretRecord(account.id);
	if (!secret) {
		// Legacy fallback while migration is rolling out.
		return {
			...account,
			access_token: account.access_token || '',
			refresh_token: account.refresh_token || '',
		};
	}

	return {
		...account,
		access_token: secret.access_token || '',
		refresh_token: secret.refresh_token || '',
		_secretRecordId: secret.id,
	};
}

export async function upsertPinterestAccountSecrets({
	owner,
	accountId,
	accessToken,
	refreshToken,
	preserveRefreshToken = true,
}) {
	if (!owner || !accountId) {
		throw httpError(500, 'owner and accountId are required to store Pinterest secrets');
	}

	const existing = await getPinterestAccountSecretRecord(accountId);
	const nextAccess = accessToken ? encryptPinterestSecret(accessToken) : (existing?.access_token || '');
	const nextRefresh = refreshToken
		? encryptPinterestSecret(refreshToken)
		: (preserveRefreshToken ? (existing?.refresh_token || '') : '');

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

	// Keep legacy columns empty so client-readable account rows never expose tokens.
	await pocketbaseClient.collection('pinterest_accounts').update(accountId, {
		access_token: '',
		refresh_token: '',
	}).catch(() => null);
}

export function decryptAccountAccessToken(account) {
	return decryptPinterestSecret(account?.access_token || '');
}

export function decryptAccountRefreshToken(account) {
	return decryptPinterestSecret(account?.refresh_token || '');
}
