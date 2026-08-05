import { makeSyntheticId } from '../admin-read/normalize.js';

async function getPocketbaseClient() {
	const { default: pocketbaseClient } = await import('../../../utils/pocketbaseClient.js');
	return pocketbaseClient;
}

/**
 * Map a pinterest_publish_events row to admin API event shape.
 */
export function mapPinterestPublishEventToAdminEvent(event) {
	return {
		id: event.id,
		level: event.event_type === 'failed' ? 'error' : 'info',
		message: event.message || event.event_type || '',
		at: event.created,
		payload: event.payload || null,
	};
}

/**
 * List pinterest_publish_events for a channel job (oldest-first for timelines).
 */
export async function listPinterestPublishEventsForJob(jobId, limit = 100) {
	const pocketbaseClient = await getPocketbaseClient();
	const result = await pocketbaseClient.collection('pinterest_publish_events').getList(1, limit, {
		filter: pocketbaseClient.filter('job = {:job}', { job: jobId }),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	return (result.items || [])
		.reverse()
		.map(mapPinterestPublishEventToAdminEvent);
}

function formatRelativeSafe(value) {
	if (!value) return '—';
	const ms = Date.now() - new Date(value).getTime();
	if (!Number.isFinite(ms) || ms < 0) return 'just now';
	if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
	return `${Math.round(ms / 86_400_000)}d ago`;
}

/**
 * Recent Pinterest channel activity for admin live feed when mirrors are off.
 */
export async function listRecentPinterestActivityItems(limit = 12) {
	const pocketbaseClient = await getPocketbaseClient();
	const result = await pocketbaseClient.collection('pinterest_publish_events').getList(1, limit, {
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	return (result.items || []).map((event) => ({
		id: `pinterest_event_${event.id}`,
		text: event.message || event.event_type || 'Pinterest publish event',
		kind: 'Pinterest Publishing',
		time: formatRelativeSafe(event.created),
		jobId: event.job ? makeSyntheticId('pinterest_publish_jobs', event.job) : '',
		at: event.created,
	}));
}
