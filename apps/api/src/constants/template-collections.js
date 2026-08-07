/**
 * Phase 2 — Marketplace collection taxonomy constants.
 * Collections are channel-scoped browse groups (not content categories).
 */

import { normalizeTemplateChannel } from './template-channels.js';
import { MARKETPLACE_LIBRARIES } from './template-marketplace.js';

export const COLLECTION_LIBRARY_SCOPES = Object.freeze([
	'official',
	'premium',
	'community',
	'all',
]);

export const COLLECTION_STATUS = Object.freeze([
	'draft',
	'published',
	'archived',
]);

export function normalizeCollectionSlug(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
}

export function normalizeCollectionLibraryScope(value) {
	const scope = String(value || 'official').trim().toLowerCase();
	return COLLECTION_LIBRARY_SCOPES.includes(scope) ? scope : 'official';
}

export function normalizeCollectionStatus(value) {
	const status = String(value || 'draft').trim().toLowerCase();
	return COLLECTION_STATUS.includes(status) ? status : 'draft';
}

export function normalizeCollectionChannel(value) {
	return normalizeTemplateChannel(value);
}

export function collectionMatchesLibraryScope(collection = {}, library = '') {
	const scope = normalizeCollectionLibraryScope(collection.library_scope || collection.libraryScope);
	if (scope === 'all') return true;
	const resolvedLibrary = String(library || '').trim().toLowerCase();
	if (!resolvedLibrary) return scope === 'official';
	return scope === resolvedLibrary || (scope === 'official' && resolvedLibrary === 'premium');
}

export function isPublishedCollection(record = {}) {
	return normalizeCollectionStatus(record.status) === 'published';
}

/** Marketplace libraries excluding user — collections apply to curated libraries only. */
export const COLLECTION_ELIGIBLE_LIBRARIES = MARKETPLACE_LIBRARIES.filter((lib) => lib !== 'user');
