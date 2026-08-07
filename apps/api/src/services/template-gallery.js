/**
 * Template Gallery — paginated list, favorites, touch, status, export, preview cache.
 * Marketplace-ready filters (visibility) without hardcoding marketplace UI.
 */

import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_STATUS,
	TEMPLATE_VISIBILITY,
} from '../constants/pin-engine.js';
import {
	extractRecordChannel,
	matchesChannelFilter,
	normalizeTemplateChannel,
	TEMPLATE_CHANNELS,
} from '../constants/template-channels.js';
import {
	buildMarketplaceGalleryOwnerFilter,
	resolveGalleryLibraryQuery,
	MARKETPLACE_LIBRARIES,
} from '../constants/template-marketplace.js';
import { normalizeCollectionSlug } from '../constants/template-collections.js';
import {
	listGalleryCollections,
	resolveCollectionTemplateIds,
} from './template-collections.js';
import { paginateGalleryItems } from './template-gallery-pagination.js';
import { createTemplateUuid, hashTemplateConfigurationSync } from '../utils/pin-template-identity.js';
import { resolvePlatformLibraryOwnerId } from './official-pin-templates-seed.js';
import {
	assertTemplateUseAccess,
	attachAllowedAccess,
	attachTemplateAccess,
	evaluateTemplateAccess,
	featureLockedError,
	isPremiumTemplate,
	resolveAccessContext,
} from './plan-access-guard.js';

function escapeFilterValue(value) {
	return String(value || '').replace(/"/g, '\\"');
}

function extractTags(record) {
	const meta = record.marketplace_meta && typeof record.marketplace_meta === 'object'
		? record.marketplace_meta
		: {};
	const tags = meta.tags || meta.Labels || record.tags;
	if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
	if (typeof tags === 'string') {
		return tags.split(',').map((t) => t.trim()).filter(Boolean);
	}
	return [];
}

function extractAuthor(record) {
	const expand = record.expand || {};
	const user = expand.created_by || expand.owner || null;
	return {
		authorId: record.created_by || record.owner || '',
		authorName: user?.name || user?.email || record.owner || 'You',
	};
}

export function mapGalleryTemplate(record, extras = {}) {
	const tags = extractTags(record);
	const author = extractAuthor(record);
	const status = record.status || 'published';
	const visibility = record.visibility || 'private';
	const category = record.category || 'general';
	const checksum = record.config_checksum || '';

	return {
		id: record.id,
		channel: extractRecordChannel(record),
		templateUuid: record.template_uuid || null,
		name: record.name,
		thumbnail: record.thumbnail || '',
		previewUrl: extras.previewUrl || record.thumbnail || '',
		previewCached: Boolean(extras.previewCached),
		configChecksum: checksum,
		configuration: extras.includeConfiguration ? (record.configuration || {}) : undefined,
		isDefault: Boolean(record.is_default),
		category,
		status,
		visibility,
		tags,
		...author,
		editorVersion: Number(record.editor_version) || (
			record.configuration?.editorVersion === 2 ? 2 : 1
		),
		schemaVersion: Number(record.schema_version) || 1,
		revision: Number(record.revision) || 1,
		useCount: Number(record.use_count) || 0,
		lastUsedAt: record.last_used_at || null,
		workspaceId: record.workspace_id || null,
		isFavorite: Boolean(extras.isFavorite),
		marketplace: {
			ready: true,
			visibility,
			meta: record.marketplace_meta || null,
		},
		source: 'ai_pin_templates',
		createdAt: record.created,
		updatedAt: record.updated,
		deletedAt: record.deleted_at || null,
	};
}

async function listFavoriteTemplateIds(req) {
	const workspaceId = req.workspace?.id;
	const userId = req.pocketbaseUserId;
	if (!workspaceId || !userId) return new Set();

	try {
		const rows = await pocketbaseClient.collection('ai_pin_template_favorites').getFullList({
			filter: pocketbaseClient.filter(
				'workspace_id = {:ws} && created_by = {:user} && deleted_at = ""',
				{ ws: workspaceId, user: userId },
			),
			fields: 'template_id',
			requestKey: null,
		});
		return new Set(rows.map((row) => row.template_id).filter(Boolean));
	} catch {
		// Soft fallback if collection not migrated yet
		return new Set();
	}
}

async function loadPreviewUrls(records) {
	const map = new Map();
	const ids = records.map((r) => r.id).filter(Boolean);
	if (!ids.length) return map;

	try {
		const filter = ids.map((id) => `template_id = "${escapeFilterValue(id)}"`).join(' || ');
		const rows = await pocketbaseClient.collection('ai_pin_template_preview_cache').getFullList({
			filter: `(${filter}) && deleted_at = ""`,
			sort: '-updated',
			requestKey: null,
		});
		for (const row of rows) {
			const key = `${row.template_id}:${String(row.config_checksum || '').toLowerCase()}:${String(row.format || 'png').toLowerCase()}`;
			if (!map.has(key) && row.image_url) {
				map.set(key, row.image_url);
			}
		}
	} catch {
		// Preview cache optional until migrations applied
	}
	return map;
}

function resolvePreview(record, previewMap) {
	const checksum = String(record.config_checksum || '').toLowerCase();
	if (!checksum) {
		return { previewUrl: record.thumbnail || '', previewCached: false };
	}
	const key = `${record.id}:${checksum}:png`;
	const cached = previewMap.get(key);
	if (cached) {
		return { previewUrl: cached, previewCached: true };
	}
	return { previewUrl: record.thumbnail || '', previewCached: false };
}

function resolveGalleryPerPage(query) {
	const requested = Number(query.perPage) || Number(query.per_page) || 24;
	const maxPerPage = Number(query.maxPerPage) || Number(query.max_per_page) || 200;
	return Math.min(Math.max(1, requested), Math.max(1, maxPerPage));
}

let cachedPlatformLibraryOwnerId = null;
let platformLibraryOwnerResolvedAt = 0;
const PLATFORM_OWNER_CACHE_MS = 5 * 60 * 1000;

async function getPlatformLibraryOwnerId() {
	const now = Date.now();
	if (cachedPlatformLibraryOwnerId && now - platformLibraryOwnerResolvedAt < PLATFORM_OWNER_CACHE_MS) {
		return cachedPlatformLibraryOwnerId;
	}
	cachedPlatformLibraryOwnerId = await resolvePlatformLibraryOwnerId().catch(() => null);
	platformLibraryOwnerResolvedAt = now;
	return cachedPlatformLibraryOwnerId;
}

/**
 * Promote catalog / marketplace official rows to visibility=official (idempotent, no migration).
 */
async function reconcileSharedLibraryVisibility() {
	const platformOwnerId = await getPlatformLibraryOwnerId();
	if (!platformOwnerId) return { updated: 0 };

	let rows = [];
	try {
		rows = await pocketbaseClient.collection('ai_pin_templates').getFullList({
			filter: pocketbaseClient.filter(
				'(visibility = "" || visibility = "private") && deleted_at = ""',
				{},
			),
			fields: 'id,visibility,marketplace_meta,template_uuid,owner',
			requestKey: null,
		});
	} catch {
		return { updated: 0 };
	}

	let updated = 0;
	for (const row of rows) {
		const meta = row.marketplace_meta && typeof row.marketplace_meta === 'object'
			? row.marketplace_meta
			: {};
		const uuid = String(row.template_uuid || '').trim();
		const isOfficialMeta = meta.official === true
			|| String(meta.library || '') === 'chefia-pin-library-v1';
		const isOfficialUuid = uuid.startsWith('chefia-official-');
		if (!isOfficialMeta && !isOfficialUuid) continue;

		try {
			await pocketbaseClient.collection('ai_pin_templates').update(row.id, {
				visibility: 'official',
				status: row.status || 'published',
				deleted_at: '',
			});
			updated += 1;
		} catch {
			// skip row
		}
	}
	return { updated };
}

function buildOwnerFilter(req, query = {}) {
	const scope = String(query.scope || '').trim();
	const library = resolveGalleryLibraryQuery(query);

	return buildMarketplaceGalleryOwnerFilter({
		userId: String(req.pocketbaseUserId || '').trim(),
		workspaceOwnerId: String(req.workspaceOwnerId || req.pocketbaseUserId || '').trim(),
		workspaceId: String(req.workspace?.id || '').trim(),
		scope,
		library,
	});
}

function buildGalleryFilter(req, query) {
	const clauses = [
		buildOwnerFilter(req, query),
		// Match Classic soft-delete semantics: only exclude rows with a deleted_at timestamp.
		'deleted_at = ""',
	];

	const status = String(query.status || '').trim();
	if (status && TEMPLATE_STATUS.includes(status)) {
		if (status === 'published') {
			// Blank status is treated as published for pre-engine rows.
			clauses.push('(status = "published" || status = "")');
		} else {
			clauses.push(`status = "${escapeFilterValue(status)}"`);
		}
	} else if (query.includeArchived !== '1' && query.includeArchived !== 'true') {
		// Include blank status — `status != "archived"` alone can drop legacy rows on some PB builds.
		clauses.push('(status = "" || status != "archived")');
	}

	const category = String(query.category || '').trim();
	if (category && category !== 'pin' && TEMPLATE_CATEGORIES.includes(category)) {
		clauses.push(`(category = "${escapeFilterValue(category)}" || category = "")`);
	}

	const visibility = String(query.visibility || '').trim();
	if (visibility && TEMPLATE_VISIBILITY.includes(visibility)) {
		if (visibility === 'private') {
			clauses.push('(visibility = "private" || visibility = "")');
		} else {
			clauses.push(`visibility = "${escapeFilterValue(visibility)}"`);
		}
	}

	if (query.recentlyUsed === '1' || query.recentlyUsed === 'true') {
		clauses.push('last_used_at != ""');
	}

	return clauses.join(' && ');
}

function sortForQuery(sort) {
	switch (String(sort || '').trim()) {
		case 'used':
		case 'recently_used':
			return '-last_used_at,-updated';
		case 'most_used':
			return '-use_count,-updated';
		case 'alpha':
		case 'alphabetical':
			return 'name';
		case 'created':
		case 'created_date':
			return '-created';
		case 'updated':
		case 'recently_updated':
		default:
			return '-updated';
	}
}

function matchesSearch(item, q) {
	if (!q) return true;
	const needle = q.toLowerCase();
	if (item.name?.toLowerCase().includes(needle)) return true;
	if (item.category?.toLowerCase().includes(needle)) return true;
	if (item.authorName?.toLowerCase().includes(needle)) return true;
	if (item.tags?.some((tag) => tag.toLowerCase().includes(needle))) return true;
	return false;
}

async function pocketbaseGalleryPage(page, perPage, filter, sort) {
	// No expand on list — relation expand failures previously collapsed the gallery to [].
	return pocketbaseClient.collection('ai_pin_templates').getList(page, perPage, {
		filter,
		sort,
		requestKey: null,
	});
}

async function pocketbaseGalleryFullList(filter, sort) {
	return pocketbaseClient.collection('ai_pin_templates').getFullList({
		filter,
		sort,
		requestKey: null,
	});
}

function resolveGalleryChannelQuery(query = {}) {
	return normalizeTemplateChannel(query.channel || query.templatePack || '');
}

async function mapGalleryRecords(req, records, { favoriteIds, accessContext, wantConfig, previewMap }) {
	const mapped = [];
	for (const record of records) {
		const preview = resolvePreview(record, previewMap);
		const access = await evaluateTemplateAccess(req, record, { context: accessContext });
		const item = mapGalleryTemplate(record, {
			isFavorite: favoriteIds.has(record.id),
			previewUrl: preview.previewUrl,
			previewCached: preview.previewCached,
			includeConfiguration: wantConfig && access.enabled,
		});
		mapped.push(attachTemplateAccess(item, access));
	}
	return mapped;
}

function applyPostMapGalleryFilters(items, { q, tag, library = '', collectionTemplateIds = null } = {}) {
	let filtered = items;
	if (collectionTemplateIds instanceof Set) {
		filtered = filtered.filter((item) => collectionTemplateIds.has(item.id));
	}
	if (q) {
		filtered = filtered.filter((item) => matchesSearch(item, q));
	}
	if (tag) {
		filtered = filtered.filter((item) => item.tags.some((t) => t.toLowerCase() === tag));
	}
	if (library === 'premium') {
		filtered = filtered.filter((item) => isPremiumTemplate({
			marketplace_meta: item.marketplace?.meta,
		}));
	}
	return filtered;
}

async function galleryListFacets({ channel = '', library = '' } = {}) {
	const collections = channel
		? await listGalleryCollections({ channel, library })
		: [];
	return {
		categories: TEMPLATE_CATEGORIES,
		statuses: TEMPLATE_STATUS,
		visibilities: TEMPLATE_VISIBILITY,
		channels: TEMPLATE_CHANNELS,
		libraries: MARKETPLACE_LIBRARIES,
		collections,
		scopes: ['mine', 'workspace', 'official', 'community'],
		sorts: ['recently_updated', 'recently_used', 'most_used', 'alphabetical', 'created_date'],
	};
}

async function pocketbaseCount(filter) {
	try {
		const result = await pocketbaseClient.collection('ai_pin_templates').getList(1, 1, {
			filter,
			requestKey: null,
		});
		return Number(result.totalItems) || 0;
	} catch {
		return -1;
	}
}

async function prepareGalleryLibrary() {
	await getPlatformLibraryOwnerId();
	await reconcileSharedLibraryVisibility().catch((error) => {
		logger.warn('[template-gallery] visibility reconcile failed', {
			message: error?.message || String(error),
		});
	});
}

export async function listGalleryTemplates(req, query = {}) {
	assertCapability(req, 'workspace.read');

	// Gallery rows are loaded from PocketBase only — never merged from in-memory catalog.
	if (!query._skipLibraryPrepare) {
		await prepareGalleryLibrary();
	}

	const page = Math.max(1, Number(query.page) || 1);
	const perPage = resolveGalleryPerPage(query);
	const q = String(query.q || query.search || '').trim();
	const tag = String(query.tag || '').trim().toLowerCase();
	const channel = resolveGalleryChannelQuery(query);
	const library = resolveGalleryLibraryQuery(query);
	const collectionSlug = normalizeCollectionSlug(query.collection || query.collectionSlug || '');
	const favoriteOnly = query.favorite === '1' || query.favorite === 'true' || query.favorites === '1';
	const userId = String(req.pocketbaseUserId || '').trim();
	const workspaceId = String(req.workspace?.id || '').trim();
	const collection = 'ai_pin_templates';
	const wantConfig = query.includeConfiguration === '1'
		|| query.includeConfiguration === 'true'
		|| query.includeConfiguration === true;

	const favoriteIds = await listFavoriteTemplateIds(req);
	const filter = buildGalleryFilter(req, query);
	const sort = sortForQuery(query.sort);
	const collectionTemplateIds = collectionSlug && channel
		? await resolveCollectionTemplateIds({ channel, collectionSlug })
		: null;
	const facets = await galleryListFacets({ channel, library });

	const [
		ownerOnlyCount,
		officialOnlyCount,
		blankVisibilityCount,
		privateVisibilityCount,
		workspaceOnlyCount,
		unscopedCount,
	] = await Promise.all([
		userId ? pocketbaseCount(`owner = "${escapeFilterValue(userId)}"`) : Promise.resolve(0),
		pocketbaseCount('visibility = "official"'),
		pocketbaseCount('visibility = ""'),
		pocketbaseCount('visibility = "private"'),
		workspaceId
			? pocketbaseCount(`workspace_id = "${escapeFilterValue(workspaceId)}"`)
			: Promise.resolve(0),
		pocketbaseCount(''),
	]);

	let rawRecords = [];
	let pbCountBeforeTransform = 0;

	try {
		if (channel) {
			const allRows = await pocketbaseGalleryFullList(filter, sort);
			rawRecords = allRows.filter((row) => matchesChannelFilter(row, channel));
			pbCountBeforeTransform = rawRecords.length;
		} else {
			const result = await pocketbaseGalleryPage(page, perPage, filter, sort);
			rawRecords = result.items || [];
			pbCountBeforeTransform = Number(result.totalItems) || 0;
		}
	} catch (error) {
		logger.error('[template-gallery] PocketBase gallery query failed', {
			userId,
			workspaceId,
			collection,
			filter,
			channel,
			message: error?.message || String(error),
			ownerOnlyCount,
			officialOnlyCount,
			blankVisibilityCount,
			privateVisibilityCount,
			workspaceOnlyCount,
			unscopedCount,
		});
		throw httpError(502, 'Template gallery query failed', 'GALLERY_QUERY_FAILED');
	}

	logger.info('[template-gallery] list', {
		userId,
		workspaceId,
		collection,
		filter,
		channel: channel || null,
		library: library || null,
		collection: collectionSlug || null,
		pbCountBeforeTransform,
		ownerOnlyCount,
		officialOnlyCount,
		blankVisibilityCount,
		privateVisibilityCount,
		workspaceOnlyCount,
		unscopedCount,
		page,
		perPage,
	});

	let scopedRecords = rawRecords;
	if (favoriteOnly) {
		scopedRecords = scopedRecords.filter((row) => favoriteIds.has(row.id));
	}

	const previewMap = await loadPreviewUrls(
		channel ? scopedRecords : scopedRecords.slice(0, perPage),
	);
	const accessContext = await resolveAccessContext(req);

	if (channel) {
		const mapped = await mapGalleryRecords(req, scopedRecords, {
			favoriteIds,
			accessContext,
			wantConfig,
			previewMap,
		});
		const filtered = applyPostMapGalleryFilters(mapped, { q, tag, library, collectionTemplateIds });
		const paged = paginateGalleryItems(filtered, page, perPage);
		return {
			...paged,
			facets,
		};
	}

	const mapped = await mapGalleryRecords(req, scopedRecords, {
		favoriteIds,
		accessContext,
		wantConfig,
		previewMap,
	});
	const filtered = applyPostMapGalleryFilters(mapped, { q, tag, library, collectionTemplateIds });

	const postFiltered = favoriteOnly || q || tag || library === 'premium'
		|| collectionTemplateIds instanceof Set;
	const totalItems = postFiltered
		? filtered.length + (page - 1) * perPage // approximate when post-filtered
		: pbCountBeforeTransform;
	const totalPages = Math.max(1, Math.ceil(totalItems / perPage));

	return {
		items: filtered,
		page,
		perPage,
		totalItems,
		totalPages,
		hasMore: page < totalPages,
		facets,
	};
}

/**
 * Paginate through the shared pin template library (same service as gallery + chooser).
 * Used by workspace config so AI Pins and Template Gallery stay in sync.
 */
export async function listPinTemplateLibraryAllPages(req, query = {}) {
	await prepareGalleryLibrary();
	const perPage = resolveGalleryPerPage({ ...query, perPage: query.perPage || 100 });
	let page = 1;
	let totalPages = 1;
	const items = [];
	let totalItems = 0;

	while (page <= totalPages) {
		const result = await listGalleryTemplates(req, { ...query, page, perPage, _skipLibraryPrepare: true });
		items.push(...(result.items || []));
		totalItems = Number(result.totalItems) || items.length;
		totalPages = Math.max(1, Number(result.totalPages) || 1);
		if (!result.hasMore || page >= totalPages) break;
		page += 1;
	}

	return { items, totalItems };
}

/** @alias listGalleryTemplates — single shared library entry point */
export const listPinTemplateLibrary = listGalleryTemplates;

export async function getPinTemplate(req, id) {
	assertCapability(req, 'workspace.read');
	const record = await pocketbaseClient.collection('ai_pin_templates').getOne(id, {
		expand: 'owner,created_by',
	}).catch(() => null);
	if (!record || record.deleted_at) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}

	const isOwner = record.owner === req.workspaceOwnerId
		|| record.owner === req.pocketbaseUserId;
	const sameWorkspace = Boolean(
		record.workspace_id && record.workspace_id === req.workspace?.id,
	) || Boolean(
		record.workspace && record.workspace === req.workspace?.id,
	);
	const visibility = String(record.visibility || '').trim();
	const sharedVisibility = ['workspace', 'public', 'official', 'community'].includes(visibility);
	// Blank visibility is legacy private — never treat as global shared library.
	const isSharedLibrary = visibility === 'official';
	if (!isOwner && !isSharedLibrary && !(sameWorkspace && sharedVisibility)) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}

	const favoriteIds = await listFavoriteTemplateIds(req);
	const previewMap = await loadPreviewUrls([record]);
	const preview = resolvePreview(record, previewMap);
	const access = await evaluateTemplateAccess(req, record);
	const item = mapGalleryTemplate(record, {
		includeConfiguration: access.enabled,
		isFavorite: favoriteIds.has(record.id),
		previewUrl: preview.previewUrl,
		previewCached: preview.previewCached,
	});
	return attachTemplateAccess(item, access);
}

export async function touchPinTemplate(req, id) {
	assertCapability(req, 'workspace.read');
	const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!existing || existing.owner !== req.pocketbaseUserId) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}
	const updated = await pocketbaseClient.collection('ai_pin_templates').update(id, {
		last_used_at: new Date().toISOString(),
		use_count: (Number(existing.use_count) || 0) + 1,
	});
	return attachAllowedAccess(mapGalleryTemplate(updated, { includeConfiguration: false }));
}

export async function setPinTemplateStatus(req, id, status) {
	assertCapability(req, 'workspace.templates.manage');
	if (!TEMPLATE_STATUS.includes(status)) {
		throw httpError(422, 'invalid status', 'VALIDATION_ERROR');
	}
	const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!existing || existing.owner !== req.pocketbaseUserId) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}
	const updated = await pocketbaseClient.collection('ai_pin_templates').update(id, { status });
	return attachAllowedAccess(mapGalleryTemplate(updated));
}

export async function togglePinTemplateFavorite(req, id) {
	assertCapability(req, 'workspace.templates.manage');
	const workspaceId = req.workspace?.id;
	const userId = req.pocketbaseUserId;
	if (!workspaceId) throw httpError(400, 'workspace required', 'WORKSPACE_REQUIRED');

	const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!existing || existing.owner !== userId) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}

	let rows = [];
	try {
		rows = await pocketbaseClient.collection('ai_pin_template_favorites').getFullList({
			filter: pocketbaseClient.filter(
				'workspace_id = {:ws} && created_by = {:user} && template_id = {:tpl}',
				{ ws: workspaceId, user: userId, tpl: id },
			),
			requestKey: null,
		});
	} catch {
		throw httpError(503, 'Favorites not available until migrations apply', 'SCHEMA_UNAVAILABLE');
	}

	const active = rows.find((row) => !row.deleted_at);
	if (active) {
		await pocketbaseClient.collection('ai_pin_template_favorites').update(active.id, {
			deleted_at: new Date().toISOString(),
		});
		return { ok: true, templateId: id, isFavorite: false };
	}

	const soft = rows.find((row) => row.deleted_at);
	if (soft) {
		await pocketbaseClient.collection('ai_pin_template_favorites').update(soft.id, {
			deleted_at: null,
		});
		return { ok: true, templateId: id, isFavorite: true };
	}

	await pocketbaseClient.collection('ai_pin_template_favorites').create({
		workspace_id: workspaceId,
		created_by: userId,
		template_id: id,
	});
	return { ok: true, templateId: id, isFavorite: true };
}

export async function exportPinTemplate(req, id) {
	assertCapability(req, 'workspace.read');
	const record = await pocketbaseClient.collection('ai_pin_templates').getOne(id, {
		expand: 'owner,created_by',
	}).catch(() => null);
	if (!record || record.deleted_at) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}
	await assertTemplateUseAccess(req, record);
	const item = await getPinTemplate(req, id);
	if (!item?.configuration) {
		const access = item?.access || await evaluateTemplateAccess(req, record);
		throw featureLockedError(
			{ ...access, requiredKeys: access.requiredKeys || item?.requiredFeatureKeys || [] },
			{
				featureKey: access.requiredKeys?.[0] || item?.requiredFeatureKeys?.[0],
				message: 'This template requires a plan upgrade to use.',
			},
		);
	}
	return {
		format: 'pinblog-template-package',
		version: 1,
		exportedAt: new Date().toISOString(),
		marketplaceReady: true,
		template: {
			templateUuid: item.templateUuid,
			name: item.name,
			category: item.category,
			status: item.status,
			visibility: item.visibility,
			tags: item.tags,
			editorVersion: item.editorVersion,
			schemaVersion: item.schemaVersion,
			configuration: item.configuration,
			thumbnail: item.thumbnail,
			configChecksum: item.configChecksum,
			marketplace: item.marketplace,
		},
	};
}

export async function bulkPinTemplateAction(req, payload = {}) {
	assertCapability(req, 'workspace.templates.manage');
	const action = String(payload.action || '').trim();
	const ids = Array.isArray(payload.ids) ? payload.ids.map(String).filter(Boolean) : [];
	if (!ids.length) throw httpError(422, 'ids required', 'VALIDATION_ERROR');

	const results = [];
	for (const id of ids) {
		try {
			if (action === 'delete') {
				await pocketbaseClient.collection('ai_pin_templates').update(id, {
					deleted_at: new Date().toISOString(),
					status: 'archived',
				}).catch(async () => {
					await pocketbaseClient.collection('ai_pin_templates').delete(id);
				});
				results.push({ id, ok: true, action });
			} else if (action === 'archive') {
				await setPinTemplateStatus(req, id, 'archived');
				results.push({ id, ok: true, action });
			} else if (action === 'restore') {
				await setPinTemplateStatus(req, id, 'draft');
				results.push({ id, ok: true, action });
			} else if (action === 'duplicate') {
				const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id);
				await assertTemplateUseAccess(req, existing);
				const created = await pocketbaseClient.collection('ai_pin_templates').create({
					owner: req.pocketbaseUserId,
					workspace_id: existing.workspace_id || req.workspace?.id || null,
					created_by: req.pocketbaseUserId,
					name: `${existing.name} Copy`,
					thumbnail: existing.thumbnail || '',
					configuration: existing.configuration || {},
					is_default: false,
					category: existing.category || 'general',
					status: 'draft',
					visibility: existing.visibility || 'private',
					template_uuid: createTemplateUuid(),
					config_checksum: existing.config_checksum || '',
					editor_version: existing.editor_version || 1,
					schema_version: existing.schema_version || 1,
					revision: 1,
					marketplace_meta: existing.marketplace_meta || null,
				});
				results.push({ id, ok: true, action, createdId: created.id });
			} else if (action === 'export') {
				const pack = await exportPinTemplate(req, id);
				results.push({ id, ok: true, action, package: pack });
			} else {
				results.push({ id, ok: false, error: 'unknown_action' });
			}
		} catch (error) {
			results.push({ id, ok: false, error: error.message || 'failed' });
		}
	}
	return { results };
}

/**
 * Upsert preview cache entry. Invalidation is checksum-based (never timestamps alone).
 */
export async function upsertTemplatePreviewCache(req, payload = {}) {
	assertCapability(req, 'workspace.templates.manage');
	const templateId = String(payload.templateId || '').trim();
	const configChecksum = String(payload.configChecksum || '').trim().toLowerCase();
	const format = String(payload.format || 'png').toLowerCase();
	const imageUrl = String(payload.imageUrl || '').trim();
	if (!templateId || !configChecksum || !imageUrl) {
		throw httpError(422, 'templateId, configChecksum, imageUrl required', 'VALIDATION_ERROR');
	}

	const workspaceId = req.workspace?.id;
	let existing = [];
	try {
		existing = await pocketbaseClient.collection('ai_pin_template_preview_cache').getFullList({
			filter: pocketbaseClient.filter(
				'template_id = {:tpl} && config_checksum = {:sum} && format = {:fmt}',
				{ tpl: templateId, sum: configChecksum, fmt: format },
			),
			requestKey: null,
		});
	} catch {
		throw httpError(503, 'Preview cache unavailable until migrations apply', 'SCHEMA_UNAVAILABLE');
	}

	const body = {
		workspace_id: workspaceId,
		created_by: req.pocketbaseUserId,
		template_id: templateId,
		config_checksum: configChecksum,
		format,
		image_url: imageUrl,
		deleted_at: null,
		expires_at: payload.expiresAt || null,
	};

	if (existing[0]) {
		const updated = await pocketbaseClient.collection('ai_pin_template_preview_cache').update(existing[0].id, body);
		return { ok: true, id: updated.id, cached: true };
	}
	const created = await pocketbaseClient.collection('ai_pin_template_preview_cache').create(body);
	return { ok: true, id: created.id, cached: true };
}

export async function getTemplatePreviewFromCache(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const templateId = String(query.templateId || '').trim();
	const configChecksum = String(query.configChecksum || '').trim().toLowerCase();
	const format = String(query.format || 'png').toLowerCase();
	if (!templateId || !configChecksum) {
		throw httpError(422, 'templateId and configChecksum required', 'VALIDATION_ERROR');
	}

	try {
		const rows = await pocketbaseClient.collection('ai_pin_template_preview_cache').getFullList({
			filter: pocketbaseClient.filter(
				'template_id = {:tpl} && config_checksum = {:sum} && format = {:fmt} && deleted_at = ""',
				{ tpl: templateId, sum: configChecksum, fmt: format },
			),
			requestKey: null,
		});
		const hit = rows[0];
		if (!hit?.image_url) {
			return { hit: false, imageUrl: null };
		}
		return {
			hit: true,
			imageUrl: hit.image_url,
			configChecksum,
			format,
			templateId,
		};
	} catch {
		return { hit: false, imageUrl: null };
	}
}

export { hashTemplateConfigurationSync };
