/**
 * Phase 2 — Admin CMS for Official marketplace templates.
 * DB is source of truth after bootstrap; seeder does not overwrite Admin edits (Phase 1).
 */

import crypto from 'node:crypto';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_STATUS,
	TEMPLATE_VISIBILITY,
} from '../../constants/pin-engine.js';
import { normalizeTemplateChannel } from '../../constants/template-channels.js';
import { resolvePlatformLibraryOwnerId } from '../official-pin-templates-seed.js';
import {
	sanitizeMarketplaceMeta,
	sanitizeTemplateName,
	validateTemplateConfiguration,
} from '../../utils/template-config-validation.js';
import { loadTemplateCollectionMap } from '../template-collections.js';
import { setAdminTemplateCollections } from './template-collections.js';

function escapeFilterValue(value) {
	return String(value || '').replace(/"/g, '\\"');
}

function checksumOf(configuration) {
	return crypto
		.createHash('sha256')
		.update(JSON.stringify(configuration || {}))
		.digest('hex')
		.slice(0, 32);
}

function normalizeTemplateUuid(value) {
	return String(value || '').trim().slice(0, 200);
}

function mapAdminMarketplaceTemplate(record, extras = {}) {
	const meta = record.marketplace_meta && typeof record.marketplace_meta === 'object'
		? record.marketplace_meta
		: {};
	return {
		id: record.id,
		name: record.name,
		templateUuid: record.template_uuid || null,
		thumbnail: record.thumbnail || '',
		category: record.category || 'general',
		status: record.status || 'published',
		visibility: record.visibility || 'official',
		channel: normalizeTemplateChannel(meta.channel || meta.pack) || 'pinterest',
		configChecksum: record.config_checksum || '',
		configuration: extras.includeConfiguration ? (record.configuration || {}) : undefined,
		marketplaceMeta: meta,
		collections: extras.collections || [],
		editorVersion: Number(record.editor_version) || 1,
		schemaVersion: Number(record.schema_version) || 1,
		revision: Number(record.revision) || 1,
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

function buildOfficialListFilter(query = {}) {
	const parts = ['visibility = "official"', 'deleted_at = ""'];
	const status = String(query.status || '').trim();
	if (status && TEMPLATE_STATUS.includes(status)) {
		parts.push(`status = "${escapeFilterValue(status)}"`);
	} else {
		parts.push('(status = "published" || status = "" || status = "draft")');
	}
	const category = String(query.category || '').trim();
	if (category && TEMPLATE_CATEGORIES.includes(category)) {
		parts.push(`category = "${escapeFilterValue(category)}"`);
	}
	return parts.join(' && ');
}

export function getMarketplaceTemplateFacets() {
	return {
		categories: TEMPLATE_CATEGORIES,
		statuses: TEMPLATE_STATUS,
		visibilities: TEMPLATE_VISIBILITY.filter((v) => v === 'official' || v === 'community'),
		channels: ['pinterest', 'facebook', 'instagram', 'linkedin', 'twitter'],
	};
}

export async function listAdminMarketplaceTemplates(query = {}) {
	const channel = normalizeTemplateChannel(query.channel);
	const q = String(query.q || '').trim().toLowerCase();
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(Math.max(1, Number(query.perPage) || 50), 200);

	const rows = await pocketbaseClient.collection('ai_pin_templates').getFullList({
		filter: buildOfficialListFilter(query),
		sort: '-updated',
		requestKey: null,
	}).catch(() => []);

	let filtered = rows;
	if (channel) {
		filtered = filtered.filter((row) => {
			const meta = row.marketplace_meta && typeof row.marketplace_meta === 'object'
				? row.marketplace_meta
				: {};
			return normalizeTemplateChannel(meta.channel || meta.pack) === channel;
		});
	}
	if (q) {
		filtered = filtered.filter((row) => (
			row.name?.toLowerCase().includes(q)
			|| row.template_uuid?.toLowerCase().includes(q)
			|| row.category?.toLowerCase().includes(q)
		));
	}

	const totalItems = filtered.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
	const slice = filtered.slice((page - 1) * perPage, page * perPage);
	const collectionMap = await loadTemplateCollectionMap(slice.map((row) => row.id));

	const items = slice.map((row) => mapAdminMarketplaceTemplate(row, {
		collections: collectionMap.get(row.id) || [],
	}));

	return {
		items,
		page,
		perPage,
		totalItems,
		totalPages,
		hasMore: page < totalPages,
		facets: getMarketplaceTemplateFacets(),
	};
}

export async function getAdminMarketplaceTemplate(id, { includeConfiguration = false } = {}) {
	const record = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!record || record.visibility !== 'official') {
		throw httpError(404, 'Official template not found', 'NOT_FOUND');
	}
	const collectionMap = await loadTemplateCollectionMap([id]);
	return mapAdminMarketplaceTemplate(record, {
		includeConfiguration,
		collections: collectionMap.get(id) || [],
	});
}

export async function createAdminMarketplaceTemplate(payload = {}, adminUser = null) {
	const ownerId = await resolvePlatformLibraryOwnerId();
	if (!ownerId) throw httpError(503, 'Platform owner not available', 'PLATFORM_OWNER_MISSING');

	const name = sanitizeTemplateName(payload.name);
	if (!String(payload.name || '').trim()) throw httpError(422, 'name is required', 'VALIDATION_ERROR');

	const channel = normalizeTemplateChannel(payload.channel);
	if (!channel) throw httpError(422, 'channel is required', 'VALIDATION_ERROR');

	const templateUuid = normalizeTemplateUuid(payload.templateUuid || payload.template_uuid);
	if (!templateUuid) throw httpError(422, 'templateUuid is required', 'VALIDATION_ERROR');

	const existing = await pocketbaseClient.collection('ai_pin_templates').getFullList({
		filter: `template_uuid = "${escapeFilterValue(templateUuid)}"`,
		requestKey: null,
	}).catch(() => []);
	if (existing.length) {
		throw httpError(409, 'templateUuid already exists', 'TEMPLATE_UUID_EXISTS');
	}

	const validated = validateTemplateConfiguration(payload.configuration || {});
	if (!validated.ok) {
		const error = httpError(422, 'Invalid template configuration', 'TEMPLATE_CONFIG_INVALID');
		error.details = { issues: validated.issues };
		throw error;
	}

	const configuration = validated.configuration;
	const checksum = checksumOf(configuration);
	const category = TEMPLATE_CATEGORIES.includes(String(payload.category || '').trim())
		? String(payload.category).trim()
		: 'general';

	const marketplaceMeta = sanitizeMarketplaceMeta({
		official: true,
		channel,
		pack: channel,
		library: payload.marketplaceMeta?.library || payload.marketplace_meta?.library || 'official',
		tags: payload.tags || payload.marketplaceMeta?.tags || [],
		...(payload.marketplaceMeta || payload.marketplace_meta || {}),
	});

	const created = await pocketbaseClient.collection('ai_pin_templates').create({
		owner: ownerId,
		created_by: adminUser?.id || ownerId,
		name,
		thumbnail: String(payload.thumbnail || '').slice(0, 2000),
		configuration,
		is_default: false,
		category,
		status: TEMPLATE_STATUS.includes(String(payload.status || '').trim())
			? String(payload.status).trim()
			: 'draft',
		visibility: 'official',
		template_uuid: templateUuid,
		config_checksum: checksum,
		revision: 1,
		editor_version: Number(payload.editorVersion ?? payload.editor_version) || 1,
		schema_version: Number(payload.schemaVersion ?? payload.schema_version) || 1,
		marketplace_meta: marketplaceMeta,
		deleted_at: '',
	});

	if (Array.isArray(payload.collectionIds) && payload.collectionIds.length) {
		await setAdminTemplateCollections(created.id, payload.collectionIds, adminUser);
	}

	return getAdminMarketplaceTemplate(created.id);
}

export async function updateAdminMarketplaceTemplate(id, payload = {}, adminUser = null) {
	const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!existing || existing.visibility !== 'official') {
		throw httpError(404, 'Official template not found', 'NOT_FOUND');
	}

	const updates = {};

	if (payload.name != null) {
		const name = sanitizeTemplateName(payload.name);
		if (!String(payload.name || '').trim()) throw httpError(422, 'name cannot be empty', 'VALIDATION_ERROR');
		updates.name = name;
	}
	if (payload.thumbnail != null) updates.thumbnail = String(payload.thumbnail || '').slice(0, 2000);
	if (payload.category != null) {
		const category = String(payload.category || '').trim();
		if (category && TEMPLATE_CATEGORIES.includes(category)) updates.category = category;
	}
	if (payload.status != null) {
		const status = String(payload.status || '').trim();
		if (TEMPLATE_STATUS.includes(status)) updates.status = status;
	}
	if (payload.configuration != null) {
		const validated = validateTemplateConfiguration(payload.configuration);
		if (!validated.ok) {
			const error = httpError(422, 'Invalid template configuration', 'TEMPLATE_CONFIG_INVALID');
			error.details = { issues: validated.issues };
			throw error;
		}
		updates.configuration = validated.configuration;
		updates.config_checksum = checksumOf(validated.configuration);
		updates.revision = (Number(existing.revision) || 1) + 1;
	}

	const channel = payload.channel != null ? normalizeTemplateChannel(payload.channel) : '';
	const metaPatch = payload.marketplaceMeta || payload.marketplace_meta;
	if (channel || metaPatch) {
		const currentMeta = existing.marketplace_meta && typeof existing.marketplace_meta === 'object'
			? existing.marketplace_meta
			: {};
		updates.marketplace_meta = sanitizeMarketplaceMeta({
			...currentMeta,
			...(metaPatch && typeof metaPatch === 'object' ? metaPatch : {}),
			official: true,
			...(channel ? { channel, pack: channel } : {}),
		});
	}

	const updated = await pocketbaseClient.collection('ai_pin_templates').update(id, updates);

	if (Array.isArray(payload.collectionIds)) {
		await setAdminTemplateCollections(id, payload.collectionIds, adminUser);
	}

	return getAdminMarketplaceTemplate(updated.id, {
		includeConfiguration: payload.includeConfiguration === true,
	});
}

export async function archiveAdminMarketplaceTemplate(id) {
	const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!existing || existing.visibility !== 'official') {
		throw httpError(404, 'Official template not found', 'NOT_FOUND');
	}
	await pocketbaseClient.collection('ai_pin_templates').update(id, { status: 'archived' });
	return { ok: true, id, status: 'archived' };
}
