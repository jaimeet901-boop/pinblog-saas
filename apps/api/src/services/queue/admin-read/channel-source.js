import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { normalizeJobType } from '../types.js';

const CHANNEL_CONFIG = Object.freeze([
	{ collection: 'pinterest_publish_jobs', type: 'pinterest_publishing' },
	{ collection: 'publish_jobs', type: 'wordpress_publishing' },
	{ collection: 'ai_pin_image_jobs', type: 'image_generation' },
]);

function collectionsForType(typeRaw) {
	const type = normalizeJobType(typeRaw);
	if (!type) return CHANNEL_CONFIG;
	return CHANNEL_CONFIG.filter((entry) => entry.type === type);
}

export function buildChannelQueueFilter({
	workspace = '',
	dateRange = '',
} = {}) {
	const parts = [];
	if (workspace) {
		parts.push(pocketbaseClient.filter('workspace_key ~ {:ws}', { ws: workspace }));
	}
	if (dateRange === 'today') {
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		parts.push(pocketbaseClient.filter('created >= {:start}', { start: start.toISOString() }));
	}
	return parts.length ? parts.join(' && ') : '';
}

async function listChannelCollection(collection, { filter = '', limit = 200 } = {}) {
	const result = await pocketbaseClient.collection(collection).getList(1, limit, {
		filter: filter || undefined,
		sort: '-created',
		expand: 'owner,workspace',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return (result.items || []).map((item) => ({ ...item, _sourceCollection: collection }));
}

/**
 * Read channel job collections for dual-read merge.
 */
export async function listChannelQueueJobsBatch({
	typeRaw = '',
	workspace = '',
	dateRange = '',
	limit = 200,
} = {}) {
	const filter = buildChannelQueueFilter({ workspace, dateRange });
	const targets = collectionsForType(typeRaw);
	const batches = await Promise.all(
		targets.map(({ collection }) => listChannelCollection(collection, { filter, limit })),
	);
	return batches.flat();
}

export async function getChannelJob(sourceCollection, sourceId) {
	if (!sourceCollection || !sourceId) return null;
	return pocketbaseClient.collection(sourceCollection).getOne(sourceId, {
		expand: 'owner,workspace',
		requestKey: null,
	}).catch(() => null);
}
