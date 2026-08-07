/**
 * Phase 2 — read-only template collection helpers for gallery facets and filters.
 * Admin CRUD lives in services/admin/template-collections.js.
 */

import pocketbaseClient from '../utils/pocketbaseClient.js';
import {
	collectionMatchesLibraryScope,
	isPublishedCollection,
	normalizeCollectionChannel,
	normalizeCollectionSlug,
} from '../constants/template-collections.js';

function escapeFilterValue(value) {
	return String(value || '').replace(/"/g, '\\"');
}

function mapCollectionRecord(record, memberCount = 0) {
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
		memberCount,
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

async function countMembersForCollections(collectionIds = []) {
	const counts = new Map();
	if (!collectionIds.length) return counts;

	try {
		const rows = await pocketbaseClient.collection('template_collection_members').getFullList({
			fields: 'id,collection_id',
			requestKey: null,
		});
		for (const row of rows) {
			const id = row.collection_id;
			if (!collectionIds.includes(id)) continue;
			counts.set(id, (counts.get(id) || 0) + 1);
		}
	} catch {
		// Collection tables optional until migration applied
	}
	return counts;
}

/**
 * List published collections for gallery facets (customer-facing).
 */
export async function listGalleryCollections({ channel = '', library = '' } = {}) {
	const normalizedChannel = normalizeCollectionChannel(channel);
	if (!normalizedChannel) return [];

	try {
		const filterParts = ['status = "published"'];
		filterParts.push(`channel = "${escapeFilterValue(normalizedChannel)}"`);
		const rows = await pocketbaseClient.collection('template_collections').getFullList({
			filter: filterParts.join(' && '),
			sort: 'sort_order,name',
			requestKey: null,
		});

		const eligible = rows.filter((row) => (
			isPublishedCollection(row) && collectionMatchesLibraryScope(row, library)
		));
		const memberCounts = await countMembersForCollections(eligible.map((row) => row.id));

		return eligible.map((row) => mapCollectionRecord(row, memberCounts.get(row.id) || 0));
	} catch {
		return [];
	}
}

/**
 * Resolve template IDs belonging to a collection slug within a channel.
 * Returns null when collections are unavailable (migration not applied).
 */
export async function resolveCollectionTemplateIds({ channel = '', collectionSlug = '' } = {}) {
	const normalizedChannel = normalizeCollectionChannel(channel);
	const slug = normalizeCollectionSlug(collectionSlug);
	if (!normalizedChannel || !slug) return null;

	try {
		const collections = await pocketbaseClient.collection('template_collections').getFullList({
			filter: `channel = "${escapeFilterValue(normalizedChannel)}" && slug = "${escapeFilterValue(slug)}" && status = "published"`,
			fields: 'id,slug,status',
			requestKey: null,
		});
		const collection = collections[0];
		if (!collection) return new Set();

		const members = await pocketbaseClient.collection('template_collection_members').getFullList({
			filter: `collection_id = "${escapeFilterValue(collection.id)}"`,
			sort: 'sort_order',
			fields: 'template_id',
			requestKey: null,
		});
		return new Set(members.map((row) => row.template_id).filter(Boolean));
	} catch {
		return null;
	}
}

/**
 * Load collection slugs per template id (for admin DTO enrichment).
 */
export async function loadTemplateCollectionMap(templateIds = []) {
	const map = new Map();
	if (!templateIds.length) return map;

	try {
		const members = await pocketbaseClient.collection('template_collection_members').getFullList({
			fields: 'collection_id,template_id',
			requestKey: null,
		});
		const collectionIds = [...new Set(members.map((row) => row.collection_id).filter(Boolean))];
		if (!collectionIds.length) return map;

		const collections = await pocketbaseClient.collection('template_collections').getFullList({
			fields: 'id,slug,name,channel',
			requestKey: null,
		});
		const byId = new Map(collections.map((row) => [row.id, row]));

		for (const member of members) {
			if (!templateIds.includes(member.template_id)) continue;
			const collection = byId.get(member.collection_id);
			if (!collection) continue;
			const list = map.get(member.template_id) || [];
			list.push({
				id: collection.id,
				slug: collection.slug,
				name: collection.name,
				channel: collection.channel,
			});
			map.set(member.template_id, list);
		}
	} catch {
		// optional until migration
	}
	return map;
}
