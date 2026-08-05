import {
	cancelQueueJob,
	deleteQueueJob,
	pauseQueueJob,
	requeueDeadLetter,
	resumeQueueJob,
	retryQueueJob,
} from '../controls.js';
import { getQueueJob, httpError, mapQueueJobDetail } from '../jobs.js';
import { getAdminQueueJobDetail } from '../admin-read/index.js';
import { resolveAdminApiEventsFromTarget } from '../admin-events/index.js';
import { isAdminQueueChannelControlsEnabled } from './flag.js';
import { loadAdminControlTarget } from './load-target.js';
import {
	cancelChannelJob,
	deleteChannelJob,
	pauseChannelJob,
	requeueChannelJob,
	resumeChannelJob,
	retryChannelJob,
} from './channel-actions.js';

export { isAdminQueueChannelControlsEnabled, getAdminQueueChannelControlsStatus } from './flag.js';
export { classifyControlTarget, resolveControlCoordinates, CONTROL_ROUTE, CONTROL_TARGET_KIND } from './resolve-target.js';

const CHANNEL_ACTIONS = new Set(['cancel', 'retry', 'pause', 'resume', 'requeue', 'delete']);

async function runNativeControl(action, target, options = {}) {
	const jobId = target.queueJobId;
	switch (action) {
		case 'cancel':
			return cancelQueueJob(jobId, { actorId: options.actorId });
		case 'retry':
			return retryQueueJob(jobId);
		case 'pause':
			return pauseQueueJob(jobId);
		case 'resume':
			return resumeQueueJob(jobId);
		case 'requeue':
			return requeueDeadLetter(jobId);
		case 'delete':
			return deleteQueueJob(jobId);
		default:
			throw httpError(400, 'Unknown control action', 'INVALID_ACTION');
	}
}

async function runChannelControl(action, target, options = {}) {
	switch (action) {
		case 'cancel':
			return cancelChannelJob(target, { actorId: options.actorId });
		case 'retry':
			return retryChannelJob(target);
		case 'pause':
			return pauseChannelJob(target);
		case 'resume':
			return resumeChannelJob(target);
		case 'requeue':
			return requeueChannelJob(target);
		case 'delete':
			return deleteChannelJob(target);
		default:
			throw httpError(400, 'Unknown control action', 'INVALID_ACTION');
	}
}

function responseIdForTarget(target) {
	if (target.syntheticId) return target.syntheticId;
	return target.queueJobId || target.requestedId;
}

/**
 * Dispatch admin queue job control with optional channel routing (Phase 9d-3).
 */
export async function dispatchAdminQueueJobControl(action, requestedId, options = {}) {
	const normalizedAction = String(action || '').trim().toLowerCase();
	if (!CHANNEL_ACTIONS.has(normalizedAction)) {
		throw httpError(400, 'Unknown control action', 'INVALID_ACTION');
	}

	if (!isAdminQueueChannelControlsEnabled()) {
		return runNativeControl(normalizedAction, {
			queueJobId: requestedId,
			requestedId,
			route: CONTROL_ROUTE.NATIVE,
		}, options);
	}

	const target = await loadAdminControlTarget(requestedId);
	if (!target) {
		throw httpError(404, 'Job not found', 'NOT_FOUND');
	}

	if (target.route === CONTROL_ROUTE.NATIVE) {
		await runNativeControl(normalizedAction, target, options);
	} else {
		await runChannelControl(normalizedAction, target, options);
	}

	return {
		target,
		responseId: responseIdForTarget(target),
	};
}

export async function mapAdminQueueJobControlResponse(action, requestedId, options = {}) {
	const result = await dispatchAdminQueueJobControl(action, requestedId, options);
	if (action === 'delete') {
		return { id: result.responseId, deleted: true };
	}
	let detail = await getAdminQueueJobDetail(result.responseId);
	if (!detail && result.target.queueJobId) {
		const job = await getQueueJob(result.target.queueJobId);
		if (job) detail = await mapQueueJobDetail(job);
	}
	if (!detail) {
		throw httpError(404, 'Job not found after control', 'NOT_FOUND');
	}
	return detail;
}

export async function listAdminQueueJobEvents(requestedId, limit = 100) {
	const target = await loadAdminControlTarget(requestedId);
	if (!target) {
		throw httpError(404, 'Job not found', 'NOT_FOUND');
	}
	return resolveAdminApiEventsFromTarget(target, limit);
}
