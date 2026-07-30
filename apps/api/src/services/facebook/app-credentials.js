import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { encryptFacebookSecret, decryptFacebookSecret, isEncryptedSecret } from '../../utils/secretCrypto.js';
import { ensureFacebookOAuthSchema } from '../../utils/ensure-facebook-oauth-schema.js';
import { writeAuditLog } from '../audit/write.js';
import { DEFAULT_SCOPES, mergeRequiredScopes } from './scopes.js';
import {
	evaluateFacebookOAuthReadiness,
	isPlaceholderFacebookAppId,
	PLACEHOLDER_APP_ID,
} from './oauth-readiness.js';

const CONFIG_KEY = 'platform';

async function withFacebookCredentialsCollection(fn) {
	await ensureFacebookOAuthSchema(pocketbaseClient);
	return fn();
}

function httpError(status, message, errorCode = 'FACEBOOK_OAUTH_CONFIG') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function defaultRedirectUri() {
	return process.env.FACEBOOK_REDIRECT_URI
		|| `${process.env.API_PUBLIC_URL || 'http://localhost:3001'}/facebook/oauth/callback`;
}

function maskSecret(value) {
	if (!value) return '';
	const plain = isEncryptedSecret(value) ? '********' : String(value);
	if (plain.length <= 4) return '••••';
	return `••••${plain.slice(-4)}`;
}

function isPlaceholderAppId(appId) {
	return isPlaceholderFacebookAppId(appId, PLACEHOLDER_APP_ID);
}

async function getCredentialRow() {
	return withFacebookCredentialsCollection(() => pocketbaseClient.collection('facebook_app_credentials').getFirstListItem(
		pocketbaseClient.filter('config_key = {:key}', { key: CONFIG_KEY }),
		{ requestKey: null },
	)).catch(() => null);
}

function mapPublicConfig(row) {
	const appId = row?.app_id || process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID || PLACEHOLDER_APP_ID;
	const hasSecret = Boolean(row?.app_secret_ciphertext)
		|| Boolean(process.env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET);
	const envReady = Boolean(
		(process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID)
		&& (process.env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET),
	);
	const trialPending = row
		? Boolean(row.trial_access_pending)
		: !envReady;
	const redirectUri = row?.redirect_uri || defaultRedirectUri();
	const scopes = mergeRequiredScopes(row?.scopes || process.env.FACEBOOK_SCOPES || DEFAULT_SCOPES.join(','));
	const configured = Boolean(
		(row?.app_id && row?.app_secret_ciphertext && !isPlaceholderAppId(row.app_id) && !trialPending)
		|| (envReady && !row),
	);

	return {
		appId,
		appSecretMasked: hasSecret ? maskSecret(row?.app_secret_ciphertext || 'secret') : '',
		hasAppSecret: hasSecret,
		redirectUri,
		scopes: scopes.join(','),
		enabled: row ? Boolean(row.enabled) : envReady,
		trialAccessPending: trialPending,
		configured: configured || (envReady && !trialPending),
		updatedAt: row?.updated || null,
		source: row ? 'pocketbase' : ((process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID) ? 'env' : 'placeholder'),
		placeholders: {
			appId: PLACEHOLDER_APP_ID,
			redirectUri: defaultRedirectUri(),
			scopes: DEFAULT_SCOPES.join(','),
		},
	};
}

export async function getFacebookAppCredentialsPublic() {
	const row = await getCredentialRow();
	return mapPublicConfig(row);
}

export async function getFacebookAppCredentials() {
	const row = await getCredentialRow();
	const publicConfig = mapPublicConfig(row);

	let appId = row?.app_id || process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID || PLACEHOLDER_APP_ID;
	let appSecret = '';
	if (row?.app_secret_ciphertext) {
		appSecret = decryptFacebookSecret(row.app_secret_ciphertext);
	} else if (process.env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET) {
		appSecret = process.env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET;
	}

	const redirectUri = row?.redirect_uri || defaultRedirectUri();
	const scopes = mergeRequiredScopes(row?.scopes || process.env.FACEBOOK_SCOPES || DEFAULT_SCOPES.join(','));

	return {
		appId,
		appSecret,
		redirectUri,
		scopes,
		enabled: row ? Boolean(row.enabled) : Boolean(process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID),
		trialAccessPending: publicConfig.trialAccessPending,
		configured: publicConfig.configured,
		source: publicConfig.source,
	};
}

export async function isFacebookOAuthReady() {
	const credentials = await getFacebookAppCredentials();
	return evaluateFacebookOAuthReadiness(credentials).ok;
}

export async function assertFacebookOAuthReady() {
	let credentials = await getFacebookAppCredentials();
	let readiness = evaluateFacebookOAuthReadiness(credentials);

	// Heal seed/Admin default trap: App ID + Secret saved while "App access pending"
	// stayed on and "OAuth enabled" stayed off → Connect returned 503 forever.
	if (
		!readiness.ok
		&& readiness.errorCode === 'FACEBOOK_OAUTH_DISABLED'
		&& credentials.trialAccessPending
		&& !isPlaceholderAppId(credentials.appId)
		&& credentials.appSecret
	) {
		const row = await getCredentialRow();
		if (row?.id) {
			await pocketbaseClient.collection('facebook_app_credentials').update(row.id, {
				enabled: true,
				trial_access_pending: false,
			});
			credentials = await getFacebookAppCredentials();
			readiness = evaluateFacebookOAuthReadiness(credentials);
		}
	}

	if (!readiness.ok) {
		throw httpError(readiness.status, readiness.message, readiness.errorCode);
	}
	return credentials;
}

export async function upsertFacebookAppCredentials(payload = {}, actor = {}) {
	await ensureFacebookOAuthSchema(pocketbaseClient);
	const existing = await getCredentialRow();
	const nextAppId = payload.appId != null
		? String(payload.appId).trim()
		: (existing?.app_id || PLACEHOLDER_APP_ID);
	const nextRedirect = payload.redirectUri != null
		? String(payload.redirectUri).trim()
		: (existing?.redirect_uri || defaultRedirectUri());
	const nextScopes = mergeRequiredScopes(
		payload.scopes != null
			? String(payload.scopes).trim()
			: (existing?.scopes || DEFAULT_SCOPES.join(',')),
	).join(',');

	let secretCipher = existing?.app_secret_ciphertext || '';
	if (payload.appSecret != null && String(payload.appSecret).trim() && !String(payload.appSecret).includes('•')) {
		secretCipher = encryptFacebookSecret(String(payload.appSecret).trim());
	}

	const credentialsComplete = !isPlaceholderAppId(nextAppId) && Boolean(secretCipher);
	const previouslyComplete = Boolean(
		existing
		&& !isPlaceholderAppId(existing.app_id)
		&& existing.app_secret_ciphertext,
	);

	// Meta has no Trial Access gate. Complete credentials must clear the seed pending flag
	// or OAuth start stays 503 even after Admin saves App ID / Secret.
	const trialPending = credentialsComplete
		? false
		: (payload.trialAccessPending != null
			? Boolean(payload.trialAccessPending)
			: (existing ? Boolean(existing.trial_access_pending) : true));

	let enabled;
	if (credentialsComplete && !previouslyComplete) {
		// First time real credentials are stored — activate OAuth (seed defaults are disabled/pending).
		enabled = true;
	} else if (payload.enabled != null) {
		enabled = Boolean(payload.enabled);
	} else {
		enabled = existing ? Boolean(existing.enabled) : false;
	}

	const body = {
		config_key: CONFIG_KEY,
		app_id: nextAppId || PLACEHOLDER_APP_ID,
		app_secret_ciphertext: secretCipher,
		redirect_uri: nextRedirect || defaultRedirectUri(),
		scopes: nextScopes || DEFAULT_SCOPES.join(','),
		enabled,
		trial_access_pending: trialPending,
		kek_version: 'v1',
		meta: {
			...(existing?.meta || {}),
			updatedBy: actor.email || actor.id || 'admin',
			updatedAt: new Date().toISOString(),
		},
	};

	const saved = existing
		? await pocketbaseClient.collection('facebook_app_credentials').update(existing.id, body)
		: await pocketbaseClient.collection('facebook_app_credentials').create(body);

	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Facebook',
		action: 'Updated Facebook OAuth app credentials',
		actorUserId: actor.id,
		actorLabel: actor.email || actor.name || 'admin',
		resourceType: 'facebook_app_credentials',
		resourceId: saved.id,
		result: 'ok',
		metadata: {
			appId: body.app_id,
			redirectUri: body.redirect_uri,
			scopes: body.scopes,
			enabled: body.enabled,
			trialAccessPending: body.trial_access_pending,
			secretUpdated: Boolean(payload.appSecret && !String(payload.appSecret).includes('•')),
		},
	}).catch(() => null);

	return mapPublicConfig(saved);
}

export async function ensureFacebookAppCredentialsSeeded() {
	await ensureFacebookOAuthSchema(pocketbaseClient);
	const existing = await getCredentialRow();
	if (existing) return mapPublicConfig(existing);

	const envId = process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID;
	const envSecret = process.env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET;
	const fromEnv = Boolean(envId && envSecret);
	const body = {
		config_key: CONFIG_KEY,
		app_id: envId || PLACEHOLDER_APP_ID,
		app_secret_ciphertext: envSecret ? encryptFacebookSecret(envSecret) : '',
		redirect_uri: defaultRedirectUri(),
		scopes: mergeRequiredScopes(process.env.FACEBOOK_SCOPES || DEFAULT_SCOPES.join(',')).join(','),
		enabled: fromEnv,
		trial_access_pending: !fromEnv,
		kek_version: 'v1',
		meta: { seededAt: new Date().toISOString(), source: fromEnv ? 'env' : 'placeholder' },
	};

	const created = await pocketbaseClient.collection('facebook_app_credentials').create(body).catch(() => null);
	return mapPublicConfig(created || body);
}

export {
	PLACEHOLDER_APP_ID,
	DEFAULT_SCOPES,
	defaultRedirectUri,
	isPlaceholderAppId,
	evaluateFacebookOAuthReadiness,
};
