/**
 * Platform Authentication Providers catalog (login IdPs).
 * Separate from publishing OAuth (Pinterest / Facebook channel packs).
 */

export const AUTH_PROVIDERS_COLLECTION = 'authentication_providers';

/** Managed login provider ids — applied into PocketBase users.oauth2. */
export const AUTH_PROVIDER_IDS = Object.freeze([
	'google',
	'apple',
	'microsoft',
	'github',
	'discord',
]);

/**
 * @typedef {object} AuthProviderCatalogEntry
 * @property {string} id
 * @property {string} displayName
 * @property {boolean} configurable - Admin can save credentials today
 * @property {boolean} pocketBaseNative - PocketBase has a first-class provider name
 * @property {string} [authURL]
 * @property {string} [tokenURL]
 * @property {string} [userInfoURL]
 * @property {string} defaultScopes
 * @property {boolean} pkce
 * @property {string} [envClientId]
 * @property {string} [envClientSecret]
 * @property {string} [placeholderClientId]
 * @property {string} [docsHint]
 */

/** @type {readonly AuthProviderCatalogEntry[]} */
export const AUTH_PROVIDER_CATALOG = Object.freeze([
	Object.freeze({
		id: 'google',
		displayName: 'Google',
		configurable: true,
		pocketBaseNative: true,
		authURL: 'https://accounts.google.com/o/oauth2/v2/auth',
		tokenURL: 'https://oauth2.googleapis.com/token',
		// PocketBase Google parser expects v3 fields (sub, email_verified).
		// v2 returns id/verified_email → empty oauth email and failed signup.
		userInfoURL: 'https://www.googleapis.com/oauth2/v3/userinfo',
		defaultScopes: 'openid email profile',
		pkce: true,
		envClientId: 'GOOGLE_CLIENT_ID',
		envClientSecret: 'GOOGLE_CLIENT_SECRET',
		placeholderClientId: 'YOUR_GOOGLE_CLIENT_ID',
		docsHint: 'Google Cloud Console → OAuth 2.0 Client IDs. Redirect URI must match PocketBase oauth2-redirect.',
	}),
	Object.freeze({
		id: 'apple',
		displayName: 'Apple',
		configurable: false,
		pocketBaseNative: true,
		authURL: 'https://appleid.apple.com/auth/authorize',
		tokenURL: 'https://appleid.apple.com/auth/token',
		userInfoURL: '',
		defaultScopes: 'name email',
		pkce: true,
		placeholderClientId: 'YOUR_APPLE_CLIENT_ID',
		docsHint: 'Reserved for Sign in with Apple — enable in a later phase.',
	}),
	Object.freeze({
		id: 'microsoft',
		displayName: 'Microsoft',
		configurable: false,
		pocketBaseNative: true,
		authURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
		tokenURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
		userInfoURL: 'https://graph.microsoft.com/v1.0/me',
		defaultScopes: 'openid email profile',
		pkce: true,
		placeholderClientId: 'YOUR_MICROSOFT_CLIENT_ID',
		docsHint: 'Reserved for Microsoft Entra ID login — enable in a later phase.',
	}),
	Object.freeze({
		id: 'github',
		displayName: 'GitHub',
		configurable: false,
		pocketBaseNative: true,
		authURL: 'https://github.com/login/oauth/authorize',
		tokenURL: 'https://github.com/login/oauth/access_token',
		userInfoURL: 'https://api.github.com/user',
		defaultScopes: 'read:user user:email',
		pkce: true,
		placeholderClientId: 'YOUR_GITHUB_CLIENT_ID',
		docsHint: 'Reserved for GitHub login — enable in a later phase.',
	}),
	Object.freeze({
		id: 'discord',
		displayName: 'Discord',
		configurable: false,
		pocketBaseNative: true,
		authURL: 'https://discord.com/api/oauth2/authorize',
		tokenURL: 'https://discord.com/api/oauth2/token',
		userInfoURL: 'https://discord.com/api/users/@me',
		defaultScopes: 'identify email',
		pkce: true,
		placeholderClientId: 'YOUR_DISCORD_CLIENT_ID',
		docsHint: 'Reserved for Discord login — enable in a later phase.',
	}),
]);

export function getAuthProviderCatalogEntry(providerId) {
	const id = String(providerId || '').trim().toLowerCase();
	return AUTH_PROVIDER_CATALOG.find((entry) => entry.id === id) || null;
}

export function isManagedAuthProvider(providerId) {
	return AUTH_PROVIDER_IDS.includes(String(providerId || '').trim().toLowerCase());
}

export function defaultAuthRedirectUri() {
	const websiteDomain = String(process.env.WEBSITE_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
	if (websiteDomain) {
		return `https://${websiteDomain}/hcgi/platform/api/oauth2-redirect`;
	}
	const webBase = String(
		process.env.WEB_APP_URL
		|| process.env.APP_WEB_URL
		|| process.env.CORS_ORIGIN
		|| '',
	).trim().replace(/\/+$/, '');
	if (webBase) {
		return `${webBase}/hcgi/platform/api/oauth2-redirect`;
	}
	return 'http://127.0.0.1:8090/api/oauth2-redirect';
}
