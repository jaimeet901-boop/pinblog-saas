import pocketbaseClient from '../../utils/pocketbaseClient.js';
import {
	formatDateTime,
	formatDuration,
	formatRelative,
	jobTypeLabel,
	normalizeJobType,
	PRIORITY_WEIGHT,
} from './types.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

async function findBySource(sourceCollection, sourceId) {
	if (!sourceCollection || !sourceId) return null;
	return pocketbaseClient.collection('queue_jobs').getFirstListItem(
		pocketbaseClient.filter('source_collection = {:c} && source_id = {:id}', {
			c: sourceCollection,
			id: sourceId,
		}),
		{ requestKey: null },
	).catch(() => null);
}

export async function appendQueueEvent({ jobId, owner, level = 'info', message, payload = null }) {
	if (!jobId || !message) return null;
	return pocketbaseClient.collection('queue_job_events').create({
		job: jobId,
		owner: owner || undefined,
		at: new Date().toISOString(),
		level,
		message: String(message).slice(0, 2000),
		payload: payload || null,
	}).catch(() => null);
}

export async function resolveWorkspaceMeta(ownerId, workspaceKey = '') {
	const key = String(workspaceKey || ownerId || '').trim();
	if (!key) {
		return { workspace: null, workspace_key: '', workspace_label: '—' };
	}
	const byKey = await pocketbaseClient.collection('workspaces').getFirstListItem(
		pocketbaseClient.filter('workspace_key = {:key}', { key }),
		{ requestKey: null },
	).catch(() => null);
	if (byKey) {
		return {
			workspace: byKey.id,
			workspace_key: byKey.workspace_key || key,
			workspace_label: byKey.name || byKey.slug || key,
		};
	}
	const byOwner = await pocketbaseClient.collection('workspaces').getFirstListItem(
		pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		{ requestKey: null },
	).catch(() => null);
	if (byOwner) {
		return {
			workspace: byOwner.id,
			workspace_key: byOwner.workspace_key || key,
			workspace_label: byOwner.name || byOwner.slug || key,
		};
	}
	return {
		workspace: null,
		workspace_key: key,
		workspace_label: key,
	};
}

export async function enqueueJob({
	owner,
	workspaceKey,
	type,
	priority = 'normal',
	status = 'queued',
	payload = {},
	inputs = null,
	outputs = null,
	provider = '',
	model = '',
	credits = 0,
	maxAttempts = 3,
	sourceCollection = '',
	sourceId = '',
	correlationId = '',
	progress = 0,
	workerId = '',
	meta = {},
}) {
	const jobType = normalizeJobType(type);
	if (!owner || !jobType) {
		throw httpError(422, 'owner and type are required', 'VALIDATION_ERROR');
	}

	if (sourceCollection && sourceId) {
		const existing = await findBySource(sourceCollection, sourceId);
		if (existing) return existing;
	}

	const workspaceMeta = await resolveWorkspaceMeta(owner, workspaceKey);
	const job = await pocketbaseClient.collection('queue_jobs').create({
		owner,
		workspace: workspaceMeta.workspace || undefined,
		workspace_key: workspaceMeta.workspace_key,
		workspace_label: workspaceMeta.workspace_label,
		type: jobType,
		status,
		priority: PRIORITY_WEIGHT[priority] != null ? priority : 'normal',
		payload: payload || {},
		inputs: inputs || payload || {},
		outputs: outputs || {},
		progress: Number(progress) || 0,
		attempt_count: 0,
		max_attempts: Number(maxAttempts) || 3,
		started_at: '',
		completed_at: '',
		duration_ms: 0,
		worker_id: workerId || '',
		error: '',
		failure_reason: '',
		provider: provider || '',
		model: model || '',
		credits: Number(credits) || 0,
		next_retry_at: '',
		dead_letter: false,
		claim_token: '',
		claim_version: 0,
		source_collection: sourceCollection || '',
		source_id: sourceId || '',
		correlation_id: correlationId || '',
		paused_at: '',
		meta: meta || {},
	});

	await appendQueueEvent({
		jobId: job.id,
		owner,
		message: 'Job enqueued',
		payload: { type: jobType, status },
	});

	return job;
}

export async function upsertMirroredJob(patch) {
	const {
		sourceCollection,
		sourceId,
		owner,
		workspaceKey,
		type,
		status,
		priority = 'normal',
		payload = {},
		inputs = null,
		outputs = null,
		progress = 0,
		attemptCount,
		maxAttempts,
		provider = '',
		model = '',
		credits = 0,
		workerId = '',
		error = '',
		startedAt = '',
		completedAt = '',
		durationMs,
		deadLetter = false,
		nextRetryAt = '',
		correlationId = '',
		meta = {},
		eventMessage = '',
	} = patch;

	if (!sourceCollection || !sourceId || !owner || !type) return null;

	const existing = await findBySource(sourceCollection, sourceId);
	const workspaceMeta = existing
		? {
			workspace: existing.workspace,
			workspace_key: existing.workspace_key,
			workspace_label: existing.workspace_label,
		}
		: await resolveWorkspaceMeta(owner, workspaceKey);

	const body = {
		owner,
		workspace: workspaceMeta.workspace || undefined,
		workspace_key: workspaceMeta.workspace_key,
		workspace_label: workspaceMeta.workspace_label,
		type: normalizeJobType(type),
		status,
		priority,
		payload,
		inputs: inputs || payload || {},
		outputs: outputs || {},
		progress: Number(progress) || 0,
		attempt_count: Number(attemptCount) || 0,
		max_attempts: Number(maxAttempts) || 3,
		worker_id: workerId || '',
		error: error || '',
		failure_reason: error || '',
		provider: provider || '',
		model: model || '',
		credits: Number(credits) || 0,
		started_at: startedAt || '',
		completed_at: completedAt || '',
		duration_ms: Number(durationMs) || 0,
		dead_letter: Boolean(deadLetter),
		next_retry_at: nextRetryAt || '',
		source_collection: sourceCollection,
		source_id: sourceId,
		correlation_id: correlationId || existing?.correlation_id || '',
		meta: { ...(existing?.meta || {}), ...meta },
	};

	const job = existing
		? await pocketbaseClient.collection('queue_jobs').update(existing.id, body).catch(() => existing)
		: await pocketbaseClient.collection('queue_jobs').create(body).catch(() => null);

	if (job && eventMessage) {
		await appendQueueEvent({
			jobId: job.id,
			owner,
			message: eventMessage,
			payload: { status, progress },
		});
	}
	return job;
}

export async function updateQueueJob(jobId, updates = {}, eventMessage = '') {
	const job = await pocketbaseClient.collection('queue_jobs').update(jobId, updates).catch(() => null);
	if (job && eventMessage) {
		await appendQueueEvent({
			jobId: job.id,
			owner: job.owner,
			message: eventMessage,
			payload: updates,
		});
	}
	return job;
}

export async function getQueueJob(jobId) {
	return pocketbaseClient.collection('queue_jobs').getOne(jobId, {
		expand: 'owner,workspace',
	}).catch(() => null);
}

export async function listQueueEvents(jobId, limit = 50) {
	const result = await pocketbaseClient.collection('queue_job_events').getList(1, limit, {
		filter: pocketbaseClient.filter('job = {:job}', { job: jobId }),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return (result.items || []).reverse();
}

function ownerName(job) {
	const user = job.expand?.owner;
	if (!user) return job.owner || '—';
	return user.name || user.email || user.username || job.owner || '—';
}

function workspaceName(job) {
	return job.workspace_label
		|| job.expand?.workspace?.name
		|| job.workspace_key
		|| '—';
}

export function mapQueueJobDto(job, { events = [], includeDetail = false } = {}) {
	const durationMs = Number(job.duration_ms) || (
		job.started_at && (job.completed_at || job.status === 'running')
			? Math.max(0, new Date(job.completed_at || Date.now()).getTime() - new Date(job.started_at).getTime())
			: 0
	);
	const timeline = events.map((event) => ({
		text: event.message,
		time: formatDateTime(event.at || event.created).split(' ')[1] || formatDateTime(event.at || event.created),
	}));
	const logs = events.map((event) => `[${event.level || 'info'}] ${event.message}`);

	const dto = {
		id: job.id,
		type: jobTypeLabel(job.type),
		typeCode: job.type,
		workspace: workspaceName(job),
		workspaceKey: job.workspace_key || '',
		owner: ownerName(job),
		ownerId: job.owner,
		provider: job.provider || '—',
		model: job.model || '—',
		priority: job.priority || 'normal',
		status: job.status,
		progress: Number(job.progress) || 0,
		worker: job.worker_id || '—',
		created: formatDateTime(job.created),
		started: formatDateTime(job.started_at),
		duration: formatDuration(durationMs),
		durationMs,
		credits: Number(job.credits) || 0,
		retries: Number(job.attempt_count) || 0,
		maxAttempts: Number(job.max_attempts) || 3,
		failureReason: job.failure_reason || job.error || '—',
		deadLetter: Boolean(job.dead_letter),
		sourceCollection: job.source_collection || '',
		sourceId: job.source_id || '',
		correlationId: job.correlation_id || '',
		age: formatRelative(job.created),
		name: jobTypeLabel(job.type),
		updatedAt: job.updated,
		createdAt: job.created,
	};

	if (includeDetail) {
		dto.inputs = job.inputs || job.payload || {};
		dto.outputs = job.outputs || {};
		dto.payload = job.payload || {};
		dto.timeline = timeline;
		dto.logs = logs;
		dto.meta = job.meta || {};
		dto.nextRetryAt = job.next_retry_at || null;
		dto.pausedAt = job.paused_at || null;
	}

	return dto;
}

export async function mapQueueJobDetail(job) {
	const events = await listQueueEvents(job.id, 100);
	return mapQueueJobDto(job, { events, includeDetail: true });
}

export { httpError, findBySource };
