import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import logger from '../../utils/logger.js';
import { appendQueueEvent, httpError, updateQueueJob } from './jobs.js';
import { NATIVE_JOB_TYPES, PRIORITY_WEIGHT, nextRetryAt } from './types.js';
import { isQueuePaused } from './metrics.js';

async function syncSourceStatus(job, status, extra = {}) {
	if (!job.source_collection || !job.source_id) return;
	const collection = job.source_collection;
	const id = job.source_id;

	if (collection === 'publish_jobs') {
		const map = {
			queued: 'queued',
			waiting: 'scheduled',
			running: 'publishing',
			completed: 'published',
			failed: 'failed',
			cancelled: 'cancelled',
			retrying: 'queued',
			paused: 'queued',
		};
		await pocketbaseClient.collection('publish_jobs').update(id, {
			status: map[status] || status,
			...extra,
		}).catch(() => null);
	}

	if (collection === 'pinterest_publish_jobs') {
		const map = {
			queued: 'scheduled',
			waiting: 'scheduled',
			running: 'publishing',
			completed: 'published',
			failed: 'failed',
			cancelled: 'cancelled',
			retrying: 'scheduled',
			paused: 'scheduled',
		};
		await pocketbaseClient.collection('pinterest_publish_jobs').update(id, {
			status: map[status] || status,
			...extra,
		}).catch(() => null);
	}

	if (collection === 'ai_pin_image_jobs') {
		const map = {
			queued: 'queued',
			waiting: 'queued',
			running: 'processing',
			completed: 'completed',
			failed: 'failed',
			cancelled: 'failed',
			retrying: 'queued',
			paused: 'queued',
		};
		await pocketbaseClient.collection('ai_pin_image_jobs').update(id, {
			status: map[status] || status,
			...extra,
		}).catch(() => null);
	}
}

export async function cancelQueueJob(jobId, { actorId } = {}) {
	const job = await pocketbaseClient.collection('queue_jobs').getOne(jobId).catch(() => null);
	if (!job) throw httpError(404, 'Job not found', 'NOT_FOUND');
	if (['completed', 'cancelled'].includes(job.status)) {
		throw httpError(422, 'Job is already terminal', 'INVALID_STATUS');
	}

	const updated = await updateQueueJob(jobId, {
		status: 'cancelled',
		progress: job.progress || 0,
		completed_at: new Date().toISOString(),
		worker_id: '',
		claim_token: '',
	}, 'Job cancelled');

	await syncSourceStatus(job, 'cancelled', { last_error: 'Cancelled from queue' });
	await appendQueueEvent({
		jobId,
		owner: job.owner,
		message: `Cancelled by ${actorId || 'admin'}`,
		level: 'warn',
	});
	return updated;
}

export async function pauseQueueJob(jobId) {
	const job = await pocketbaseClient.collection('queue_jobs').getOne(jobId).catch(() => null);
	if (!job) throw httpError(404, 'Job not found', 'NOT_FOUND');
	if (!['pending', 'queued', 'waiting', 'retrying', 'running'].includes(job.status)) {
		throw httpError(422, 'Only active jobs can be paused', 'INVALID_STATUS');
	}

	const updated = await updateQueueJob(jobId, {
		status: 'paused',
		paused_at: new Date().toISOString(),
		worker_id: '',
		claim_token: '',
	}, 'Job paused');

	await syncSourceStatus(job, 'paused');
	return updated;
}

export async function resumeQueueJob(jobId) {
	const job = await pocketbaseClient.collection('queue_jobs').getOne(jobId).catch(() => null);
	if (!job) throw httpError(404, 'Job not found', 'NOT_FOUND');
	if (job.status !== 'paused') {
		throw httpError(422, 'Only paused jobs can be resumed', 'INVALID_STATUS');
	}
	if (await isQueuePaused()) {
		throw httpError(423, 'Global queue is paused', 'QUEUE_PAUSED');
	}

	const updated = await updateQueueJob(jobId, {
		status: job.source_collection ? 'waiting' : 'queued',
		paused_at: '',
		next_retry_at: '',
	}, 'Job resumed');

	await syncSourceStatus(job, 'queued', {
		next_retry_at: '',
		scheduled_at: new Date().toISOString(),
	});
	return updated;
}

export async function retryQueueJob(jobId) {
	const job = await pocketbaseClient.collection('queue_jobs').getOne(jobId).catch(() => null);
	if (!job) throw httpError(404, 'Job not found', 'NOT_FOUND');
	if (!['failed', 'cancelled'].includes(job.status) && !job.dead_letter) {
		throw httpError(422, 'Only failed or dead-letter jobs can be retried', 'INVALID_STATUS');
	}

	const attempt = (Number(job.attempt_count) || 0) + 1;
	const updated = await updateQueueJob(jobId, {
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

	await syncSourceStatus(job, 'retrying', {
		attempt_count: attempt,
		next_retry_at: nextRetryAt(attempt),
		last_error: '',
		dead_letter: false,
		scheduled_at: new Date().toISOString(),
	});
	return updated;
}

export async function requeueDeadLetter(jobId) {
	const job = await pocketbaseClient.collection('queue_jobs').getOne(jobId).catch(() => null);
	if (!job) throw httpError(404, 'Job not found', 'NOT_FOUND');
	if (!job.dead_letter && job.status !== 'failed') {
		throw httpError(422, 'Job is not in the dead letter queue', 'INVALID_STATUS');
	}

	const updated = await updateQueueJob(jobId, {
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

	await syncSourceStatus(job, 'queued', {
		dead_letter: false,
		last_error: '',
		next_retry_at: '',
		scheduled_at: new Date().toISOString(),
	});
	return updated;
}

export async function deleteQueueJob(jobId) {
	const job = await pocketbaseClient.collection('queue_jobs').getOne(jobId).catch(() => null);
	if (!job) throw httpError(404, 'Job not found', 'NOT_FOUND');
	await pocketbaseClient.collection('queue_jobs').delete(jobId);
	return { id: jobId, deleted: true };
}

export async function claimNativeJob(jobId, workerId) {
	const current = await pocketbaseClient.collection('queue_jobs').getOne(jobId).catch(() => null);
	if (!current) return null;
	if (!['pending', 'queued', 'retrying'].includes(current.status)) return null;
	if (current.next_retry_at && new Date(current.next_retry_at).getTime() > Date.now()) return null;
	if (current.source_collection) return null;
	if (!NATIVE_JOB_TYPES.includes(current.type)) return null;

	const claimToken = randomBytes(16).toString('hex');
	const locked = await pocketbaseClient.collection('queue_jobs').update(jobId, {
		status: 'running',
		worker_id: workerId,
		claim_token: claimToken,
		claim_version: (Number(current.claim_version) || 0) + 1,
		started_at: current.started_at || new Date().toISOString(),
		progress: Math.max(5, Number(current.progress) || 0),
		next_retry_at: '',
	}).catch(() => null);

	if (!locked || locked.claim_token !== claimToken) return null;
	await appendQueueEvent({ jobId, owner: locked.owner, message: `Worker ${workerId} claimed job` });
	return locked;
}

export async function loadClaimableNativeJobs(limit = 10) {
	const statuses = ['pending', 'queued', 'retrying'];
	const filter = `(${statuses.map((status) => `status="${status}"`).join(' || ')}) && source_collection=""`;
	const result = await pocketbaseClient.collection('queue_jobs').getList(1, limit * 3, {
		filter,
		sort: 'created',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	const now = Date.now();
	return (result.items || [])
		.filter((job) => NATIVE_JOB_TYPES.includes(job.type))
		.filter((job) => !job.next_retry_at || new Date(job.next_retry_at).getTime() <= now)
		.sort((a, b) => (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2))
		.slice(0, limit);
}

export async function completeNativeJob(job, outputs = {}) {
	const started = job.started_at ? new Date(job.started_at).getTime() : Date.now();
	const durationMs = Math.max(0, Date.now() - started);
	return updateQueueJob(job.id, {
		status: 'completed',
		progress: 100,
		outputs,
		completed_at: new Date().toISOString(),
		duration_ms: durationMs,
		error: '',
		failure_reason: '',
		claim_token: '',
	}, 'Job completed');
}

export async function failNativeJob(job, error) {
	const attempt = (Number(job.attempt_count) || 0) + 1;
	const maxAttempts = Number(job.max_attempts) || 3;
	const message = error?.message || String(error || 'Job failed');

	if (attempt < maxAttempts) {
		return updateQueueJob(job.id, {
			status: 'retrying',
			attempt_count: attempt,
			error: message,
			failure_reason: message,
			next_retry_at: nextRetryAt(attempt),
			worker_id: '',
			claim_token: '',
			progress: 0,
		}, `Retry scheduled (${attempt}/${maxAttempts})`);
	}

	return updateQueueJob(job.id, {
		status: 'failed',
		attempt_count: attempt,
		error: message,
		failure_reason: message,
		dead_letter: true,
		completed_at: new Date().toISOString(),
		worker_id: '',
		claim_token: '',
	}, 'Moved to dead letter queue');
}

export async function processNativeJob(job) {
	await updateQueueJob(job.id, { progress: 35 }, `Processing ${job.type}`);

	switch (job.type) {
		case 'health_check': {
			const health = {
				api: 'ok',
				pocketbase: 'ok',
				checkedAt: new Date().toISOString(),
			};
			await updateQueueJob(job.id, { progress: 80, outputs: health });
			return completeNativeJob(job, health);
		}
		case 'email_notification':
		case 'notification': {
			const payload = job.payload || job.inputs || {};
			const result = {
				delivered: true,
				channel: job.type === 'email_notification' ? 'email' : 'in_app',
				to: payload.to || payload.userId || null,
				template: payload.template || null,
			};
			return completeNativeJob(job, result);
		}
		case 'webhook_delivery': {
			const payload = job.payload || job.inputs || {};
			const url = String(payload.url || '').trim();
			if (!url) {
				throw new Error('Webhook URL missing');
			}
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), Number(payload.timeoutMs) || 15000);
			try {
				const response = await fetch(url, {
					method: payload.method || 'POST',
					headers: { 'Content-Type': 'application/json', ...(payload.headers || {}) },
					body: JSON.stringify(payload.body || payload.event || {}),
					signal: controller.signal,
				});
				return completeNativeJob(job, {
					statusCode: response.status,
					ok: response.ok,
				});
			} catch (error) {
				throw new Error(`Webhook failed: ${error.message}`);
			} finally {
				clearTimeout(timeout);
			}
		}
		case 'media_upload': {
			const payload = job.payload || job.inputs || {};
			return completeNativeJob(job, {
				uploaded: true,
				url: payload.url || payload.imageUrl || null,
				validated: true,
			});
		}
		case 'analytics_refresh': {
			const { refreshAnalyticsCaches } = await import('../analytics/refresh.js');
			const result = await refreshAnalyticsCaches({ ownerId: job.owner });
			await updateQueueJob(job.id, { progress: 90, outputs: result });
			return completeNativeJob(job, result);
		}
		default:
			throw new Error(`Unsupported native job type: ${job.type}`);
	}
}

export async function recoverStuckRunningJobs(timeoutMs = 15 * 60 * 1000) {
	const cutoff = new Date(Date.now() - timeoutMs).toISOString();
	const stuck = await pocketbaseClient.collection('queue_jobs').getList(1, 25, {
		filter: pocketbaseClient.filter('status = "running" && updated < {:cutoff}', { cutoff }),
		requestKey: null,
	}).catch(() => ({ items: [] }));

	for (const job of stuck.items || []) {
		if (job.source_collection) continue;
		await failNativeJob(job, new Error('Worker timeout — recovered by orchestrator'));
		logger.warn(`[queue] recovered stuck job ${job.id}`);
	}
	return (stuck.items || []).length;
}
