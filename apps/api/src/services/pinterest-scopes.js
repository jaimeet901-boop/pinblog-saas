/**
 * Pinterest OAuth scopes required for listing boards and publishing pins.
 * Pinterest API v5 requires boards:write to create pins onto a board
 * (even when the board already exists).
 */
export const REQUIRED_PUBLISH_SCOPES = Object.freeze([
	'boards:read',
	'boards:write',
	'pins:read',
	'pins:write',
	'user_accounts:read',
]);

export const DEFAULT_SCOPES = [...REQUIRED_PUBLISH_SCOPES];

/** Parse Pinterest scope strings (comma and/or whitespace separated). */
export function parseScopeList(value) {
	return String(value || '')
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

/** Ensure configured scopes always include every required publishing scope. */
export function mergeRequiredScopes(scopes) {
	const extras = parseScopeList(scopes).filter((scope) => !REQUIRED_PUBLISH_SCOPES.includes(scope));
	return [...REQUIRED_PUBLISH_SCOPES, ...extras];
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
