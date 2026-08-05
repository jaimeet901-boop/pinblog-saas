import { makeSourceKey, normalizeChannelJob, normalizeNativeJob } from './normalize.js';

function sortByRecency(a, b) {
	const aTime = new Date(a._sortTime || a.created || 0).getTime();
	const bTime = new Date(b._sortTime || b.created || 0).getTime();
	if (bTime !== aTime) return bTime - aTime;
	return String(b.id || '').localeCompare(String(a.id || ''));
}

function indexMirrorsBySource(nativeItems) {
	const map = new Map();
	for (const job of nativeItems) {
		const collection = String(job.source_collection || '').trim();
		const sourceId = String(job.source_id || '').trim();
		if (!collection || !sourceId) continue;
		map.set(makeSourceKey(collection, sourceId), job);
	}
	return map;
}

function matchesPostFilters(record, { status = '', priority = '', provider = '', type = '' } = {}) {
	if (status && record.status !== status) return false;
	if (priority && record.priority !== priority) return false;
	if (provider) {
		const hay = String(record.provider || '').toLowerCase();
		if (!hay.includes(String(provider).toLowerCase())) return false;
	}
	if (type && record.type !== type) return false;
	return true;
}

/**
 * Merge native queue_jobs rows with live channel rows.
 * Channel rows win over mirrored queue_jobs with the same source key.
 * Orphan mirrors (channel row missing) are omitted.
 */
export function mergeAdminQueueRecords({
	nativeItems = [],
	channelItems = [],
	filters = {},
} = {}) {
	const mirrorBySource = indexMirrorsBySource(nativeItems);
	const merged = [];
	const consumedSources = new Set();

	for (const channelRow of channelItems) {
		const sourceCollection = channelRow._sourceCollection || channelRow.collection;
		const sourceKey = makeSourceKey(sourceCollection, channelRow.id);
		const mirror = mirrorBySource.get(sourceKey) || null;
		const normalized = normalizeChannelJob(sourceCollection, channelRow, {
			queueJobId: mirror?.id || null,
			readSource: 'channel',
		});
		if (!normalized) continue;
		if (!matchesPostFilters(normalized, filters)) continue;
		consumedSources.add(sourceKey);
		merged.push(normalized);
	}

	for (const nativeJob of nativeItems) {
		const sourceCollection = String(nativeJob.source_collection || '').trim();
		if (sourceCollection) {
			const sourceKey = makeSourceKey(sourceCollection, nativeJob.source_id);
			if (consumedSources.has(sourceKey)) continue;
			// Orphan mirror — channel row deleted; omit per 9d-0 design.
			continue;
		}
		const normalized = normalizeNativeJob(nativeJob, { readSource: 'native' });
		if (!normalized) continue;
		if (!matchesPostFilters(normalized, filters)) continue;
		merged.push(normalized);
	}

	merged.sort(sortByRecency);
	return merged;
}

export function filterJobsBySearch(items, q) {
	const query = String(q || '').trim().toLowerCase();
	if (!query) return items;
	return items.filter((job) => {
		const haystack = [
			job.id,
			job.type,
			job.workspace_key,
			job.workspace_label,
			job.owner,
			job.provider,
			job.worker_id,
			job.source_collection,
			job.source_id,
		].join(' ').toLowerCase();
		return haystack.includes(query);
	});
}

export function paginateItems(items, { page = 1, perPage = 20, q = '' } = {}) {
	const filtered = filterJobsBySearch(items, q);
	const totalItems = filtered.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
	const safePage = Math.min(Math.max(1, page), totalPages);
	const start = (safePage - 1) * perPage;
	return {
		page: safePage,
		perPage,
		totalItems,
		totalPages,
		items: filtered.slice(start, start + perPage),
	};
}
