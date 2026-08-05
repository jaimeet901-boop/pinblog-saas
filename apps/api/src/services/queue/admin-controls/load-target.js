import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { findBySource, getQueueJob } from '../jobs.js';
import { getChannelJob } from '../admin-read/channel-source.js';
import { classifyControlTarget, resolveControlCoordinates } from './resolve-target.js';

/**
 * Load queue/channel records and classify control routing target.
 * @param {string} requestedId
 */
export async function loadAdminControlTarget(requestedId) {
	const coords = resolveControlCoordinates(requestedId);

	if (coords.isSynthetic) {
		const channelJob = await getChannelJob(coords.sourceCollection, coords.sourceId);
		if (!channelJob) return null;
		const mirrorJob = await findBySource(coords.sourceCollection, coords.sourceId);
		return classifyControlTarget({
			requestedId: coords.requestedId,
			queueJob: mirrorJob,
			channelJob,
			sourceCollection: coords.sourceCollection,
			sourceId: coords.sourceId,
		});
	}

	const queueJob = await getQueueJob(coords.requestedId);
	if (queueJob) {
		const sourceCollection = String(queueJob.source_collection || '').trim();
		if (sourceCollection && queueJob.source_id) {
			const channelJob = await getChannelJob(sourceCollection, queueJob.source_id);
			if (!channelJob) return null;
			return classifyControlTarget({
				requestedId: coords.requestedId,
				queueJob,
				channelJob,
				sourceCollection,
				sourceId: queueJob.source_id,
			});
		}
		return classifyControlTarget({
			requestedId: coords.requestedId,
			queueJob,
		});
	}

	return null;
}

export async function loadAdminControlTargetForEvents(requestedId) {
	return loadAdminControlTarget(requestedId);
}
