import { listQueueEvents } from '../jobs.js';
import { loadAdminControlTarget } from '../admin-controls/load-target.js';
import { listChannelJobEvents } from '../admin-controls/channel-actions.js';
import { CONTROL_ROUTE } from '../admin-controls/resolve-target.js';
import { listPinterestPublishEventsForJob } from './pinterest-events.js';

function mapToApiEvent(event) {
	return {
		id: event.id,
		level: event.level,
		message: event.message,
		at: event.at || event.created,
		payload: event.payload || null,
	};
}

/**
 * Events for admin job detail timeline (mapQueueJobDto-compatible raw events).
 * Mirror-backed Pinterest jobs keep queue_job_events for equivalence with legacy detail.
 */
export async function resolveAdminDetailEvents(target, limit = 100) {
	if (!target) return [];

	if (target.queueJobId && target.sourceCollection === 'pinterest_publish_jobs') {
		return listQueueEvents(target.queueJobId, limit);
	}

	if (target.route === CONTROL_ROUTE.NATIVE && target.queueJobId) {
		return listQueueEvents(target.queueJobId, limit);
	}

	if (target.sourceCollection === 'pinterest_publish_jobs' && target.sourceId) {
		const pinEvents = await listPinterestPublishEventsForJob(target.sourceId, limit);
		if (pinEvents.length) {
			return pinEvents.map((event) => ({
				id: event.id,
				level: event.level,
				message: event.message,
				at: event.at,
				created: event.at,
				payload: event.payload,
			}));
		}
	}

	const channelEvents = await listChannelJobEvents(target, limit);
	if (channelEvents.length) {
		return channelEvents.map((event) => ({
			id: event.id,
			level: event.level,
			message: event.message,
			at: event.at,
			created: event.at,
			payload: event.payload,
		}));
	}

	if (target.queueJobId) {
		return listQueueEvents(target.queueJobId, limit);
	}

	return [];
}

/**
 * Events for GET /admin/v1/queue/jobs/:id/events (normalized API items).
 */
export async function resolveAdminApiEventsFromTarget(target, limit = 100) {
	if (!target) return [];

	if (target.route === CONTROL_ROUTE.NATIVE && target.queueJobId) {
		const events = await listQueueEvents(target.queueJobId, limit);
		return events.map(mapToApiEvent);
	}

	const channelEvents = await listChannelJobEvents(target, limit);
	if (channelEvents.length) return channelEvents;

	if (target.queueJobId) {
		const events = await listQueueEvents(target.queueJobId, limit);
		return events.map(mapToApiEvent);
	}

	return [];
}

/**
 * Resolve admin queue job events by requested id (native, mirrored, or synthetic).
 * Returns null when the job cannot be resolved.
 */
export async function resolveAdminQueueJobEvents(requestedId, limit = 100) {
	const target = await loadAdminControlTarget(requestedId);
	if (!target) return null;
	return resolveAdminApiEventsFromTarget(target, limit);
}
