/**
 * Facebook / Meta Graph OAuth scopes for Pages connect + future publish.
 * Publish itself is F4+; scopes are reserved so reconnect does not drop them.
 */
export const REQUIRED_PAGE_SCOPES = Object.freeze([
	'pages_show_list',
	'pages_read_engagement',
	'pages_manage_posts',
	'pages_manage_metadata',
	'business_management',
]);

export const DEFAULT_SCOPES = [...REQUIRED_PAGE_SCOPES];

export function parseScopeList(value) {
	return String(value || '')
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function mergeRequiredScopes(scopes) {
	const extras = parseScopeList(scopes).filter((scope) => !REQUIRED_PAGE_SCOPES.includes(scope));
	return [...REQUIRED_PAGE_SCOPES, ...extras];
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
