/**
 * Template Gallery — paginated list, favorites, touch, status, export, preview cache.
 * Marketplace-ready filters (visibility) without hardcoding marketplace UI.
 */

import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_STATUS,
	TEMPLATE_VISIBILITY,
} from '../constants/pin-engine.js';
import { createTemplateUuid, hashTemplateConfigurationSync } from '../utils/pin-template-identity.js';

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

function buildOwnerFilter(req) {
	const ownerId = req.pocketbaseUserId;
	const workspaceId = req.workspace?.id;
	const parts = [`owner = "${escapeFilterValue(ownerId)}"`];
	if (workspaceId) {
		parts.push(`workspace_id = "${escapeFilterValue(workspaceId)}"`);
	}
	// Platform built-in library — visible to every authenticated workspace user.
	parts.push(`visibility = "official"`);
	return `(${parts.join(' || ')})`;
}

function buildGalleryFilter(req, query) {
	const clauses = [buildOwnerFilter(req), 'deleted_at = ""'];

	const status = String(query.status || '').trim();
	if (status && TEMPLATE_STATUS.includes(status)) {
		if (status === 'published') {
			// Treat missing/blank status as published for backward compat with seeded rows
			clauses.push('(status = "published" || status = "")');
		} else {
			clauses.push(`status = "${escapeFilterValue(status)}"`);
		}
	} else if (query.includeArchived !== '1' && query.includeArchived !== 'true') {
		clauses.push(`(status = "" || status != "archived")`);
	}

	const category = String(query.category || '').trim();
	if (category && category !== 'pin' && TEMPLATE_CATEGORIES.includes(category)) {
		clauses.push(`(category = "${escapeFilterValue(category)}" || category = "")`);
	}

	const visibility = String(query.visibility || '').trim();
	if (visibility && TEMPLATE_VISIBILITY.includes(visibility)) {
		if (visibility === 'private') {
			clauses.push(`(visibility = "private" || visibility = "")`);
		} else {
			clauses.push(`visibility = "${escapeFilterValue(visibility)}"`);
		}
	}

	const scope = String(query.scope || '').trim();
	if (scope === 'mine') {
		clauses.push(`owner = "${escapeFilterValue(req.pocketbaseUserId)}"`);
	} else if (scope === 'workspace' && req.workspace?.id) {
		clauses.push(`workspace_id = "${escapeFilterValue(req.workspace.id)}"`);
	} else if (scope === 'official') {
		clauses.push(`visibility = "official"`);
	} else if (scope === 'community') {
		clauses.push(`visibility = "community"`);
	}

	if (query.recentlyUsed === '1' || query.recentlyUsed === 'true') {
		clauses.push(`last_used_at != ""`);
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

export async function listGalleryTemplates(req, query = {}) {
	assertCapability(req, 'workspace.read');

	const page = Math.max(1, Number(query.page) || 1);
	// No low artificial page-size cap — client controls page size for gallery scrolling.
	const perPage = Math.max(1, Number(query.perPage) || 24);
	const q = String(query.q || query.search || '').trim();
	const favoriteOnly = query.favorite === '1' || query.favorite === 'true' || query.favorites === '1';

	const favoriteIds = await listFavoriteTemplateIds(req);
	const filter = buildGalleryFilter(req, query);
	const sort = sortForQuery(query.sort);

	let result;
	try {
		result = await pocketbaseClient.collection('ai_pin_templates').getList(page, perPage, {
			filter,
			sort,
			expand: 'owner,created_by',
			requestKey: null,
		});
	} catch (error) {
		// Fallback for environments missing new fields/indexes — still include official library.
		console.warn('[template-gallery] primary filter failed; using owner+official fallback', {
			message: error?.message || String(error),
			filter,
		});
		const all = await pocketbaseClient.collection('ai_pin_templates').getFullList({
			filter: pocketbaseClient.filter(
				'owner = {:owner} || visibility = "official"',
				{ owner: req.pocketbaseUserId },
			),
			sort: '-updated',
			requestKey: null,
		}).catch(() => []);
		const includeArchived = query.includeArchived === '1' || query.includeArchived === 'true';
		const status = String(query.status || '').trim();
		const filtered = all.filter((row) => {
			if (row.deleted_at) return false;
			const rowStatus = String(row.status || '').trim();
			if (status === 'published') {
				return !rowStatus || rowStatus === 'published';
			}
			if (!includeArchived && rowStatus === 'archived') return false;
			return true;
		});
		result = {
			items: filtered.slice((page - 1) * perPage, page * perPage),
			page,
			perPage,
			totalItems: filtered.length,
			totalPages: Math.max(1, Math.ceil(filtered.length / perPage)),
		};
	}

	let items = result.items || [];
	if (favoriteOnly) {
		items = items.filter((row) => favoriteIds.has(row.id));
	}

	const previewMap = await loadPreviewUrls(items);
	let mapped = items.map((record) => {
		const preview = resolvePreview(record, previewMap);
		return mapGalleryTemplate(record, {
			isFavorite: favoriteIds.has(record.id),
			previewUrl: preview.previewUrl,
			previewCached: preview.previewCached,
		});
	});

	if (q) {
		mapped = mapped.filter((item) => matchesSearch(item, q));
	}

	// Tag exact filter
	const tag = String(query.tag || '').trim().toLowerCase();
	if (tag) {
		mapped = mapped.filter((item) => item.tags.some((t) => t.toLowerCase() === tag));
	}

	const totalItems = favoriteOnly || q || tag
		? mapped.length + (page - 1) * perPage // approximate when post-filtered
		: (result.totalItems || mapped.length);

	return {
		items: mapped,
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems ?? totalItems,
		totalPages: result.totalPages || Math.max(1, Math.ceil((result.totalItems || mapped.length) / perPage)),
		hasMore: (result.page || page) < (result.totalPages || 1),
		facets: {
			categories: TEMPLATE_CATEGORIES,
			statuses: TEMPLATE_STATUS,
			visibilities: TEMPLATE_VISIBILITY,
			scopes: ['mine', 'workspace', 'official', 'community'],
			sorts: ['recently_updated', 'recently_used', 'most_used', 'alphabetical', 'created_date'],
		},
	};
}

export async function getPinTemplate(req, id) {
	assertCapability(req, 'workspace.read');
	const record = await pocketbaseClient.collection('ai_pin_templates').getOne(id, {
		expand: 'owner,created_by',
	}).catch(() => null);
	if (!record || record.deleted_at) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}

	const isOwner = record.owner === req.pocketbaseUserId;
	const sameWorkspace = record.workspace_id && record.workspace_id === req.workspace?.id;
	const sharedVisibility = ['workspace', 'public', 'official', 'community'].includes(record.visibility);
	const isOfficialLibrary = record.visibility === 'official';
	if (!isOwner && !isOfficialLibrary && !(sameWorkspace && sharedVisibility)) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}

	const favoriteIds = await listFavoriteTemplateIds(req);
	const previewMap = await loadPreviewUrls([record]);
	const preview = resolvePreview(record, previewMap);
	return mapGalleryTemplate(record, {
		includeConfiguration: true,
		isFavorite: favoriteIds.has(record.id),
		previewUrl: preview.previewUrl,
		previewCached: preview.previewCached,
	});
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
	return mapGalleryTemplate(updated, { includeConfiguration: false });
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
	return mapGalleryTemplate(updated);
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
	const item = await getPinTemplate(req, id);
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
