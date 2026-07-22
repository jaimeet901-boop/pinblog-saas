import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import {
	createOrUpdateWordpressPost,
	uploadWordpressMedia,
} from './wordpress-client.js';
import { getSiteCredentialsPlain } from './wordpress-sites.js';
import { writePublishHistory } from './wordpress-publish.js';

const POLL_INTERVAL_MS = Number.parseInt(process.env.WORDPRESS_QUEUE_POLL_MS || '10000', 10);
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.WORDPRESS_QUEUE_BATCH || '5', 10);
const STUCK_MS = Number.parseInt(process.env.WORDPRESS_QUEUE_STUCK_MS || String(10 * 60 * 1000), 10);

let workerTimer = null;
let running = false;
let processedTotal = 0;
let failedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';

function nextRetryDate(attemptCount = 1) {
	const capped = Math.max(1, Math.min(10, attemptCount));
	const delays = [0, 30_000, 120_000, 300_000];
	const delay = delays[Math.min(capped, delays.length - 1)] || capped * 60_000;
	return new Date(Date.now() + delay).toISOString();
}

async function claimJob(jobId) {
	const current = await pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
	if (!current || !['queued', 'scheduled'].includes(current.status)) {
		return null;
	}

	const claimToken = randomBytes(16).toString('hex');
	const nextVersion = Number(current.claim_version || 0) + 1;
	const locked = await pocketbaseClient.collection('publish_jobs').update(jobId, {
		status: 'publishing',
		claim_token: claimToken,
		claim_version: nextVersion,
		started_at: current.started_at || new Date().toISOString(),
		progress: 10,
	}).catch(() => null);

	if (!locked || locked.status !== 'publishing') return null;

	const verified = await pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
	if (!verified || verified.status !== 'publishing' || verified.claim_token !== claimToken) {
		return null;
	}
	return verified;
}

async function markAuthFailure(siteId, websiteId, message) {
	await pocketbaseClient.collection('wordpress_sites').update(siteId, {
		status: 'failed',
		last_error: message,
		last_tested_at: new Date().toISOString(),
	}).catch(() => null);
	if (websiteId) {
		await pocketbaseClient.collection('websites').update(websiteId, { status: 'failed' }).catch(() => null);
	}
}

async function processJob(job) {
	const started = Date.now();
	const ownerId = job.owner;

	if (job.wp_post_id && job.wp_post_url && job.status === 'publishing') {
		// Idempotent success path if already published mid-flight
		await pocketbaseClient.collection('publish_jobs').update(job.id, {
			status: 'published',
			progress: 100,
			completed_at: job.completed_at || new Date().toISOString(),
			last_error: '',
		});
		return;
	}

	const { site, username, appPassword } = await getSiteCredentialsPlain(job.site, ownerId);

	await pocketbaseClient.collection('publish_jobs').update(job.id, { progress: 25 }).catch(() => null);

	let mediaId = Number(job.wp_media_id) || 0;
	const mediaIds = Array.isArray(job.media_ids) ? [...job.media_ids] : [];

	if (job.featured_image_url && !mediaId) {
		try {
			const uploaded = await uploadWordpressMedia({
				url: site.url,
				username,
				appPassword,
				imageUrl: job.featured_image_url,
				filename: `${job.slug || 'featured'}.jpg`,
			});
			mediaId = Number(uploaded?.id) || 0;
			if (mediaId) mediaIds.push(mediaId);
			await pocketbaseClient.collection('publish_jobs').update(job.id, {
				wp_media_id: mediaId,
				media_ids: mediaIds,
				progress: 55,
			}).catch(() => null);
		} catch (error) {
			// Retryable media failure — bubble unless attempts exhausted later
			error.retryable = true;
			throw error;
		}
	} else {
		await pocketbaseClient.collection('publish_jobs').update(job.id, { progress: 55 }).catch(() => null);
	}

	const updatePostId = job.payload?.updatePostId || job.wp_post_id || null;
	const result = await createOrUpdateWordpressPost({
		url: site.url,
		username,
		appPassword,
		postId: updatePostId || undefined,
		title: job.title,
		content: job.content,
		excerpt: job.excerpt,
		slug: job.slug,
		status: job.wp_status,
		scheduledAt: job.scheduled_at,
		categories: job.categories || [],
		tags: job.tags || [],
		featuredMediaId: mediaId || undefined,
		metaDescription: job.meta_description,
		seo: job.seo || {},
		recipeCard: job.recipe_card || null,
	});

	const completedAt = new Date().toISOString();
	const durationMs = Date.now() - started;
	const historyResult = result.status === 'future'
		? 'scheduled'
		: (result.status === 'draft' || result.status === 'pending' || result.status === 'private' ? 'draft' : 'published');

	await pocketbaseClient.collection('publish_jobs').update(job.id, {
		status: 'published',
		progress: 100,
		wp_post_id: result.id,
		wp_post_url: result.link,
		wp_media_id: mediaId || 0,
		media_ids: mediaIds,
		completed_at: completedAt,
		last_error: '',
		next_retry_at: '',
		dead_letter: false,
	});

	await writePublishHistory({
		ownerId,
		workspaceKey: job.workspace_key,
		siteId: site.id,
		jobId: job.id,
		title: job.title,
		wpStatus: result.status,
		result: historyResult,
		wpPostId: result.id,
		publishedUrl: result.link,
		publishedAt: completedAt,
		durationMs,
		meta: { slug: result.slug, mediaId },
	});

	if (job.article_id) {
		await pocketbaseClient.collection('articles').update(job.article_id, {
			status: historyResult === 'published' ? 'published' : (historyResult === 'scheduled' ? 'scheduled' : 'draft'),
		}).catch(() => null);
	}

	if (site.status !== 'connected' && site.status !== 'active') {
		await pocketbaseClient.collection('wordpress_sites').update(site.id, {
			status: 'connected',
			last_error: '',
		}).catch(() => null);
	}
}

async function failOrRetry(job, error) {
	const attempt = Number(job.attempt_count || 0) + 1;
	const maxAttempts = Number(job.max_attempts) || 3;
	const authFailed = Boolean(error?.authFailed || error?.status === 401 || error?.status === 403);
	const retryable = !authFailed && (error?.retryable !== false) && attempt < maxAttempts;

	if (authFailed) {
		const site = await pocketbaseClient.collection('wordpress_sites').getOne(job.site).catch(() => null);
		await markAuthFailure(job.site, site?.website, error.message);
	}

	if (retryable) {
		await pocketbaseClient.collection('publish_jobs').update(job.id, {
			status: job.scheduled_at ? 'scheduled' : 'queued',
			attempt_count: attempt,
			next_retry_at: nextRetryDate(attempt),
			last_error: error.message,
			progress: 0,
			claim_token: '',
		});
		return;
	}

	const completedAt = new Date().toISOString();
	await pocketbaseClient.collection('publish_jobs').update(job.id, {
		status: 'failed',
		attempt_count: attempt,
		last_error: error.message,
		completed_at: completedAt,
		progress: 100,
		dead_letter: true,
		claim_token: '',
	});

	await writePublishHistory({
		ownerId: job.owner,
		workspaceKey: job.workspace_key,
		siteId: job.site,
		jobId: job.id,
		title: job.title,
		wpStatus: job.wp_status,
		result: 'failed',
		error: error.message,
		publishedAt: completedAt,
		durationMs: 0,
	});
}

async function recoverStuckJobs() {
	const cutoff = new Date(Date.now() - STUCK_MS).toISOString();
	const stuck = await pocketbaseClient.collection('publish_jobs').getFullList({
		filter: pocketbaseClient.filter('status = "publishing" && updated < {:cutoff}', { cutoff }),
		requestKey: null,
	}).catch(() => []);

	for (const job of stuck) {
		await pocketbaseClient.collection('publish_jobs').update(job.id, {
			status: 'queued',
			claim_token: '',
			last_error: 'Recovered stuck publishing job',
			next_retry_at: '',
		}).catch(() => null);
	}
}

async function loadDueJobs() {
	const now = new Date().toISOString();
	const [queued, scheduled] = await Promise.all([
		pocketbaseClient.collection('publish_jobs').getList(1, MAX_JOBS_PER_TICK, {
			filter: pocketbaseClient.filter('status = "queued"', {}),
			sort: 'created',
			requestKey: null,
		}).catch(() => ({ items: [] })),
		pocketbaseClient.collection('publish_jobs').getList(1, MAX_JOBS_PER_TICK, {
			filter: pocketbaseClient.filter('status = "scheduled" && scheduled_at <= {:now}', { now }),
			sort: 'scheduled_at',
			requestKey: null,
		}).catch(() => ({ items: [] })),
	]);

	const merged = [...(queued.items || []), ...(scheduled.items || [])];
	return merged.filter((job) => {
		if (!job.next_retry_at) return true;
		return new Date(job.next_retry_at).getTime() <= Date.now();
	}).slice(0, MAX_JOBS_PER_TICK);
}

async function tick() {
	if (running) return;
	running = true;
	lastRunAt = new Date().toISOString();
	try {
		await recoverStuckJobs();
		const due = await loadDueJobs();
		for (const candidate of due) {
			const claimed = await claimJob(candidate.id);
			if (!claimed) continue;
			try {
				await processJob(claimed);
				processedTotal += 1;
				lastSuccessAt = new Date().toISOString();
			} catch (error) {
				failedTotal += 1;
				lastErrorMessage = error.message;
				logger.error(`[wordpress-queue] job ${claimed.id} failed: ${error.message}`);
				await failOrRetry(claimed, error);
			}
		}
	} catch (error) {
		lastErrorMessage = error.message;
		logger.error(`[wordpress-queue] tick failed: ${error.message}`);
	} finally {
		running = false;
	}
}

export function startWordpressPublishQueue() {
	if (workerTimer) return;
	logger.info('[wordpress-queue] starting worker');
	tick();
	workerTimer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopWordpressPublishQueue() {
	if (workerTimer) {
		clearInterval(workerTimer);
		workerTimer = null;
	}
}

export function getWordpressQueueStats() {
	return {
		running,
		processedTotal,
		failedTotal,
		lastRunAt,
		lastSuccessAt,
		lastErrorMessage,
		pollIntervalMs: POLL_INTERVAL_MS,
	};
}
