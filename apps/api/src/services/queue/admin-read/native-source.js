import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { normalizeJobType } from '../types.js';

export function buildNativeQueueFilter({
	status = '',
	priority = '',
	provider = '',
	typeRaw = '',
	workspace = '',
	dateRange = '',
} = {}) {
	const type = normalizeJobType(typeRaw);
	const parts = [];
	if (status) parts.push(pocketbaseClient.filter('status = {:status}', { status }));
	if (priority) parts.push(pocketbaseClient.filter('priority = {:priority}', { priority }));
	if (provider) parts.push(pocketbaseClient.filter('provider ~ {:provider}', { provider }));
	if (type) parts.push(pocketbaseClient.filter('type = {:type}', { type }));
	if (workspace) {
		parts.push(pocketbaseClient.filter('(workspace_label ~ {:ws} || workspace_key ~ {:ws})', { ws: workspace }));
	}
	if (dateRange === 'today') {
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		parts.push(pocketbaseClient.filter('created >= {:start}', { start: start.toISOString() }));
	}
	return parts.length ? parts.join(' && ') : '';
}

/**
 * Legacy admin queue list — single queue_jobs query with PocketBase pagination.
 * Preserves production behavior when dual-read is disabled.
 */
export async function listNativeQueueJobsPaginated({
	page = 1,
	perPage = 20,
	filter = '',
} = {}) {
	const result = await pocketbaseClient.collection('queue_jobs').getList(page, perPage, {
		filter: filter || undefined,
		sort: '-created',
		expand: 'owner,workspace',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));

	return {
		items: result.items || [],
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems ?? 0,
		totalPages: result.totalPages ?? 0,
	};
}

/**
 * Dual-read helper — fetch queue_jobs rows up to a cap (in-memory merge pagination).
 */
export async function listNativeQueueJobsBatch({
	filter = '',
	limit = 200,
} = {}) {
	const result = await pocketbaseClient.collection('queue_jobs').getList(1, limit, {
		filter: filter || undefined,
		sort: '-created',
		expand: 'owner,workspace',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return result.items || [];
}
