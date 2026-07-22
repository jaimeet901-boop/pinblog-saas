import { mapSourceStatusToQueue } from './types.js';
import { upsertMirroredJob } from './jobs.js';

export async function mirrorWordpressJob(job, eventMessage = '') {
	if (!job?.id) return null;
	return upsertMirroredJob({
		sourceCollection: 'publish_jobs',
		sourceId: job.id,
		owner: job.owner,
		workspaceKey: job.workspace_key || job.owner,
		type: 'wordpress_publishing',
		status: mapSourceStatusToQueue('publish_jobs', job.status),
		priority: 'normal',
		payload: {
			title: job.title,
			site: job.site,
			articleId: job.article_id,
			wpStatus: job.wp_status,
		},
		inputs: {
			title: job.title,
			site: job.site,
			slug: job.slug,
		},
		outputs: {
			wpPostId: job.wp_post_id || null,
			wpPostUrl: job.wp_post_url || null,
		},
		progress: Number(job.progress) || (job.status === 'published' ? 100 : 0),
		attemptCount: job.attempt_count,
		maxAttempts: job.max_attempts,
		provider: 'WordPress',
		error: job.last_error || '',
		startedAt: job.started_at || '',
		completedAt: job.completed_at || '',
		deadLetter: Boolean(job.dead_letter),
		nextRetryAt: job.next_retry_at || '',
		workerId: job.status === 'publishing' ? 'worker-wordpress-publish' : '',
		eventMessage,
	});
}

export async function mirrorPinterestJob(job, pin = null, eventMessage = '') {
	if (!job?.id) return null;
	return upsertMirroredJob({
		sourceCollection: 'pinterest_publish_jobs',
		sourceId: job.id,
		owner: job.owner,
		workspaceKey: job.owner,
		type: 'pinterest_publishing',
		status: mapSourceStatusToQueue('pinterest_publish_jobs', job.status),
		priority: 'high',
		payload: {
			boardId: job.board_id,
			boardName: job.board_name,
			accountId: job.account,
			aiPinId: job.ai_pin,
		},
		inputs: {
			title: pin?.title || job.board_name,
			board: job.board_name,
			imageUrl: pin?.image_url || '',
		},
		outputs: {
			pinterestPinId: job.pinterest_pin_id || null,
			pinterestPinUrl: job.pinterest_pin_url || null,
		},
		progress: job.status === 'published' ? 100 : job.status === 'publishing' ? 55 : 0,
		attemptCount: job.attempt_count,
		maxAttempts: job.max_attempts,
		provider: 'Pinterest',
		error: job.last_error || '',
		startedAt: job.status === 'publishing' || job.published_at ? (job.updated || '') : '',
		completedAt: job.published_at || '',
		deadLetter: job.status === 'failed' && Number(job.attempt_count) >= Number(job.max_attempts || 3),
		nextRetryAt: job.next_retry_at || '',
		workerId: job.status === 'publishing' ? 'worker-pinterest-publish' : '',
		eventMessage,
	});
}

export async function mirrorImageJob(job, eventMessage = '') {
	if (!job?.id) return null;
	return upsertMirroredJob({
		sourceCollection: 'ai_pin_image_jobs',
		sourceId: job.id,
		owner: job.owner,
		workspaceKey: job.owner,
		type: 'image_generation',
		status: mapSourceStatusToQueue('ai_pin_image_jobs', job.status),
		priority: 'normal',
		payload: {
			aiPinId: job.ai_pin,
			prompt: job.prompt || '',
		},
		inputs: {
			prompt: job.prompt || job.positive_prompt || '',
			model: job.model || '',
		},
		outputs: {
			imageUrl: job.image_url || job.result_url || null,
		},
		progress: job.status === 'completed' || job.status === 'fallback' ? 100 : job.status === 'processing' ? 42 : 0,
		attemptCount: job.attempt_count || job.attempts,
		maxAttempts: job.max_attempts || 3,
		provider: job.provider || 'Fal.ai',
		model: job.model || '',
		error: job.last_error || job.error || '',
		startedAt: job.started_at || '',
		completedAt: job.completed_at || '',
		workerId: job.status === 'processing' ? 'worker-image-gen' : '',
		eventMessage,
	});
}
