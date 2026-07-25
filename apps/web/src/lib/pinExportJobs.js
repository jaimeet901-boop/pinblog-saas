/**
 * Cancellable export jobs + queue adapter architecture.
 * Independent of React / editor. Pixel work runs via Export Engine.
 */

let jobSeq = 0;

function nextJobId() {
	jobSeq += 1;
	return `export_${Date.now()}_${jobSeq}`;
}

export const EXPORT_JOB_STATUS = Object.freeze({
	pending: 'pending',
	queued: 'queued',
	running: 'running',
	completed: 'completed',
	cancelled: 'cancelled',
	failed: 'failed',
});

/**
 * @typedef {object} ExportJobRecord
 * @property {string} id
 * @property {string} status
 * @property {AbortController} abortController
 * @property {object} request
 * @property {object|null} result
 * @property {string|null} error
 * @property {number} createdAt
 * @property {number|null} startedAt
 * @property {number|null} completedAt
 * @property {number} progress
 */

/** @type {Map<string, ExportJobRecord>} */
const localJobs = new Map();

export function createExportJob(request = {}) {
	const id = request.jobId || nextJobId();
	const job = {
		id,
		status: EXPORT_JOB_STATUS.pending,
		abortController: new AbortController(),
		request,
		result: null,
		error: null,
		createdAt: Date.now(),
		startedAt: null,
		completedAt: null,
		progress: 0,
		batchId: request.batchId || null,
		index: request.index ?? null,
	};
	localJobs.set(id, job);
	return job;
}

export function getExportJob(jobId) {
	return localJobs.get(jobId) || null;
}

export function listExportJobs({ batchId } = {}) {
	const all = [...localJobs.values()];
	if (batchId) return all.filter((j) => j.batchId === batchId);
	return all;
}

export function cancelExportJob(jobId) {
	const job = localJobs.get(jobId);
	if (!job) return { ok: false, reason: 'not_found' };
	if (job.status === EXPORT_JOB_STATUS.completed || job.status === EXPORT_JOB_STATUS.failed) {
		return { ok: false, reason: 'already_terminal', status: job.status };
	}
	job.abortController.abort();
	job.status = EXPORT_JOB_STATUS.cancelled;
	job.completedAt = Date.now();
	job.error = 'cancelled';
	return { ok: true, job: snapshotJob(job) };
}

export function cancelExportBatch(batchId) {
	const jobs = listExportJobs({ batchId });
	return jobs.map((j) => cancelExportJob(j.id));
}

export function throwIfAborted(signal, job) {
	if (signal?.aborted || job?.abortController?.signal?.aborted) {
		const err = new Error('Export cancelled');
		err.name = 'ExportCancelledError';
		err.code = 'EXPORT_CANCELLED';
		throw err;
	}
}

export function snapshotJob(job) {
	if (!job) return null;
	return {
		id: job.id,
		status: job.status,
		progress: job.progress,
		error: job.error,
		createdAt: job.createdAt,
		startedAt: job.startedAt,
		completedAt: job.completedAt,
		batchId: job.batchId,
		index: job.index,
		resultMeta: job.result
			? {
				format: job.result.format,
				mimeType: job.result.mimeType,
				byteLength: job.result.bytes?.byteLength ?? job.result.bytes?.length ?? 0,
				profileId: job.result.profileId,
				durationMs: job.result.durationMs,
			}
			: null,
	};
}

export function resetExportJobsForTests() {
	localJobs.clear();
	jobSeq = 0;
}

/**
 * In-memory queue — browser/local worker path.
 * Architecture-ready for swapping to remote PocketBase queue (`export` / `template_rendering`).
 */
export function createInMemoryExportQueue({ runJob } = {}) {
	const queue = [];
	let pumping = false;

	async function pump() {
		if (pumping) return;
		pumping = true;
		try {
			while (queue.length) {
				const jobId = queue.shift();
				const job = localJobs.get(jobId);
				if (!job || job.status === EXPORT_JOB_STATUS.cancelled) continue;
				if (typeof runJob !== 'function') {
					job.status = EXPORT_JOB_STATUS.failed;
					job.error = 'no_runner';
					job.completedAt = Date.now();
					continue;
				}
				try {
					job.status = EXPORT_JOB_STATUS.running;
					job.startedAt = Date.now();
					job.result = await runJob(job);
					if (job.abortController.signal.aborted) {
						job.status = EXPORT_JOB_STATUS.cancelled;
						job.error = 'cancelled';
					} else {
						job.status = EXPORT_JOB_STATUS.completed;
						job.progress = 100;
					}
				} catch (err) {
					if (err?.code === 'EXPORT_CANCELLED' || job.abortController.signal.aborted) {
						job.status = EXPORT_JOB_STATUS.cancelled;
						job.error = 'cancelled';
					} else {
						job.status = EXPORT_JOB_STATUS.failed;
						job.error = err?.message || String(err);
					}
				} finally {
					job.completedAt = Date.now();
				}
			}
		} finally {
			pumping = false;
		}
	}

	return {
		kind: 'in_memory',
		async enqueue(job) {
			job.status = EXPORT_JOB_STATUS.queued;
			queue.push(job.id);
			void pump();
			return snapshotJob(job);
		},
		async cancel(jobId) {
			return cancelExportJob(jobId);
		},
		async getStatus(jobId) {
			return snapshotJob(getExportJob(jobId));
		},
	};
}

/**
 * Remote queue adapter — posts plans to API; worker renders later.
 * Does not perform pixel encoding itself.
 */
export function createRemoteExportQueueAdapter({ enqueueRemote } = {}) {
	return {
		kind: 'remote',
		async enqueue(job) {
			if (typeof enqueueRemote !== 'function') {
				throw new Error('remote enqueueRemote required');
			}
			job.status = EXPORT_JOB_STATUS.queued;
			const remote = await enqueueRemote({
				jobId: job.id,
				type: 'export',
				payload: job.request,
			});
			job.remoteJobId = remote?.id || remote?.jobId || null;
			return { ...snapshotJob(job), remoteJobId: job.remoteJobId };
		},
		async cancel(jobId) {
			const local = cancelExportJob(jobId);
			return local;
		},
		async getStatus(jobId) {
			return snapshotJob(getExportJob(jobId));
		},
	};
}
