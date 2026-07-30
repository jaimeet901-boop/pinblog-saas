/**
 * Facebook / Meta Graph OAuth scopes for Pages connect + future publish.
 * Publish itself is F4+; scopes are reserved so reconnect does not drop them.
 *
 * Login Dialog notes (Meta manual flow):
 * - `public_profile` is always required by Facebook Login.
 * - `business_management` is restricted and often breaks the dialog for new apps
 *   that have not added/approved it — keep it optional, not required for Connect.
 */
export const REQUIRED_PAGE_SCOPES = Object.freeze([
	'public_profile',
	'pages_show_list',
	'pages_read_engagement',
	'pages_manage_posts',
	'pages_manage_metadata',
]);

/** Optional advanced scopes — do not force on Login Dialog by default. */
export const OPTIONAL_ADVANCED_SCOPES = Object.freeze([
	'business_management',
]);

export const DEFAULT_SCOPES = [...REQUIRED_PAGE_SCOPES];

/** Scopes known to crash / block Meta Login Dialog when undeclared on the app. */
export const DIALOG_RISKY_SCOPES = new Set(OPTIONAL_ADVANCED_SCOPES);

export function parseScopeList(value) {
	if (Array.isArray(value)) {
		return value.map((item) => String(item || '').trim()).filter(Boolean);
	}
	return String(value || '')
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function mergeRequiredScopes(scopes) {
	const extras = parseScopeList(scopes).filter((scope) => !REQUIRED_PAGE_SCOPES.includes(scope));
	// Drop legacy defaults that are optional/risky unless explicitly kept later for Graph calls.
	const safeExtras = extras.filter((scope) => !DIALOG_RISKY_SCOPES.has(scope));
	return [...REQUIRED_PAGE_SCOPES, ...safeExtras];
}

/**
 * Scopes sent to Meta Login Dialog.
 * Excludes risky advanced permissions unless FACEBOOK_INCLUDE_BUSINESS_SCOPE=1.
 */
export function scopesForLoginDialog(scopes) {
	const merged = mergeRequiredScopes(scopes);
	const includeBusiness = String(process.env.FACEBOOK_INCLUDE_BUSINESS_SCOPE || '').trim() === '1';
	if (includeBusiness && !merged.includes('business_management')) {
		return [...merged, 'business_management'];
	}
	return merged.filter((scope) => includeBusiness || !DIALOG_RISKY_SCOPES.has(scope));
}

export function analyzeGrantedScopes({ requested = [], granted = '' } = {}) {
	const requestedList = mergeRequiredScopes(requested);
	const grantedList = parseScopeList(granted);
	const grantedSet = new Set(grantedList);
	const missing = requestedList.filter((scope) => !grantedSet.has(scope));
	return {
		requested: requestedList,
		granted: grantedList,
		missing,
		ok: missing.length === 0,
	};
}
