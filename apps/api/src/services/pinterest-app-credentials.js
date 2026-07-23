import pocketbaseClient from '../utils/pocketbaseClient.js';
import { encryptPinterestSecret, decryptPinterestSecret, isEncryptedSecret } from '../utils/secretCrypto.js';
import { writeAuditLog } from './audit/write.js';

const CONFIG_KEY = 'platform';
const PLACEHOLDER_APP_ID = 'YOUR_PINTEREST_APP_ID';
const DEFAULT_SCOPES = ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'];

function httpError(status, message, errorCode = 'PINTEREST_OAUTH_CONFIG') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function defaultRedirectUri() {
	return process.env.PINTEREST_REDIRECT_URI
		|| `${process.env.API_PUBLIC_URL || 'http://localhost:3001'}/pinterest/oauth/callback`;
}

function maskSecret(value) {
	if (!value) return '';
	const plain = isEncryptedSecret(value) ? '********' : String(value);
	if (plain.length <= 4) return '••••';
	return `••••${plain.slice(-4)}`;
}

function isPlaceholderAppId(appId) {
	const value = String(appId || '').trim();
	if (!value) return true;
	return /^YOUR_PINTEREST/i.test(value) || /^PENDING_/i.test(value) || value === PLACEHOLDER_APP_ID;
}

async function getCredentialRow() {
	return pocketbaseClient.collection('pinterest_app_credentials').getFirstListItem(
		pocketbaseClient.filter('config_key = {:key}', { key: CONFIG_KEY }),
		{ requestKey: null },
	).catch(() => null);
}

function mapPublicConfig(row) {
	const appId = row?.app_id || process.env.PINTEREST_CLIENT_ID || PLACEHOLDER_APP_ID;
	const hasSecret = Boolean(row?.app_secret_ciphertext) || Boolean(process.env.PINTEREST_CLIENT_SECRET);
	const envReady = Boolean(process.env.PINTEREST_CLIENT_ID && process.env.PINTEREST_CLIENT_SECRET);
	const trialPending = row
		? Boolean(row.trial_access_pending)
		: !envReady;
	const redirectUri = row?.redirect_uri || defaultRedirectUri();
	const scopes = row?.scopes || (process.env.PINTEREST_SCOPES || DEFAULT_SCOPES.join(','));
	const configured = Boolean(
		(row?.app_id && row?.app_secret_ciphertext && !isPlaceholderAppId(row.app_id) && !trialPending)
		|| (envReady && !row),
	);

	return {
		appId,
		appSecretMasked: hasSecret ? maskSecret(row?.app_secret_ciphertext || 'secret') : '',
		hasAppSecret: hasSecret,
		redirectUri,
		scopes,
		enabled: row ? Boolean(row.enabled) : envReady,
		trialAccessPending: trialPending,
		configured: configured || (envReady && !trialPending),
		updatedAt: row?.updated || null,
		source: row ? 'pocketbase' : (process.env.PINTEREST_CLIENT_ID ? 'env' : 'placeholder'),
		placeholders: {
			appId: PLACEHOLDER_APP_ID,
			redirectUri: defaultRedirectUri(),
			scopes: DEFAULT_SCOPES.join(','),
		},
	};
}

/**
 * Admin-safe DTO — never returns the raw app secret.
 */
export async function getPinterestAppCredentialsPublic() {
	const row = await getCredentialRow();
	return mapPublicConfig(row);
}

/**
 * Server-only credentials for OAuth token exchange.
 * Prefers PocketBase, falls back to env, then placeholders.
 */
export async function getPinterestAppCredentials() {
	const row = await getCredentialRow();
	const publicConfig = mapPublicConfig(row);

	let appId = row?.app_id || process.env.PINTEREST_CLIENT_ID || PLACEHOLDER_APP_ID;
	let appSecret = '';
	if (row?.app_secret_ciphertext) {
		appSecret = decryptPinterestSecret(row.app_secret_ciphertext);
	} else if (process.env.PINTEREST_CLIENT_SECRET) {
		appSecret = process.env.PINTEREST_CLIENT_SECRET;
	}

	const redirectUri = row?.redirect_uri || defaultRedirectUri();
	const scopes = String(row?.scopes || process.env.PINTEREST_SCOPES || DEFAULT_SCOPES.join(','))
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);

	return {
		appId,
		appSecret,
		redirectUri,
		scopes,
		enabled: row ? Boolean(row.enabled) : Boolean(process.env.PINTEREST_CLIENT_ID),
		trialAccessPending: publicConfig.trialAccessPending,
		configured: publicConfig.configured,
		source: publicConfig.source,
	};
}

export async function assertPinterestOAuthReady() {
	const credentials = await getPinterestAppCredentials();
	if (credentials.trialAccessPending || isPlaceholderAppId(credentials.appId) || !credentials.appSecret) {
		throw httpError(
			503,
			'Pinterest OAuth is waiting for Trial Access approval. Configure App ID and App Secret in Admin Console once Pinterest approves access.',
			'PINTEREST_TRIAL_PENDING',
		);
	}
	if (!credentials.enabled && credentials.source === 'pocketbase') {
		throw httpError(503, 'Pinterest OAuth is disabled in Admin Console.', 'PINTEREST_OAUTH_DISABLED');
	}
	if (!credentials.redirectUri) {
		throw httpError(500, 'Pinterest redirect URI is not configured.', 'PINTEREST_REDIRECT_MISSING');
	}
	return credentials;
}

export async function upsertPinterestAppCredentials(payload = {}, actor = {}) {
	const existing = await getCredentialRow();
	const nextAppId = payload.appId != null
		? String(payload.appId).trim()
		: (existing?.app_id || PLACEHOLDER_APP_ID);
	const nextRedirect = payload.redirectUri != null
		? String(payload.redirectUri).trim()
		: (existing?.redirect_uri || defaultRedirectUri());
	const nextScopes = payload.scopes != null
		? String(payload.scopes).trim()
		: (existing?.scopes || DEFAULT_SCOPES.join(','));
	const trialPending = payload.trialAccessPending != null
		? Boolean(payload.trialAccessPending)
		: (existing ? Boolean(existing.trial_access_pending) : true);
	const enabled = payload.enabled != null
		? Boolean(payload.enabled)
		: (existing ? Boolean(existing.enabled) : false);

	let secretCipher = existing?.app_secret_ciphertext || '';
	if (payload.appSecret != null && String(payload.appSecret).trim() && !String(payload.appSecret).includes('•')) {
		secretCipher = encryptPinterestSecret(String(payload.appSecret).trim());
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
		? await pocketbaseClient.collection('pinterest_app_credentials').update(existing.id, body)
		: await pocketbaseClient.collection('pinterest_app_credentials').create(body);

	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Pinterest',
		action: 'Updated Pinterest OAuth app credentials',
		actorUserId: actor.id,
		actorLabel: actor.email || actor.name || 'admin',
		resourceType: 'pinterest_app_credentials',
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

export async function ensurePinterestAppCredentialsSeeded() {
	const existing = await getCredentialRow();
	if (existing) return mapPublicConfig(existing);

	const fromEnv = Boolean(process.env.PINTEREST_CLIENT_ID && process.env.PINTEREST_CLIENT_SECRET);
	const body = {
		config_key: CONFIG_KEY,
		app_id: process.env.PINTEREST_CLIENT_ID || PLACEHOLDER_APP_ID,
		app_secret_ciphertext: process.env.PINTEREST_CLIENT_SECRET
			? encryptPinterestSecret(process.env.PINTEREST_CLIENT_SECRET)
			: '',
		redirect_uri: defaultRedirectUri(),
		scopes: process.env.PINTEREST_SCOPES || DEFAULT_SCOPES.join(','),
		enabled: fromEnv,
		trial_access_pending: !fromEnv,
		kek_version: 'v1',
		meta: { seededAt: new Date().toISOString(), source: fromEnv ? 'env' : 'placeholder' },
	};

	const created = await pocketbaseClient.collection('pinterest_app_credentials').create(body).catch(() => null);
	return mapPublicConfig(created || body);
}

export { PLACEHOLDER_APP_ID, DEFAULT_SCOPES, defaultRedirectUri };
