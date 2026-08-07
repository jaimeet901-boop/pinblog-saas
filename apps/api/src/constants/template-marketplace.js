/**
 * Marketplace library taxonomy — customer-facing galleries only.
 * Developer Archive is NOT a marketplace library (see developer-archive.js).
 *
 * Phase 1 scope: Marketplace isolation only (library filter, no platform-owner bleed,
 * bootstrap-only official seed). NOT in Phase 1: Collections, Admin CMS,
 * Developer Archive API routes, or full Marketplace taxonomy — those are later phases.
 */

export const MARKETPLACE_LIBRARIES = Object.freeze([
	'official',
	'premium',
	'community',
	'user',
]);

export function normalizeMarketplaceLibrary(value) {
	const library = String(value || '').trim().toLowerCase();
	return MARKETPLACE_LIBRARIES.includes(library) ? library : '';
}

/**
 * Resolve marketplace library from query. Legacy `scope` UI values map here.
 * Workspace scope stays on the scope branch in buildMarketplaceGalleryOwnerFilter.
 */
export function resolveGalleryLibraryQuery(query = {}) {
	const scope = String(query.scope || '').trim();
	if (scope === 'mine') return 'user';
	if (scope === 'official') return 'official';
	if (scope === 'community') return 'community';

	return normalizeMarketplaceLibrary(query.library);
}

function escapeFilterValue(value) {
	return String(value || '').replace(/"/g, '\\"');
}

/**
 * Pure PocketBase filter for marketplace gallery owner/library scope.
 * Excludes Developer Archive (no platform-owner union on customer surfaces).
 */
export function buildMarketplaceGalleryOwnerFilter({
	userId = '',
	workspaceOwnerId = '',
	workspaceId = '',
	scope = '',
	library = '',
} = {}) {
	const uid = String(userId || '').trim();
	const wsOwner = String(workspaceOwnerId || uid).trim();
	const wsId = String(workspaceId || '').trim();
	const resolvedLibrary = library || resolveGalleryLibraryQuery({ scope, library: '' });

	if (scope === 'workspace' && wsId) {
		return `(workspace_id = "${escapeFilterValue(wsId)}" || workspace = "${escapeFilterValue(wsId)}")`;
	}

	if (resolvedLibrary === 'user' || scope === 'mine') {
		if (!uid) return 'id = ""';
		return `(owner = "${escapeFilterValue(uid)}")`;
	}

	if (resolvedLibrary === 'official' || scope === 'official') {
		return 'visibility = "official"';
	}

	if (resolvedLibrary === 'community' || scope === 'community') {
		return 'visibility = "community"';
	}

	if (resolvedLibrary === 'premium') {
		// Premium rows are official visibility with plan-gated meta; refined post-map.
		return 'visibility = "official"';
	}

	// Default marketplace browse: official catalog + personal/workspace templates (no platform-owner bleed).
	const parts = ['visibility = "official"'];
	if (uid) {
		parts.push(`owner = "${escapeFilterValue(uid)}"`);
	}
	if (wsOwner && wsOwner !== uid) {
		parts.push(`owner = "${escapeFilterValue(wsOwner)}"`);
	}
	if (wsId) {
		parts.push(`workspace_id = "${escapeFilterValue(wsId)}"`);
		parts.push(`workspace = "${escapeFilterValue(wsId)}"`);
	}
	return `(${parts.join(' || ')})`;
}
