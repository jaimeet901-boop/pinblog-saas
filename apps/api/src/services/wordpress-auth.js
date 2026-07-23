/**
 * Extensible WordPress authentication providers.
 * Primary: Application Passwords (Basic over HTTPS).
 * Optional: Basic Authentication (username + password).
 */

export const WP_AUTH_TYPES = Object.freeze({
	APPLICATION_PASSWORD: 'application_password',
	BASIC: 'basic',
});

const providers = new Map();

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export function normalizeWpAuthType(value) {
	const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
	if (!raw || raw === 'app_password' || raw === 'application_passwords' || raw === 'applicationpassword') {
		return WP_AUTH_TYPES.APPLICATION_PASSWORD;
	}
	if (raw === 'basic' || raw === 'basic_auth' || raw === 'basicauth') {
		return WP_AUTH_TYPES.BASIC;
	}
	if (providers.has(raw)) return raw;
	return WP_AUTH_TYPES.APPLICATION_PASSWORD;
}

export function registerWordpressAuthProvider(type, provider) {
	const key = normalizeWpAuthType(type);
	if (!provider || typeof provider.buildAuthorizationHeader !== 'function') {
		throw new Error('WordPress auth provider must implement buildAuthorizationHeader');
	}
	providers.set(key, provider);
	return key;
}

function basicHeader(username, secret) {
	return `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`;
}

registerWordpressAuthProvider(WP_AUTH_TYPES.APPLICATION_PASSWORD, {
	id: WP_AUTH_TYPES.APPLICATION_PASSWORD,
	label: 'Application Password',
	buildAuthorizationHeader({ username, secret }) {
		if (!username || !secret) {
			throw httpError(422, 'WordPress username and application password are required', 'WP_CREDENTIALS_MISSING');
		}
		return basicHeader(username, secret);
	},
});

registerWordpressAuthProvider(WP_AUTH_TYPES.BASIC, {
	id: WP_AUTH_TYPES.BASIC,
	label: 'Basic Authentication',
	buildAuthorizationHeader({ username, secret }) {
		if (!username || !secret) {
			throw httpError(422, 'WordPress username and password are required', 'WP_CREDENTIALS_MISSING');
		}
		return basicHeader(username, secret);
	},
});

export function listWordpressAuthProviders() {
	return [...providers.values()].map((provider) => ({
		id: provider.id,
		label: provider.label || provider.id,
	}));
}

export function buildWordpressAuthHeader({ authType, username, secret, appPassword, password }) {
	const type = normalizeWpAuthType(authType);
	const provider = providers.get(type);
	if (!provider) {
		throw httpError(422, `Unsupported WordPress auth type: ${type}`, 'WP_AUTH_UNSUPPORTED');
	}
	return provider.buildAuthorizationHeader({
		username: String(username || '').trim(),
		secret: String(secret || appPassword || password || '').trim(),
	});
}
