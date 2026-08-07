/**
 * Phase 2 — Admin CMS for marketplace template collections.
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import {
	COLLECTION_LIBRARY_SCOPES,
	COLLECTION_STATUS,
	normalizeCollectionChannel,
	normalizeCollectionLibraryScope,
	normalizeCollectionSlug,
	normalizeCollectionStatus,
} from '../../constants/template-collections.js';
import { loadTemplateCollectionMap } from '../template-collections.js';

function escapeFilterValue(value) {
	return String(value || '').replace(/"/g, '\\"');
}

function mapCollection(record, extras = {}) {
	return {
		id: record.id,
		slug: record.slug,
		name: record.name,
		channel: record.channel,
		libraryScope: record.library_scope || 'official',
		description: record.description || '',
		coverImageUrl: record.cover_image_url || '',
		sortOrder: Number(record.sort_order) || 0,
		status: record.status || 'draft',
		memberCount: Number(extras.memberCount) || 0,
		members: extras.members || undefined,
		createdAt: record.created,
		updatedAt: record.updated,
		createdBy: record.created_by || null,
		updatedBy: record.updated_by || null,
	};
}

function mapMember(record, collection = null, template = null) {
	return {
		id: record.id,
		collectionId: record.collection_id,
		templateId: record.template_id,
		sortOrder: Number(record.sort_order) || 0,
		featured: Boolean(record.featured),
		collection: collection ? { id: collection.id, slug: collection.slug, name: collection.name } : undefined,
		template: template ? { id: template.id, name: template.name, templateUuid: template.template_uuid || null } : undefined,
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

async function countMembers(collectionId) {
	try {
		const result = await pocketbaseClient.collection('template_collection_members').getList(1, 1, {
			filter: `collection_id = "${escapeFilterValue(collectionId)}"`,
			requestKey: null,
		});
		return Number(result.totalItems) || 0;
	} catch {
		return 0;
	}
}

async function findCollectionByChannelSlug(channel, slug) {
	const rows = await pocketbaseClient.collection('template_collections').getFullList({
		filter: `channel = "${escapeFilterValue(channel)}" && slug = "${escapeFilterValue(slug)}"`,
		requestKey: null,
	}).catch(() => []);
	return rows[0] || null;
}

export function getTemplateCollectionFacets() {
	return {
		channels: ['pinterest', 'facebook', 'instagram', 'linkedin', 'twitter'],
		libraryScopes: COLLECTION_LIBRARY_SCOPES,
		statuses: COLLECTION_STATUS,
	};
}

export async function listAdminTemplateCollections(query = {}) {
	const channel = normalizeCollectionChannel(query.channel);
	const status = String(query.status || '').trim().toLowerCase();
	const q = String(query.q || '').trim().toLowerCase();

	let filter = '';
	const parts = [];
	if (channel) parts.push(`channel = "${escapeFilterValue(channel)}"`);
	if (status && COLLECTION_STATUS.includes(status)) {
		parts.push(`status = "${escapeFilterValue(status)}"`);
	}
	filter = parts.join(' && ');

	const rows = await pocketbaseClient.collection('template_collections').getFullList({
		filter: filter || undefined,
		sort: 'sort_order,name',
		requestKey: null,
	}).catch(() => []);

	const filtered = q
		? rows.filter((row) => (
			row.name?.toLowerCase().includes(q) || row.slug?.toLowerCase().includes(q)
		))
		: rows;

	const items = await Promise.all(filtered.map(async (row) => {
		const memberCount = await countMembers(row.id);
		return mapCollection(row, { memberCount });
	}));

	return { items, totalItems: items.length, facets: getTemplateCollectionFacets() };
}

export async function getAdminTemplateCollection(id) {
	const record = await pocketbaseClient.collection('template_collections').getOne(id).catch(() => null);
	if (!record) throw httpError(404, 'Collection not found', 'NOT_FOUND');

	const members = await pocketbaseClient.collection('template_collection_members').getFullList({
		filter: `collection_id = "${escapeFilterValue(id)}"`,
		sort: 'sort_order',
		requestKey: null,
	}).catch(() => []);

	const templateIds = members.map((row) => row.template_id).filter(Boolean);
	const templates = templateIds.length
		? await pocketbaseClient.collection('ai_pin_templates').getFullList({
			filter: templateIds.map((tid) => `id = "${escapeFilterValue(tid)}"`).join(' || '),
			fields: 'id,name,template_uuid,visibility,status,category',
			requestKey: null,
		}).catch(() => [])
		: [];
	const templateById = new Map(templates.map((row) => [row.id, row]));

	return mapCollection(record, {
		memberCount: members.length,
		members: members.map((row) => mapMember(row, record, templateById.get(row.template_id))),
	});
}

export async function createAdminTemplateCollection(payload = {}, adminUser = null) {
	const channel = normalizeCollectionChannel(payload.channel);
	if (!channel) throw httpError(422, 'channel is required', 'VALIDATION_ERROR');

	const slug = normalizeCollectionSlug(payload.slug || payload.name);
	if (!slug) throw httpError(422, 'slug is required', 'VALIDATION_ERROR');

	const name = String(payload.name || '').trim().slice(0, 200);
	if (!name) throw httpError(422, 'name is required', 'VALIDATION_ERROR');

	const existing = await findCollectionByChannelSlug(channel, slug);
	if (existing) {
		throw httpError(409, 'Collection slug already exists for this channel', 'COLLECTION_SLUG_EXISTS');
	}

	const created = await pocketbaseClient.collection('template_collections').create({
		slug,
		name,
		channel,
		library_scope: normalizeCollectionLibraryScope(payload.libraryScope || payload.library_scope),
		description: String(payload.description || '').slice(0, 2000),
		cover_image_url: String(payload.coverImageUrl || payload.cover_image_url || '').slice(0, 4000),
		sort_order: Number(payload.sortOrder ?? payload.sort_order) || 0,
		status: normalizeCollectionStatus(payload.status || 'draft'),
		created_by: adminUser?.id || null,
		updated_by: adminUser?.id || null,
	});

	return mapCollection(created, { memberCount: 0 });
}

export async function updateAdminTemplateCollection(id, payload = {}, adminUser = null) {
	const existing = await pocketbaseClient.collection('template_collections').getOne(id).catch(() => null);
	if (!existing) throw httpError(404, 'Collection not found', 'NOT_FOUND');

	const updates = { updated_by: adminUser?.id || null };

	if (payload.name != null) {
		const name = String(payload.name || '').trim().slice(0, 200);
		if (!name) throw httpError(422, 'name cannot be empty', 'VALIDATION_ERROR');
		updates.name = name;
	}
	if (payload.slug != null) {
		const slug = normalizeCollectionSlug(payload.slug);
		if (!slug) throw httpError(422, 'slug cannot be empty', 'VALIDATION_ERROR');
		if (slug !== existing.slug) {
			const conflict = await findCollectionByChannelSlug(existing.channel, slug);
			if (conflict && conflict.id !== id) {
				throw httpError(409, 'Collection slug already exists for this channel', 'COLLECTION_SLUG_EXISTS');
			}
			updates.slug = slug;
		}
	}
	if (payload.libraryScope != null || payload.library_scope != null) {
		updates.library_scope = normalizeCollectionLibraryScope(payload.libraryScope ?? payload.library_scope);
	}
	if (payload.description != null) updates.description = String(payload.description || '').slice(0, 2000);
	if (payload.coverImageUrl != null || payload.cover_image_url != null) {
		updates.cover_image_url = String(payload.coverImageUrl ?? payload.cover_image_url ?? '').slice(0, 4000);
	}
	if (payload.sortOrder != null || payload.sort_order != null) {
		updates.sort_order = Number(payload.sortOrder ?? payload.sort_order) || 0;
	}
	if (payload.status != null) updates.status = normalizeCollectionStatus(payload.status);

	const updated = await pocketbaseClient.collection('template_collections').update(id, updates);
	const memberCount = await countMembers(id);
	return mapCollection(updated, { memberCount });
}

export async function deleteAdminTemplateCollection(id) {
	const existing = await pocketbaseClient.collection('template_collections').getOne(id).catch(() => null);
	if (!existing) throw httpError(404, 'Collection not found', 'NOT_FOUND');
	await pocketbaseClient.collection('template_collections').delete(id);
	return { ok: true, id };
}

export async function addAdminCollectionMember(collectionId, payload = {}, adminUser = null) {
	const collection = await pocketbaseClient.collection('template_collections').getOne(collectionId).catch(() => null);
	if (!collection) throw httpError(404, 'Collection not found', 'NOT_FOUND');

	const templateId = String(payload.templateId || payload.template_id || '').trim();
	if (!templateId) throw httpError(422, 'templateId is required', 'VALIDATION_ERROR');

	const template = await pocketbaseClient.collection('ai_pin_templates').getOne(templateId).catch(() => null);
	if (!template) throw httpError(404, 'Template not found', 'NOT_FOUND');
	if (template.visibility !== 'official') {
		throw httpError(422, 'Only official marketplace templates can join collections', 'VALIDATION_ERROR');
	}

	const duplicate = await pocketbaseClient.collection('template_collection_members').getFullList({
		filter: `collection_id = "${escapeFilterValue(collectionId)}" && template_id = "${escapeFilterValue(templateId)}"`,
		requestKey: null,
	}).catch(() => []);
	if (duplicate.length) {
		throw httpError(409, 'Template is already in this collection', 'MEMBER_EXISTS');
	}

	const created = await pocketbaseClient.collection('template_collection_members').create({
		collection_id: collectionId,
		template_id: templateId,
		sort_order: Number(payload.sortOrder ?? payload.sort_order) || 0,
		featured: Boolean(payload.featured),
		created_by: adminUser?.id || null,
	});

	return mapMember(created, collection, template);
}

export async function updateAdminCollectionMember(memberId, payload = {}) {
	const existing = await pocketbaseClient.collection('template_collection_members').getOne(memberId).catch(() => null);
	if (!existing) throw httpError(404, 'Collection member not found', 'NOT_FOUND');

	const updates = {};
	if (payload.sortOrder != null || payload.sort_order != null) {
		updates.sort_order = Number(payload.sortOrder ?? payload.sort_order) || 0;
	}
	if (payload.featured != null) updates.featured = Boolean(payload.featured);

	const updated = await pocketbaseClient.collection('template_collection_members').update(memberId, updates);
	return mapMember(updated);
}

export async function removeAdminCollectionMember(memberId) {
	const existing = await pocketbaseClient.collection('template_collection_members').getOne(memberId).catch(() => null);
	if (!existing) throw httpError(404, 'Collection member not found', 'NOT_FOUND');
	await pocketbaseClient.collection('template_collection_members').delete(memberId);
	return { ok: true, id: memberId };
}

export async function setAdminTemplateCollections(templateId, collectionIds = [], adminUser = null) {
	const template = await pocketbaseClient.collection('ai_pin_templates').getOne(templateId).catch(() => null);
	if (!template) throw httpError(404, 'Template not found', 'NOT_FOUND');

	const normalizedIds = [...new Set((collectionIds || []).map((id) => String(id || '').trim()).filter(Boolean))];

	const existingMembers = await pocketbaseClient.collection('template_collection_members').getFullList({
		filter: `template_id = "${escapeFilterValue(templateId)}"`,
		requestKey: null,
	}).catch(() => []);

	const existingIds = new Set(existingMembers.map((row) => row.collection_id));
	const targetIds = new Set(normalizedIds);

	for (const member of existingMembers) {
		if (!targetIds.has(member.collection_id)) {
			await pocketbaseClient.collection('template_collection_members').delete(member.id);
		}
	}

	for (const collectionId of normalizedIds) {
		if (existingIds.has(collectionId)) continue;
		await pocketbaseClient.collection('template_collection_members').create({
			collection_id: collectionId,
			template_id: templateId,
			sort_order: 0,
			featured: false,
			created_by: adminUser?.id || null,
		});
	}

	const collectionMap = await loadTemplateCollectionMap([templateId]);
	return collectionMap.get(templateId) || [];
}
