import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { mapWpStatus } from './wordpress-client.js';
import { resolvePublishSite } from './wordpress-sites.js';
import { mirrorWordpressJob } from './queue/mirrors.js';

function workspaceKeyFor(userId) {
	return String(userId || '').trim();
}

function asStringArray(value) {
	if (!value) return [];
	if (Array.isArray(value)) {
		return value.map((item) => String(item).trim()).filter(Boolean);
	}
	if (typeof value === 'string') {
		return value.split(',').map((item) => item.trim()).filter(Boolean);
	}
	return [];
}

export function mapPublishJob(job) {
	return {
		id: job.id,
		siteId: job.site,
		articleId: job.article_id || null,
		title: job.title,
		excerpt: job.excerpt || '',
		slug: job.slug || '',
		wpStatus: job.wp_status,
		status: job.status,
		progress: Number(job.progress) || 0,
		attemptCount: Number(job.attempt_count) || 0,
		maxAttempts: Number(job.max_attempts) || 3,
		scheduledAt: job.scheduled_at || null,
		timezone: job.timezone || 'UTC',
		startedAt: job.started_at || null,
		completedAt: job.completed_at || null,
		lastError: job.last_error || '',
		wpPostId: job.wp_post_id || null,
		wpPostUrl: job.wp_post_url || '',
		wpMediaId: job.wp_media_id || null,
		mediaIds: job.media_ids || [],
		deadLetter: Boolean(job.dead_letter),
		idempotencyKey: job.idempotency_key || '',
		created: job.created,
		updated: job.updated,
	};
}

export function mapPublishHistory(row) {
	return {
		id: row.id,
		jobId: row.job || null,
		siteId: row.site || null,
		title: row.title || '',
		wpStatus: row.wp_status || '',
		result: row.result || '',
		wpPostId: row.wp_post_id || null,
		publishedUrl: row.published_url || '',
		publishedAt: row.published_at || null,
		durationMs: Number(row.duration_ms) || 0,
		error: row.error || '',
		meta: row.meta || {},
		created: row.created,
	};
}

export async function enqueueWordpressPublish(ownerId, payload = {}) {
	const siteId = payload.siteId || payload.websiteId;
	const { site } = await resolvePublishSite({
		ownerId,
		siteId,
		websiteId: payload.websiteId,
	});

	const title = String(payload.title || '').trim();
	const content = String(payload.content || '').trim();
	if (!title) throw httpError(422, 'title is required', 'VALIDATION_ERROR');
	if (!content) throw httpError(422, 'content is required', 'VALIDATION_ERROR');

	const scheduledAt = payload.scheduledAt || payload.scheduled_at || null;
	const wpStatus = mapWpStatus(payload.status || payload.wpStatus || 'draft', scheduledAt);
	const immediate = !scheduledAt && wpStatus !== 'future';
	const idempotencyKey = String(payload.idempotencyKey || payload.clientToken || '').trim()
		|| `wp-${ownerId}-${site.id}-${Date.now()}-${randomBytes(4).toString('hex')}`;

	if (payload.idempotencyKey) {
		try {
			const existing = await pocketbaseClient.collection('publish_jobs').getFirstListItem(
				pocketbaseClient.filter('owner = {:owner} && idempotency_key = {:key}', {
					owner: ownerId,
					key: idempotencyKey,
				}),
				{ requestKey: null },
			);
			return mapPublishJob(existing);
		} catch {
			// continue
		}
	}

	const job = await pocketbaseClient.collection('publish_jobs').create({
		owner: ownerId,
		workspace_key: workspaceKeyFor(ownerId),
		site: site.id,
		article_id: payload.articleId || payload.article_id || '',
		title,
		content,
		excerpt: String(payload.excerpt || '').slice(0, 5000),
		slug: String(payload.slug || '').slice(0, 300),
		meta_description: String(payload.metaDescription || payload.meta_description || '').slice(0, 1000),
		featured_image_url: String(payload.featuredImageUrl || payload.featured_image_url || payload.featuredImage || '').slice(0, 2000),
		categories: asStringArray(payload.categories || payload.category || payload.wpCategory),
		tags: asStringArray(payload.tags),
		seo: payload.seo && typeof payload.seo === 'object' ? payload.seo : {},
		recipe_card: payload.recipeCard || payload.recipe_card || null,
		payload: {
			updatePostId: payload.postId || payload.wpPostId || null,
			contentType: String(payload.contentType || payload.type || 'post').toLowerCase() === 'page' ? 'page' : 'post',
			authorId: payload.authorId || payload.author || null,
		},
		wp_status: wpStatus,
		scheduled_at: scheduledAt || '',
		timezone: payload.timezone || 'UTC',
		status: immediate ? 'queued' : 'scheduled',
		progress: 0,
		attempt_count: 0,
		max_attempts: Number(payload.maxAttempts) || 3,
		next_retry_at: '',
		last_error: '',
		idempotency_key: idempotencyKey,
		dead_letter: false,
		claim_token: '',
		claim_version: 0,
		media_ids: [],
	});

	await mirrorWordpressJob(job, 'WordPress publish job enqueued').catch(() => null);

	return mapPublishJob(job);
}

export async function listPublishJobs(ownerId, query = {}) {
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const status = String(query.status || '').trim();
	let filter = pocketbaseClient.filter('owner = {:owner}', { owner: ownerId });
	if (status) {
		filter = pocketbaseClient.filter('owner = {:owner} && status = {:status}', { owner: ownerId, status });
	}
	const result = await pocketbaseClient.collection('publish_jobs').getList(page, perPage, {
		filter,
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], page: 1, perPage, totalItems: 0, totalPages: 0 }));

	return {
		items: result.items.map(mapPublishJob),
		page: result.page,
		perPage: result.perPage,
		totalItems: result.totalItems,
		totalPages: result.totalPages,
	};
}

export async function getPublishJob(ownerId, jobId) {
	const job = await pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
	if (!job || job.owner !== ownerId) {
		throw httpError(404, 'Publish job not found', 'NOT_FOUND');
	}
	return mapPublishJob(job);
}

export async function retryPublishJob(ownerId, jobId) {
	const job = await pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
	if (!job || job.owner !== ownerId) {
		throw httpError(404, 'Publish job not found', 'NOT_FOUND');
	}
	if (!['failed', 'cancelled'].includes(job.status)) {
		throw httpError(400, 'Only failed or cancelled jobs can be retried', 'INVALID_STATUS');
	}
	const updated = await pocketbaseClient.collection('publish_jobs').update(job.id, {
		status: 'queued',
		progress: 0,
		dead_letter: false,
		last_error: '',
		next_retry_at: '',
		claim_token: '',
		attempt_count: 0,
	});
	return mapPublishJob(updated);
}

export async function cancelPublishJob(ownerId, jobId) {
	const job = await pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
	if (!job || job.owner !== ownerId) {
		throw httpError(404, 'Publish job not found', 'NOT_FOUND');
	}
	if (['published', 'cancelled'].includes(job.status)) {
		throw httpError(400, 'Job cannot be cancelled', 'INVALID_STATUS');
	}
	const updated = await pocketbaseClient.collection('publish_jobs').update(job.id, {
		status: 'cancelled',
		completed_at: new Date().toISOString(),
		last_error: 'Cancelled by user',
	});
	return mapPublishJob(updated);
}

export async function listPublishHistory(ownerId, query = {}) {
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const result = await pocketbaseClient.collection('publish_history').getList(page, perPage, {
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], page: 1, perPage, totalItems: 0, totalPages: 0 }));

	return {
		items: result.items.map(mapPublishHistory),
		page: result.page,
		perPage: result.perPage,
		totalItems: result.totalItems,
		totalPages: result.totalPages,
	};
}

export async function writePublishHistory({
	ownerId,
	workspaceKey,
	siteId,
	jobId,
	title,
	wpStatus,
	result,
	wpPostId,
	publishedUrl,
	publishedAt,
	durationMs,
	error,
	meta = {},
}) {
	return pocketbaseClient.collection('publish_history').create({
		owner: ownerId,
		workspace_key: workspaceKey,
		site: siteId,
		job: jobId,
		title,
		wp_status: wpStatus,
		result,
		wp_post_id: wpPostId || 0,
		published_url: publishedUrl || '',
		published_at: publishedAt || new Date().toISOString(),
		duration_ms: durationMs || 0,
		error: error || '',
		meta,
	}).catch(() => null);
}

export async function getWordpressPublishAnalytics(ownerId, query = {}) {
	const siteId = String(query.siteId || '').trim();
	const historyFilter = siteId
		? pocketbaseClient.filter('owner = {:owner} && site = {:site}', { owner: ownerId, site: siteId })
		: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId });
	const jobsFilter = siteId
		? pocketbaseClient.filter('owner = {:owner} && site = {:site}', { owner: ownerId, site: siteId })
		: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId });

	const [history, jobs, failedJobs] = await Promise.all([
		pocketbaseClient.collection('publish_history').getFullList({
			filter: historyFilter,
			requestKey: null,
		}).catch(() => []),
		pocketbaseClient.collection('publish_jobs').getList(1, 1, {
			filter: jobsFilter,
			requestKey: null,
		}).catch(() => ({ totalItems: 0 })),
		pocketbaseClient.collection('publish_jobs').getList(1, 1, {
			filter: `${jobsFilter} && status = "failed"`,
			requestKey: null,
		}).catch(() => ({ totalItems: 0 })),
	]);

	const published = history.filter((row) => row.result === 'published').length;
	const drafts = history.filter((row) => row.result === 'draft').length;
	const scheduled = history.filter((row) => row.result === 'scheduled').length;
	const failed = history.filter((row) => row.result === 'failed').length
		+ (Number(failedJobs.totalItems) || 0);
	const attempts = history.length || Number(jobs.totalItems) || 0;
	const successRate = attempts
		? Math.round((published / Math.max(attempts, 1)) * 1000) / 10
		: 0;

	return {
		published,
		drafts,
		scheduled,
		failed,
		attempts,
		successRate,
		jobs: Number(jobs.totalItems) || 0,
		history: history.slice(0, 25).map(mapPublishHistory),
	};
}
