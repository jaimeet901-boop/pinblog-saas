import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { sanitizeCollectionPayload } from '../../../utils/pocketbase-safe-query.js';
import { resolveScheduledAtUtc } from '../../../utils/timezone.js';
import { createPinterestMutationAdapter } from '../../calendar/mutations/adapters/pinterest.js';
import { createWordpressMutationAdapter } from '../../calendar/mutations/adapters/wordpress.js';
import {
	getOwnedPinterestAccount,
	getOwnedPinterestAccountById,
} from '../../pinterest-api.js';
import {
	mirrorImageJob,
	isQueueMirrorsEnabled,
} from '../mirrors.js';
import { httpError, updateQueueJob } from '../jobs.js';
import { nextRetryAt } from '../types.js';
import { isQueuePaused } from '../metrics.js';

function adminHttpError(error) {
	if (error?.status) throw error;
	throw httpError(422, error?.message || 'Channel control failed', 'CHANNEL_CONTROL_FAILED');
}

function createAdminPinterestAdapter(jobOwner) {
	function freezeError(status, message, errorCode = 'VALIDATION_ERROR') {
		const error = new Error(message);
		error.status = status;
		error.errorCode = errorCode;
		return error;
	}

	async function assertPinterestConnected(owner, accountId = '') {
		const account = accountId
			? await getOwnedPinterestAccountById({ owner, accountId, req: null })
			: await getOwnedPinterestAccount(owner, null);
		if (!account) {
			throw freezeError(422, 'Pinterest account is not connected');
		}
		const status = String(account.status || '').trim();
		const usable = account.connected && (!status || status === 'connected');
		if (!usable) {
			throw freezeError(422, 'Selected Pinterest account is not connected. Please reconnect it.');
		}
		return account;
	}

	return createPinterestMutationAdapter({
		getOwner: () => jobOwner,
		getJob: async (jobId) => pocketbaseClient.collection('pinterest_publish_jobs').getOne(jobId).catch(() => null),
		updateJob: async (jobId, payload) => pocketbaseClient.collection('pinterest_publish_jobs').update(jobId, payload),
		updatePin: async (pinId, payload) => pocketbaseClient.collection('ai_pins').update(pinId, payload),
		createEvent: async (payload) => pocketbaseClient.collection('pinterest_publish_events').create(payload),
		sanitize: sanitizeCollectionPayload,
		resolveScheduledAtUtc,
		assertPinterestConnected,
	});
}

function createAdminWordpressAdapter(jobOwner) {
	return createWordpressMutationAdapter({
		getOwner: () => jobOwner,
		getJob: async (jobId) => pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null),
		updateJob: async (jobId, payload) => pocketbaseClient.collection('publish_jobs').update(jobId, payload),
		sanitize: sanitizeCollectionPayload,
		resolveScheduledAtUtc,
	});
}

async function refreshMirror(target, eventMessage = '') {
	if (!isQueueMirrorsEnabled()) return null;
	const job = await getChannelJobRecord(target.sourceCollection, target.sourceId);
	if (!job) return null;

	if (target.sourceCollection === 'pinterest_publish_jobs') {
		return null;
	}
	if (target.sourceCollection === 'publish_jobs') {
		return null;
	}
	if (target.sourceCollection === 'ai_pin_image_jobs') {
		return mirrorImageJob(job, eventMessage);
	}
	return null;
}

async function getChannelJobRecord(sourceCollection, sourceId) {
	return pocketbaseClient.collection(sourceCollection).getOne(sourceId, {
		expand: 'owner,workspace',
		requestKey: null,
	}).catch(() => null);
}

async function syncMirrorQueueJob(target, updates, eventMessage = '') {
	if (!target.queueJobId) return null;
	return updateQueueJob(target.queueJobId, updates, eventMessage);
}

async function cancelAiPinImageJob(job) {
	if (['completed', 'fallback'].includes(job.status)) {
		throw httpError(422, 'Job is already terminal', 'INVALID_STATUS');
	}
	const payload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'admin-controls:ai-image:cancel',
		payload: {
			status: 'failed',
			last_error: 'Cancelled from admin queue',
			claim_token: '',
		},
	});
	return pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, payload);
}

async function retryAiPinImageJob(job) {
	if (!['failed'].includes(job.status)) {
		throw httpError(422, 'Only failed jobs can be retried', 'INVALID_STATUS');
	}
	const payload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'admin-controls:ai-image:retry',
		payload: {
			status: 'queued',
			attempt_count: 0,
			dead_letter: false,
			last_error: '',
			next_retry_at: '',
			claim_token: '',
			progress: 0,
		},
	});
	return pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, payload);
}

async function pauseAiPinImageJob(job) {
	if (!['queued', 'processing'].includes(job.status)) {
		throw httpError(422, 'Only active jobs can be paused', 'INVALID_STATUS');
	}
	const payload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'admin-controls:ai-image:pause',
		payload: {
			status: 'queued',
			claim_token: '',
		},
	});
	return pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, payload);
}

async function resumeAiPinImageJob(job) {
	if (await isQueuePaused()) {
		throw httpError(423, 'Global queue is paused', 'QUEUE_PAUSED');
	}
	const payload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'admin-controls:ai-image:resume',
		payload: {
			status: 'queued',
			next_retry_at: '',
		},
	});
	return pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, payload);
}

async function requeueAiPinImageJob(job) {
	if (!job.dead_letter && job.status !== 'failed') {
		throw httpError(422, 'Job is not in the dead letter queue', 'INVALID_STATUS');
	}
	const payload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'admin-controls:ai-image:requeue',
		payload: {
			status: 'queued',
			dead_letter: false,
			last_error: '',
			next_retry_at: '',
			claim_token: '',
		},
	});
	return pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, payload);
}

function mapChannelToQueueStatus(sourceCollection, status) {
	const value = String(status || '').toLowerCase();
	if (sourceCollection === 'publish_jobs') {
		if (value === 'queued') return 'queued';
		if (value === 'scheduled') return 'waiting';
		if (value === 'publishing') return 'running';
	}
	if (sourceCollection === 'pinterest_publish_jobs') {
		if (value === 'scheduled') return 'waiting';
		if (value === 'publishing') return 'running';
	}
	if (sourceCollection === 'ai_pin_image_jobs') {
		if (value === 'queued') return 'queued';
		if (value === 'processing') return 'running';
	}
	return value;
}

function isActiveChannelJob(target) {
	const queueStatus = mapChannelToQueueStatus(target.sourceCollection, target.channelJob.status);
	return ['pending', 'queued', 'waiting', 'retrying', 'running'].includes(queueStatus);
}

async function pauseChannelCollectionJob(target) {
	if (!isActiveChannelJob(target)) {
		throw httpError(422, 'Only active jobs can be paused', 'INVALID_STATUS');
	}

	const job = target.channelJob;
	let updated;
	if (target.sourceCollection === 'ai_pin_image_jobs') {
		updated = await pauseAiPinImageJob(job);
	} else {
		const statusMap = {
			publish_jobs: 'queued',
			pinterest_publish_jobs: 'scheduled',
		};
		const payload = await sanitizeCollectionPayload({
			collection: target.sourceCollection,
			context: 'admin-controls:pause',
			payload: {
				status: statusMap[target.sourceCollection] || 'queued',
				claim_token: '',
			},
		});
		updated = await pocketbaseClient.collection(target.sourceCollection).update(job.id, payload);
	}

	await syncMirrorQueueJob(target, {
		status: 'paused',
		paused_at: new Date().toISOString(),
		worker_id: '',
		claim_token: '',
	}, 'Job paused');
	await refreshMirror(target, 'Job paused');
	return updated;
}

async function resumeChannelCollectionJob(target) {
	if (target.queueJobId) {
		const mirror = await pocketbaseClient.collection('queue_jobs').getOne(target.queueJobId).catch(() => null);
		if (mirror?.status !== 'paused') {
			throw httpError(422, 'Only paused jobs can be resumed', 'INVALID_STATUS');
		}
	}
	if (await isQueuePaused()) {
		throw httpError(423, 'Global queue is paused', 'QUEUE_PAUSED');
	}

	let updated;
	if (target.sourceCollection === 'ai_pin_image_jobs') {
		updated = await resumeAiPinImageJob(target.channelJob);
	} else if (target.sourceCollection === 'publish_jobs') {
		const hasSchedule = Boolean(target.channelJob.scheduled_at);
		const payload = await sanitizeCollectionPayload({
			collection: 'publish_jobs',
			context: 'admin-controls:resume',
			payload: {
				status: hasSchedule ? 'scheduled' : 'queued',
				next_retry_at: '',
			},
		});
		updated = await pocketbaseClient.collection('publish_jobs').update(target.channelJob.id, payload);
	} else {
		const payload = await sanitizeCollectionPayload({
			collection: 'pinterest_publish_jobs',
			context: 'admin-controls:resume',
			payload: {
				status: 'scheduled',
				next_retry_at: '',
				scheduled_at: new Date().toISOString(),
			},
		});
		updated = await pocketbaseClient.collection('pinterest_publish_jobs').update(target.channelJob.id, payload);
	}

	await syncMirrorQueueJob(target, {
		status: 'waiting',
		paused_at: '',
		next_retry_at: '',
	}, 'Job resumed');
	await refreshMirror(target, 'Job resumed');
	return updated;
}

async function requeueWordpressJob(job) {
	if (!job.dead_letter && job.status !== 'failed') {
		throw httpError(422, 'Job is not in the dead letter queue', 'INVALID_STATUS');
	}
	const hasSchedule = Boolean(job.scheduled_at);
	const payload = await sanitizeCollectionPayload({
		collection: 'publish_jobs',
		context: 'admin-controls:wordpress:requeue',
		payload: {
			status: hasSchedule ? 'scheduled' : 'queued',
			dead_letter: false,
			last_error: '',
			next_retry_at: '',
			claim_token: '',
			progress: 0,
		},
	});
	return pocketbaseClient.collection('publish_jobs').update(job.id, payload);
}

async function requeuePinterestJob(job) {
	if (!job.dead_letter && job.status !== 'failed') {
		throw httpError(422, 'Job is not in the dead letter queue', 'INVALID_STATUS');
	}
	const now = new Date().toISOString();
	const payload = await sanitizeCollectionPayload({
		collection: 'pinterest_publish_jobs',
		context: 'admin-controls:pinterest:requeue',
		payload: {
			status: 'scheduled',
			dead_letter: false,
			last_error: '',
			next_retry_at: '',
			scheduled_at: now,
			claim_token: '',
		},
	});
	return pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, payload);
}

export async function cancelChannelJob(target, { actorId } = {}) {
	try {
		const job = target.channelJob;
		let updated;

		if (target.sourceCollection === 'pinterest_publish_jobs') {
			const adapter = createAdminPinterestAdapter(job.owner);
			await adapter.cancel({}, target.sourceId);
			updated = await getChannelJobRecord(target.sourceCollection, target.sourceId);
		} else if (target.sourceCollection === 'publish_jobs') {
			const adapter = createAdminWordpressAdapter(job.owner);
			await adapter.cancel({}, target.sourceId);
			updated = await getChannelJobRecord(target.sourceCollection, target.sourceId);
		} else if (target.sourceCollection === 'ai_pin_image_jobs') {
			updated = await cancelAiPinImageJob(job);
		} else {
			throw httpError(422, 'Unsupported channel collection', 'UNSUPPORTED_CHANNEL');
		}

		await syncMirrorQueueJob(target, {
			status: 'cancelled',
			completed_at: new Date().toISOString(),
			worker_id: '',
			claim_token: '',
		}, `Cancelled by ${actorId || 'admin'}`);
		await refreshMirror(target, `Cancelled by ${actorId || 'admin'}`);
		return updated;
	} catch (error) {
		adminHttpError(error);
	}
}

export async function retryChannelJob(target) {
	try {
		const job = target.channelJob;

		if (target.sourceCollection === 'pinterest_publish_jobs') {
			const adapter = createAdminPinterestAdapter(job.owner);
			await adapter.retry({}, target.sourceId);
		} else if (target.sourceCollection === 'publish_jobs') {
			const adapter = createAdminWordpressAdapter(job.owner);
			await adapter.retry({}, target.sourceId);
		} else if (target.sourceCollection === 'ai_pin_image_jobs') {
			await retryAiPinImageJob(job);
		} else {
			throw httpError(422, 'Unsupported channel collection', 'UNSUPPORTED_CHANNEL');
		}

		const attempt = (Number(job.attempt_count) || 0) + 1;
		await syncMirrorQueueJob(target, {
			status: 'retrying',
			attempt_count: attempt,
			dead_letter: false,
			error: '',
			failure_reason: '',
			next_retry_at: nextRetryAt(attempt),
			progress: 0,
			completed_at: '',
			worker_id: '',
			claim_token: '',
		}, 'Retry queued');
		await refreshMirror(target, 'Retry queued');
		return getChannelJobRecord(target.sourceCollection, target.sourceId);
	} catch (error) {
		adminHttpError(error);
	}
}

export async function pauseChannelJob(target) {
	try {
		return await pauseChannelCollectionJob(target);
	} catch (error) {
		adminHttpError(error);
	}
}

export async function resumeChannelJob(target) {
	try {
		return await resumeChannelCollectionJob(target);
	} catch (error) {
		adminHttpError(error);
	}
}

export async function requeueChannelJob(target) {
	try {
		if (target.sourceCollection === 'ai_pin_image_jobs') {
			await requeueAiPinImageJob(target.channelJob);
		} else if (target.sourceCollection === 'publish_jobs') {
			await requeueWordpressJob(target.channelJob);
		} else if (target.sourceCollection === 'pinterest_publish_jobs') {
			await requeuePinterestJob(target.channelJob);
		} else {
			throw httpError(422, 'Unsupported channel collection', 'UNSUPPORTED_CHANNEL');
		}

		await syncMirrorQueueJob(target, {
			status: 'queued',
			dead_letter: false,
			error: '',
			failure_reason: '',
			next_retry_at: '',
			progress: 0,
			completed_at: '',
			worker_id: '',
			claim_token: '',
		}, 'Requeued from dead letter');
		await refreshMirror(target, 'Requeued from dead letter');
		return getChannelJobRecord(target.sourceCollection, target.sourceId);
	} catch (error) {
		adminHttpError(error);
	}
}

export async function deleteChannelJob(target) {
	throw httpError(
		422,
		'Channel jobs cannot be deleted from admin queue; cancel the job instead',
		'CHANNEL_DELETE_BLOCKED',
	);
}

export async function listChannelJobEvents(target, limit = 100) {
	if (target.sourceCollection === 'pinterest_publish_jobs') {
		const result = await pocketbaseClient.collection('pinterest_publish_events').getList(1, limit, {
			filter: pocketbaseClient.filter('job = {:job}', { job: target.sourceId }),
			sort: '-created',
			requestKey: null,
		}).catch(() => ({ items: [] }));
		return (result.items || []).reverse().map((event) => ({
			id: event.id,
			level: event.event_type === 'failed' ? 'error' : 'info',
			message: event.message || event.event_type || '',
			at: event.created,
			payload: event.payload || null,
		}));
	}
	return [];
}
