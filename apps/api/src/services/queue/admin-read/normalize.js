import { mapSourceStatusToQueue } from '../types.js';

export const CHANNEL_COLLECTIONS = Object.freeze([
	'pinterest_publish_jobs',
	'publish_jobs',
	'ai_pin_image_jobs',
]);

const COLLECTION_JOB_TYPE = Object.freeze({
	pinterest_publish_jobs: 'pinterest_publishing',
	publish_jobs: 'wordpress_publishing',
	ai_pin_image_jobs: 'image_generation',
});

export function makeSyntheticId(sourceCollection, sourceId) {
	if (!sourceCollection || !sourceId) return '';
	return `${sourceCollection}:${sourceId}`;
}

export function parseSyntheticId(id) {
	const raw = String(id || '').trim();
	if (!raw.includes(':')) return null;
	const [sourceCollection, ...rest] = raw.split(':');
	const sourceId = rest.join(':');
	if (!CHANNEL_COLLECTIONS.includes(sourceCollection) || !sourceId) return null;
	return { sourceCollection, sourceId };
}

export function makeSourceKey(sourceCollection, sourceId) {
	return makeSyntheticId(sourceCollection, sourceId);
}

function mapPinterestStatus(job) {
	let status = mapSourceStatusToQueue('pinterest_publish_jobs', job.status);
	if (job.status === 'scheduled' && Number(job.attempt_count || 0) > 0) {
		status = 'retrying';
	}
	return status;
}

function mapWordpressStatus(job) {
	let status = mapSourceStatusToQueue('publish_jobs', job.status);
	if (
		(job.status === 'queued' || job.status === 'scheduled')
		&& Number(job.attempt_count || 0) > 0
	) {
		status = 'retrying';
	}
	return status;
}

function mapImageStatus(job) {
	return mapSourceStatusToQueue('ai_pin_image_jobs', job.status);
}

function pinterestProgress(job) {
	if (job.status === 'published') return 100;
	if (job.status === 'publishing') return 55;
	if (job.status === 'waiting_provider') return 15;
	return 0;
}

function wordpressProgress(job) {
	return Number(job.progress) || (job.status === 'published' ? 100 : 0);
}

function imageProgress(job) {
	if (job.status === 'completed' || job.status === 'fallback') return 100;
	if (job.status === 'processing') return 42;
	return 0;
}

/**
 * Map a channel collection row to a queue_jobs-shaped record for mapQueueJobDto.
 * @param {string} sourceCollection
 * @param {object} job
 * @param {{ queueJobId?: string|null, readSource?: string, pin?: object|null }} [options]
 */
export function normalizeChannelJob(sourceCollection, job, { queueJobId = null, readSource = 'channel', pin = null } = {}) {
	if (!job?.id) return null;

	const sourceId = job.id;
	const syntheticId = makeSyntheticId(sourceCollection, sourceId);
	const type = COLLECTION_JOB_TYPE[sourceCollection] || '';

	let status = 'queued';
	let priority = 'normal';
	let provider = '—';
	let model = '—';
	let progress = 0;
	let payload = {};
	let inputs = {};
	let outputs = {};
	let workerId = '';
	let startedAt = '';
	let completedAt = '';
	let deadLetter = false;

	if (sourceCollection === 'publish_jobs') {
		status = mapWordpressStatus(job);
		provider = 'WordPress';
		progress = wordpressProgress(job);
		payload = {
			title: job.title,
			site: job.site,
			articleId: job.article_id,
			wpStatus: job.wp_status,
			workflowId: job.workflow_id || job.payload?.workflowId || '',
		};
		inputs = {
			title: job.title,
			site: job.site,
			slug: job.slug,
		};
		outputs = {
			wpPostId: job.wp_post_id || null,
			wpPostUrl: job.wp_post_url || null,
			pinterestJobId: job.pinterest_job_id || job.payload?.pinterestJobId || null,
		};
		workerId = job.status === 'publishing' ? 'worker-wordpress-publish' : '';
		startedAt = job.started_at || '';
		completedAt = job.completed_at || '';
		deadLetter = Boolean(job.dead_letter);
	} else if (sourceCollection === 'pinterest_publish_jobs') {
		status = mapPinterestStatus(job);
		priority = 'high';
		provider = 'Pinterest';
		progress = pinterestProgress(job);
		payload = {
			boardId: job.board_id,
			boardName: job.board_name,
			accountId: job.account,
			aiPinId: job.ai_pin,
			workflowId: job.workflow_id || '',
			sourcePublishJob: job.source_publish_job || '',
		};
		inputs = {
			title: pin?.title || job.board_name,
			board: job.board_name,
			imageUrl: pin?.image_url || '',
			destinationUrl: job.destination_url || '',
		};
		outputs = {
			pinterestPinId: job.pinterest_pin_id || null,
			pinterestPinUrl: job.pinterest_pin_url || null,
		};
		workerId = job.status === 'publishing' ? 'worker-pinterest-publish' : '';
		startedAt = job.status === 'publishing' || job.published_at ? (job.updated || '') : '';
		completedAt = job.published_at || '';
		deadLetter = job.status === 'failed'
			&& Number(job.attempt_count) >= Number(job.max_attempts || 3);
	} else if (sourceCollection === 'ai_pin_image_jobs') {
		status = mapImageStatus(job);
		provider = job.provider || 'Fal.ai';
		model = job.model || '';
		progress = imageProgress(job);
		payload = {
			aiPinId: job.ai_pin,
			prompt: job.prompt || '',
		};
		inputs = {
			prompt: job.prompt || job.positive_prompt || '',
			model: job.model || '',
		};
		outputs = {
			imageUrl: job.image_url || job.result_url || null,
		};
		workerId = job.status === 'processing' ? 'worker-image-gen' : '';
		startedAt = job.started_at || '';
		completedAt = job.completed_at || '';
	}

	const sortTime = job.updated || job.created || '';

	return {
		id: syntheticId,
		type,
		status,
		priority,
		progress,
		payload,
		inputs,
		outputs,
		meta: job.meta || {},
		attempt_count: Number(job.attempt_count ?? job.attempts) || 0,
		max_attempts: Number(job.max_attempts) || 3,
		provider,
		model,
		error: job.last_error || job.error || '',
		failure_reason: job.last_error || job.error || '',
		credits: Number(job.credits) || 0,
		owner: job.owner,
		workspace_key: job.workspace_key || '',
		workspace_label: job.workspace_label || '',
		worker_id: workerId,
		started_at: startedAt,
		completed_at: completedAt,
		dead_letter: deadLetter,
		next_retry_at: job.next_retry_at || '',
		paused_at: job.paused_at || '',
		source_collection: sourceCollection,
		source_id: sourceId,
		correlation_id: job.correlation_id || '',
		duration_ms: Number(job.duration_ms) || 0,
		created: job.created,
		updated: job.updated,
		expand: job.expand || {},
		_readSource: readSource,
		_queueJobId: queueJobId || null,
		_sortTime: sortTime,
	};
}

export function normalizeNativeJob(job, { readSource = 'native' } = {}) {
	if (!job?.id) return null;
	const isMirrored = Boolean(String(job.source_collection || '').trim());
	return {
		...job,
		_readSource: isMirrored ? 'mirror' : readSource,
		_queueJobId: job.id,
		_sortTime: job.updated || job.created || '',
	};
}
