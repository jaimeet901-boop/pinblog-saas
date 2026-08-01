/**
 * Authentication provider credentials — encrypted vault + Admin DTOs.
 * Mirrors Pinterest/Facebook oauth-config pattern; login IdPs only.
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { encryptAuthSecret, decryptAuthSecret, isEncryptedSecret } from '../../utils/secretCrypto.js';
import { writeAuditLog } from '../audit/write.js';
import { ensureAuthenticationProvidersSchema } from '../../utils/ensure-authentication-providers-schema.js';
import {
	AUTH_PROVIDERS_COLLECTION,
	AUTH_PROVIDER_CATALOG,
	defaultAuthRedirectUri,
	getAuthProviderCatalogEntry,
} from './catalog.js';
import { AUTH_PROVIDER_VERSION, deriveAuthProviderStatus } from './status.js';
import { testProviderCredentials } from './test-connection.js';

function httpError(status, message, errorCode = 'AUTH_PROVIDER_CONFIG') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function maskSecret(value) {
	if (!value) return '';
	const plain = isEncryptedSecret(value) ? '********' : String(value);
	if (plain.length <= 4) return '••••';
	return `••••${plain.slice(-4)}`;
}

function isPlaceholderClientId(clientId, placeholder) {
	const value = String(clientId || '').trim();
	if (!value) return true;
	if (placeholder && value === placeholder) return true;
	return /^YOUR_/i.test(value) || /^PENDING_/i.test(value) || /^replace/i.test(value);
}

function envClientId(entry) {
	if (!entry?.envClientId) return '';
	return String(process.env[entry.envClientId] || '').trim();
}

function envClientSecret(entry) {
	if (!entry?.envClientSecret) return '';
	return String(process.env[entry.envClientSecret] || '').trim();
}

function readMeta(row) {
	const meta = row?.meta;
	if (meta && typeof meta === 'object' && !Array.isArray(meta)) return { ...meta };
	return {};
}

async function withCollection(fn) {
	await ensureAuthenticationProvidersSchema(pocketbaseClient);
	return fn();
}

async function getProviderRow(providerId) {
	const id = String(providerId || '').trim().toLowerCase();
	return withCollection(() => pocketbaseClient.collection(AUTH_PROVIDERS_COLLECTION).getFirstListItem(
		pocketbaseClient.filter('provider = {:provider}', { provider: id }),
		{ requestKey: null },
	)).catch(() => null);
}

async function listProviderRows() {
	return withCollection(() => pocketbaseClient.collection(AUTH_PROVIDERS_COLLECTION).getFullList({
		requestKey: null,
		sort: 'provider',
	})).catch(() => []);
}

async function writeAuthAudit({
	action,
	actor = {},
	resourceId = '',
	result = 'ok',
	metadata = {},
}) {
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Authentication',
		action,
		actorUserId: actor.id,
		actorLabel: actor.email || actor.name || 'admin',
		resourceType: AUTH_PROVIDERS_COLLECTION,
		resourceId: resourceId || undefined,
		result,
		metadata,
	}).catch(() => null);
}

function mapPublicConfig(entry, row) {
	const placeholder = entry.placeholderClientId || `YOUR_${String(entry.id).toUpperCase()}_CLIENT_ID`;
	const envId = envClientId(entry);
	const envSecret = envClientSecret(entry);
	const envReady = Boolean(envId && envSecret);
	const hasDatabaseRow = Boolean(row?.id);
	const meta = readMeta(row);

	// Admin database row always overrides env for displayed client id when present.
	const clientId = hasDatabaseRow
		? (row.client_id || placeholder)
		: (envId || placeholder);
	const hasDbSecret = Boolean(row?.client_secret_ciphertext);
	const hasSecret = hasDbSecret || (!hasDatabaseRow && Boolean(envSecret));

	const dbConfigured = Boolean(
		hasDatabaseRow
		&& row.client_id
		&& row.client_secret_ciphertext
		&& !isPlaceholderClientId(row.client_id, placeholder),
	);
	const configured = dbConfigured || (!hasDatabaseRow && envReady);
	const enabled = hasDatabaseRow
		? Boolean(row.enabled)
		: (entry.configurable && envReady);
	const canonicalRedirectUri = defaultAuthRedirectUri();
	const redirectUri = (hasDatabaseRow && row.redirect_uri)
		? String(row.redirect_uri).trim()
		: canonicalRedirectUri;
	const scopes = String(
		(hasDatabaseRow && row.scopes) ? row.scopes : entry.defaultScopes || '',
	).trim();
	const placeholderClient = isPlaceholderClientId(clientId, placeholder);

	const statusInfo = deriveAuthProviderStatus({
		configurable: entry.configurable,
		hasDatabaseRow,
		hasEnvCredentials: envReady,
		configured,
		enabled,
		lastTestOk: typeof meta.lastTestOk === 'boolean' ? meta.lastTestOk : null,
		placeholder: placeholderClient,
	});

	const redirectUriMismatchRisk = Boolean(
		redirectUri
		&& canonicalRedirectUri
		&& redirectUri.replace(/\/+$/, '') !== canonicalRedirectUri.replace(/\/+$/, ''),
	);

	return {
		id: entry.id,
		displayName: entry.displayName,
		configurable: Boolean(entry.configurable),
		clientId,
		clientSecretMasked: hasSecret ? maskSecret(row?.client_secret_ciphertext || 'secret') : '',
		hasClientSecret: hasSecret,
		redirectUri,
		canonicalRedirectUri,
		redirectUriMismatchRisk,
		scopes,
		enabled,
		configured: configured && !placeholderClient,
		status: statusInfo.status,
		statusLabel: statusInfo.statusLabel,
		source: statusInfo.source === 'database' ? 'database' : (statusInfo.source === 'environment' ? 'environment' : 'none'),
		sourceLabel: statusInfo.sourceLabel,
		providerVersion: AUTH_PROVIDER_VERSION,
		updatedAt: row?.updated || meta.updatedAt || null,
		updatedBy: meta.updatedBy || null,
		lastTestAt: meta.lastTestAt || null,
		lastTestOk: typeof meta.lastTestOk === 'boolean' ? meta.lastTestOk : null,
		lastTestMessage: meta.lastTestMessage || null,
		docsHint: entry.docsHint || '',
		placeholders: {
			clientId: placeholder,
			redirectUri: canonicalRedirectUri,
			scopes: entry.defaultScopes || '',
		},
	};
}

/**
 * Admin-safe list — never returns raw secrets.
 */
export async function listAuthenticationProvidersPublic() {
	const rows = await listProviderRows();
	const byProvider = new Map(rows.map((row) => [String(row.provider || '').toLowerCase(), row]));
	return AUTH_PROVIDER_CATALOG.map((entry) => mapPublicConfig(entry, byProvider.get(entry.id) || null));
}

export async function getAuthenticationProviderPublic(providerId) {
	const entry = getAuthProviderCatalogEntry(providerId);
	if (!entry) {
		throw httpError(404, `Unknown authentication provider: ${providerId}`, 'AUTH_PROVIDER_UNKNOWN');
	}
	const row = await getProviderRow(entry.id);
	return mapPublicConfig(entry, row);
}

/**
 * Server-only credentials for apply-to-PocketBase.
 * Database row overrides env when present.
 */
export async function getAuthenticationProviderCredentials(providerId) {
	const entry = getAuthProviderCatalogEntry(providerId);
	if (!entry) {
		throw httpError(404, `Unknown authentication provider: ${providerId}`, 'AUTH_PROVIDER_UNKNOWN');
	}
	const row = await getProviderRow(entry.id);
	const publicConfig = mapPublicConfig(entry, row);

	let clientId = '';
	let clientSecret = '';
	if (row?.id) {
		clientId = row.client_id || entry.placeholderClientId || '';
		if (row.client_secret_ciphertext) {
			clientSecret = decryptAuthSecret(row.client_secret_ciphertext);
		}
	} else {
		clientId = envClientId(entry) || entry.placeholderClientId || '';
		clientSecret = envClientSecret(entry);
	}

	return {
		...publicConfig,
		clientId,
		clientSecret,
		authURL: entry.authURL || '',
		tokenURL: entry.tokenURL || '',
		userInfoURL: entry.userInfoURL || '',
		pkce: entry.pkce !== false,
		pocketBaseNative: Boolean(entry.pocketBaseNative),
	};
}

export async function listEnabledAuthenticationCredentials() {
	const items = [];
	for (const entry of AUTH_PROVIDER_CATALOG) {
		if (!entry.configurable) continue;
		const credentials = await getAuthenticationProviderCredentials(entry.id);
		if (!credentials.enabled || !credentials.configured || !credentials.clientSecret) continue;
		if (isPlaceholderClientId(credentials.clientId, entry.placeholderClientId)) continue;
		items.push(credentials);
	}
	return items;
}

async function applyProvidersSoft() {
	const { applyAuthenticationProvidersToPocketBase } = await import('./apply-to-pocketbase.js');
	await applyAuthenticationProvidersToPocketBase().catch(() => null);
}

export async function upsertAuthenticationProvider(providerId, payload = {}, actor = {}) {
	const entry = getAuthProviderCatalogEntry(providerId);
	if (!entry) {
		throw httpError(404, `Unknown authentication provider: ${providerId}`, 'AUTH_PROVIDER_UNKNOWN');
	}
	if (!entry.configurable) {
		throw httpError(
			501,
			`${entry.displayName} login is reserved for a later phase.`,
			'AUTH_PROVIDER_NOT_CONFIGURABLE',
		);
	}

	await ensureAuthenticationProvidersSchema(pocketbaseClient);
	const existing = await getProviderRow(entry.id);
	const placeholder = entry.placeholderClientId || `YOUR_${entry.id.toUpperCase()}_CLIENT_ID`;
	const prevMeta = readMeta(existing);
	const wasEnabled = existing ? Boolean(existing.enabled) : false;

	const nextClientId = payload.clientId != null
		? String(payload.clientId).trim()
		: (existing?.client_id || envClientId(entry) || placeholder);
	const nextRedirect = payload.redirectUri != null
		? String(payload.redirectUri).trim()
		: (existing?.redirect_uri || defaultAuthRedirectUri());
	const nextScopes = payload.scopes != null
		? String(payload.scopes).trim()
		: (existing?.scopes || entry.defaultScopes || '');

	const secretProvided = payload.clientSecret != null
		&& String(payload.clientSecret).trim()
		&& !String(payload.clientSecret).includes('•');
	let secretCipher = existing?.client_secret_ciphertext || '';
	if (secretProvided) {
		secretCipher = encryptAuthSecret(String(payload.clientSecret).trim());
	}

	const credentialsComplete = !isPlaceholderClientId(nextClientId, placeholder) && Boolean(secretCipher);
	const previouslyComplete = Boolean(
		existing
		&& !isPlaceholderClientId(existing.client_id, placeholder)
		&& existing.client_secret_ciphertext,
	);

	let enabled;
	if (credentialsComplete && !previouslyComplete && payload.enabled == null) {
		enabled = true;
	} else if (payload.enabled != null) {
		enabled = Boolean(payload.enabled);
	} else {
		enabled = existing ? Boolean(existing.enabled) : false;
	}

	const body = {
		provider: entry.id,
		display_name: entry.displayName,
		client_id: nextClientId || placeholder,
		client_secret_ciphertext: secretCipher,
		redirect_uri: nextRedirect || defaultAuthRedirectUri(),
		scopes: nextScopes || entry.defaultScopes || '',
		enabled,
		kek_version: 'v1',
		meta: {
			...prevMeta,
			updatedBy: actor.email || actor.id || 'admin',
			updatedAt: new Date().toISOString(),
			// New secret invalidates prior test result.
			...(secretProvided ? { lastTestOk: null, lastTestAt: null, lastTestMessage: null } : {}),
		},
	};

	const saved = existing
		? await pocketbaseClient.collection(AUTH_PROVIDERS_COLLECTION).update(existing.id, body)
		: await pocketbaseClient.collection(AUTH_PROVIDERS_COLLECTION).create(body);

	const auditActions = [];
	if (secretProvided && previouslyComplete) {
		auditActions.push(`Rotated ${entry.displayName} authentication secret`);
	}
	if (wasEnabled !== enabled) {
		auditActions.push(enabled
			? `Enabled ${entry.displayName} authentication provider`
			: `Disabled ${entry.displayName} authentication provider`);
	}
	if (!auditActions.length) {
		auditActions.push(`Saved ${entry.displayName} authentication provider`);
	}

	for (const action of auditActions) {
		await writeAuthAudit({
			action,
			actor,
			resourceId: saved.id,
			metadata: {
				provider: entry.id,
				clientId: body.client_id,
				redirectUri: body.redirect_uri,
				scopes: body.scopes,
				enabled: body.enabled,
				secretRotated: Boolean(secretProvided && previouslyComplete),
				secretUpdated: Boolean(secretProvided),
			},
		});
	}

	await applyProvidersSoft();
	return mapPublicConfig(entry, saved);
}

/**
 * Rotate only the client secret (keeps client id / redirect / scopes / enabled).
 */
export async function rotateAuthenticationProviderSecret(providerId, clientSecret, actor = {}) {
	const secret = String(clientSecret || '').trim();
	if (!secret || secret.includes('•')) {
		throw httpError(422, 'A new Client Secret is required to rotate.', 'AUTH_PROVIDER_SECRET_REQUIRED');
	}
	return upsertAuthenticationProvider(providerId, { clientSecret: secret }, actor);
}

/**
 * Clear database credentials so environment fallback can take over.
 */
export async function resetAuthenticationProvider(providerId, actor = {}) {
	const entry = getAuthProviderCatalogEntry(providerId);
	if (!entry) {
		throw httpError(404, `Unknown authentication provider: ${providerId}`, 'AUTH_PROVIDER_UNKNOWN');
	}
	if (!entry.configurable) {
		throw httpError(501, `${entry.displayName} reset is not available.`, 'AUTH_PROVIDER_NOT_CONFIGURABLE');
	}

	const existing = await getProviderRow(entry.id);
	if (existing?.id) {
		await pocketbaseClient.collection(AUTH_PROVIDERS_COLLECTION).delete(existing.id);
		await writeAuthAudit({
			action: `Reset ${entry.displayName} authentication credentials`,
			actor,
			resourceId: existing.id,
			metadata: { provider: entry.id, fallback: 'environment' },
		});
	} else {
		await writeAuthAudit({
			action: `Reset ${entry.displayName} authentication credentials`,
			actor,
			metadata: { provider: entry.id, note: 'No database row to clear' },
		});
	}

	await applyProvidersSoft();
	return getAuthenticationProviderPublic(entry.id);
}

/**
 * Test credentials without mutating stored secrets.
 * Optional body clientId/clientSecret test unsaved form values.
 * Otherwise uses stored (DB override else env) credentials.
 */
export async function testAuthenticationProviderConnection(providerId, payload = {}, actor = {}) {
	const entry = getAuthProviderCatalogEntry(providerId);
	if (!entry) {
		throw httpError(404, `Unknown authentication provider: ${providerId}`, 'AUTH_PROVIDER_UNKNOWN');
	}
	if (!entry.configurable) {
		throw httpError(501, `${entry.displayName} test is not available yet.`, 'AUTH_PROVIDER_NOT_CONFIGURABLE');
	}

	const stored = await getAuthenticationProviderCredentials(entry.id);
	const clientId = payload.clientId != null && String(payload.clientId).trim()
		? String(payload.clientId).trim()
		: stored.clientId;
	const redirectUri = payload.redirectUri != null && String(payload.redirectUri).trim()
		? String(payload.redirectUri).trim()
		: stored.redirectUri;

	let clientSecret = '';
	if (payload.clientSecret != null && String(payload.clientSecret).trim() && !String(payload.clientSecret).includes('•')) {
		clientSecret = String(payload.clientSecret).trim();
	} else {
		clientSecret = stored.clientSecret;
	}

	const result = await testProviderCredentials({
		providerId: entry.id,
		clientId,
		clientSecret,
		redirectUri,
		tokenURL: entry.tokenURL,
	});

	const row = await getProviderRow(entry.id);
	if (row?.id) {
		const meta = {
			...readMeta(row),
			lastTestAt: new Date().toISOString(),
			lastTestOk: Boolean(result.ok),
			lastTestMessage: result.message,
			lastTestCode: result.code,
		};
		await pocketbaseClient.collection(AUTH_PROVIDERS_COLLECTION).update(row.id, { meta }).catch(() => null);
	}

	await writeAuthAudit({
		action: `Tested ${entry.displayName} authentication connection`,
		actor,
		resourceId: row?.id || '',
		result: result.ok ? 'ok' : 'error',
		metadata: {
			provider: entry.id,
			ok: result.ok,
			code: result.code,
			warning: result.warning || null,
			// Never log secrets.
			clientId,
			redirectUri,
		},
	});

	const publicConfig = await getAuthenticationProviderPublic(entry.id);
	return {
		...result,
		provider: publicConfig,
	};
}

export async function ensureAuthenticationProvidersSeeded() {
	await ensureAuthenticationProvidersSchema(pocketbaseClient);
	const google = getAuthProviderCatalogEntry('google');
	if (!google) return listAuthenticationProvidersPublic();

	// Do not auto-create a DB row from env — env remains fallback until Admin saves.
	// Only apply whatever Admin (or prior seed) already stored.
	await applyProvidersSoft();
	return listAuthenticationProvidersPublic();
}

export {
	isPlaceholderClientId,
	mapPublicConfig,
	httpError,
};
