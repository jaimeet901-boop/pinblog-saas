import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import {
	createOrUpdateWordpressPost,
	findWordpressContentByExactSlug,
	uploadWordpressMedia,
} from './wordpress-client.js';
import { getSiteCredentialsPlain } from './wordpress-sites.js';
import { writePublishHistory } from './wordpress-publish.js';
import { writeQueueAudit } from './audit/write.js';
import {
	continueChefIaPublishWorkflow,
	notifyWordpressPublishFailure,
} from './publish-pipeline.js';
import { logWorkflowStep } from './workspace-notify.js';
import { enqueueAnalyticsRefresh } from './analytics/refresh.js';
import {
	clearPublishJobFailurePayload,
	extractWordpressErrorCode,
	withPublishJobFailurePayload,
} from './wordpress-errors.js';
import { withWordpressPublishCredits } from './wordpress-publish-credits.js';
import { claimJob } from './wordpress-publish-claim.js';
import { applyWordpressPublishFailureArticleSync } from './wordpress-article-status-sync.js';
import {
	buildWpWriterMediaFilename,
	isWpWriterDataImageUrl,
	readWriterMediaMap,
	removeSeodevaFiguresBySrc,
	resolveWriterImagesForJob,
	rewriteSeodevaArticleImageSrc,
	selectWriterAssetsForUpload,
	writeWriterMediaMap,
} from './wordpress-writer-media.js';

export { claimJob, WORDPRESS_PUBLISH_JOB_CLAIM_PATH } from './wordpress-publish-claim.js';

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
let envDisabledLogged = false;

/**
 * WordPress legacy poller gate (Phase 9c). Unset defaults to enabled.
 */
export function isWordpressQueueEnabled() {
	const raw = String(process.env.WORDPRESS_QUEUE_ENABLED ?? '').trim().toLowerCase();
	if (!raw) {
		return true;
	}
	if (raw === '1' || raw === 'true') {
		return true;
	}
	if (raw === '0' || raw === 'false') {
		return false;
	}
	return true;
}

async function writeWordpressPublishQueueAudit(job, eventMessage = '') {
	if (!job?.id) return null;
	if (job.status !== 'published' && job.status !== 'failed') return null;
	return writeQueueAudit({
		job: {
			id: job.id,
			owner: job.owner,
			workspace_key: job.workspace_key || '',
			type: 'wordpress_publishing',
			provider: 'WordPress',
			status: job.status,
			source_collection: 'publish_jobs',
			source_id: job.id,
			correlation_id: job.workflow_id ? `workflow_${job.workflow_id}` : `wordpress_${job.id}`,
			priority: 'normal',
			progress: job.status === 'published' ? 100 : 0,
			credits: 0,
			duration_ms: 0,
		},
		action: job.status === 'published' ? 'WordPress publish completed' : 'WordPress publish failed',
		severity: job.status === 'published' ? 'success' : 'error',
		result: job.status === 'published' ? 'ok' : 'failed',
		message: eventMessage || job.last_error || '',
	}).catch(() => null);
}

function nextRetryDate(attemptCount = 1) {
	const capped = Math.max(1, Math.min(10, attemptCount));
	const delays = [0, 30_000, 120_000, 300_000];
	const delay = delays[Math.min(capped, delays.length - 1)] || capped * 60_000;
	return new Date(Date.now() + delay).toISOString();
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

async function persistWordpressPostIdentity(jobId, wpPostId, wpPostUrl, progress = 70) {
	try {
		return await pocketbaseClient.collection('publish_jobs').update(jobId, {
			wp_post_id: wpPostId,
			wp_post_url: wpPostUrl,
			progress,
		});
	} catch (persistError) {
		const err = new Error(persistError.message || 'Failed to persist WordPress post id');
		err.wpPostId = wpPostId;
		err.wpPostUrl = wpPostUrl;
		throw err;
	}
}

function resolveWordpressUpdatePostId(job) {
	return job.payload?.updatePostId || job.wp_post_id || null;
}

/**
 * Re-read publish_jobs and confirm this worker still owns an active claim.
 * Returns true to proceed; false to abort without mutating status.
 */
async function assertWordpressPublishClaimStillActive(job) {
	const jobId = job?.id;
	if (!jobId) {
		logger.warn('[wordpress-queue] claim re-check aborted: missing job id');
		return false;
	}

	const fresh = await pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
	if (!fresh) {
		logger.info(`[wordpress-queue] job ${jobId} claim re-check aborted: job missing`);
		return false;
	}
	if (fresh.status === 'cancelled') {
		logger.info(`[wordpress-queue] job ${jobId} claim re-check aborted: cancelled`);
		return false;
	}
	if (fresh.status !== 'publishing') {
		logger.info(`[wordpress-queue] job ${jobId} claim re-check aborted: status=${fresh.status}`);
		return false;
	}
	if (String(fresh.claim_token || '') !== String(job.claim_token || '')) {
		logger.info(`[wordpress-queue] job ${jobId} claim re-check aborted: claim_token mismatch`);
		return false;
	}
	if (Number(fresh.claim_version || 0) !== Number(job.claim_version || 0)) {
		logger.info(`[wordpress-queue] job ${jobId} claim re-check aborted: claim_version mismatch`);
		return false;
	}
	return true;
}

async function processJob(job) {
	const started = Date.now();
	const ownerId = job.owner;

	await logWorkflowStep({
		ownerId,
		action: 'workflow.start',
		resourceType: 'publish_jobs',
		resourceId: job.id,
		metadata: {
			workflowId: job.workflow_id || job.payload?.workflowId || `wf-${job.id}`,
			siteId: job.site,
			title: job.title,
			wpStatus: job.wp_status,
		},
	});

	if (Number(job.wp_post_id) > 0 && job.status === 'published') {
		return;
	}

	if (Number(job.wp_post_id) > 0 && job.status === 'publishing') {
		// WordPress post already created in a prior attempt; finalize local state only.
		await pocketbaseClient.collection('publish_jobs').update(job.id, {
			status: 'published',
			progress: 100,
			completed_at: job.completed_at || new Date().toISOString(),
			last_error: '',
		});
		return;
	}

	const { site, username, appPassword, authType } = await getSiteCredentialsPlain(job.site, ownerId);
	const logContext = {
		ownerId,
		workspaceKey: job.workspace_key || ownerId,
		siteId: site.id,
		jobId: job.id,
	};

	await pocketbaseClient.collection('publish_jobs').update(job.id, { progress: 25 }).catch(() => null);

	let mediaId = Number(job.wp_media_id) || 0;
	const mediaIds = Array.isArray(job.media_ids) ? [...job.media_ids] : [];
	const { bySlotId, bySourceUrl } = readWriterMediaMap(job);
	let contentHtml = String(job.content || '');

	const writerImages = await resolveWriterImagesForJob(job, {
		getArticle: (id) => pocketbaseClient.collection('articles').getOne(id),
	});

	const persistMediaState = async (progress = 55) => {
		const nextPayload = {
			...(job.payload && typeof job.payload === 'object' ? job.payload : {}),
			writerMediaMap: writeWriterMediaMap(bySlotId, bySourceUrl),
		};
		job = { ...job, payload: nextPayload, content: contentHtml, media_ids: mediaIds, wp_media_id: mediaId };
		await pocketbaseClient.collection('publish_jobs').update(job.id, {
			wp_media_id: mediaId,
			media_ids: mediaIds,
			content: contentHtml,
			payload: nextPayload,
			progress,
		}).catch(() => null);
	};

	const rememberUpload = (asset, uploaded) => {
		const id = Number(uploaded?.id) || 0;
		const wpUrl = String(uploaded?.url || '').trim();
		const sourceUrl = String(asset?.url || '').trim();
		if (!id || !wpUrl || !sourceUrl) return null;
		const entry = { wpMediaId: id, wpUrl, sourceUrl };
		const slotId = String(asset?.slotId || '').trim();
		if (slotId) bySlotId[slotId] = entry;
		bySourceUrl[sourceUrl] = entry;
		if (!mediaIds.includes(id)) mediaIds.push(id);
		return entry;
	};

	const lookupCached = (asset) => {
		const slotId = String(asset?.slotId || '').trim();
		const sourceUrl = String(asset?.url || '').trim();
		if (slotId && bySlotId[slotId]?.wpUrl) return bySlotId[slotId];
		if (sourceUrl && bySourceUrl[sourceUrl]?.wpUrl) return bySourceUrl[sourceUrl];
		return null;
	};

	const uploadWriterAsset = async (asset, filenameHint) => {
		const cached = lookupCached(asset);
		if (cached) return cached;
		const uploaded = await uploadWordpressMedia({
			url: site.url,
			username,
			appPassword,
			authType,
			imageUrl: asset.url,
			filename: filenameHint || buildWpWriterMediaFilename({
				slotId: asset.slotId,
				type: asset.type,
				slug: job.slug,
			}),
			altText: asset.alt || '',
			requireHttps: !isWpWriterDataImageUrl(asset.url),
			logContext,
		});
		return rememberUpload(asset, uploaded);
	};

	// 1) Manual featured URL wins (existing behavior)
	if (job.featured_image_url && !mediaId) {
		try {
			await logWorkflowStep({
				ownerId,
				action: 'workflow.image_upload',
				resourceType: 'publish_jobs',
				resourceId: job.id,
				metadata: { imageUrl: job.featured_image_url },
			});
			const uploaded = await uploadWordpressMedia({
				url: site.url,
				username,
				appPassword,
				authType,
				imageUrl: job.featured_image_url,
				filename: `${job.slug || 'featured'}.jpg`,
				logContext,
			});
			mediaId = Number(uploaded?.id) || 0;
			if (mediaId) mediaIds.push(mediaId);
			await persistMediaState(55);
			await logWorkflowStep({
				ownerId,
				action: 'workflow.image_upload',
				resourceType: 'publish_jobs',
				resourceId: job.id,
				metadata: { mediaId, result: 'ok' },
			});
		} catch (error) {
			await logWorkflowStep({
				ownerId,
				action: 'workflow.image_upload',
				result: 'error',
				resourceType: 'publish_jobs',
				resourceId: job.id,
				metadata: { error: error.message },
			});
			if (error.retryable === undefined) error.retryable = true;
			throw error;
		}
	} else if (!mediaId && !job.featured_image_url) {
		// 2) Generated featured Writer asset when no manual featured URL
		const featuredAssets = selectWriterAssetsForUpload(writerImages, 'featured');
		const featured = featuredAssets[0];
		if (featured) {
			try {
				await logWorkflowStep({
					ownerId,
					action: 'workflow.image_upload',
					resourceType: 'publish_jobs',
					resourceId: job.id,
					metadata: { imageUrl: featured.url, writerFeatured: true },
				});
				const entry = await uploadWriterAsset(
					featured,
					buildWpWriterMediaFilename({
						slotId: featured.slotId || 'slot-featured',
						type: 'featured',
						slug: job.slug,
					}),
				);
				mediaId = Number(entry?.wpMediaId) || 0;
				await persistMediaState(55);
				await logWorkflowStep({
					ownerId,
					action: 'workflow.image_upload',
					resourceType: 'publish_jobs',
					resourceId: job.id,
					metadata: { mediaId, result: 'ok', writerFeatured: true },
				});
			} catch (error) {
				await logWorkflowStep({
					ownerId,
					action: 'workflow.image_upload',
					result: 'error',
					resourceType: 'publish_jobs',
					resourceId: job.id,
					metadata: { error: error.message, writerFeatured: true },
				});
				if (error.retryable === undefined) error.retryable = true;
				throw error;
			}
		} else {
			await pocketbaseClient.collection('publish_jobs').update(job.id, { progress: 55 }).catch(() => null);
		}
	} else {
		await pocketbaseClient.collection('publish_jobs').update(job.id, { progress: 55 }).catch(() => null);
	}

	// 3) Inline Writer images — soft failure policy
	const inlineAssets = selectWriterAssetsForUpload(writerImages, 'inline');
	if (inlineAssets.length) {
		const urlRewriteMap = new Map();
		const removeSrcs = new Set();

		for (const asset of inlineAssets) {
			const sourceUrl = String(asset.url || '').trim();
			try {
				const entry = await uploadWriterAsset(asset);
				if (entry?.wpUrl) {
					urlRewriteMap.set(sourceUrl, entry.wpUrl);
					await persistMediaState(58);
				}
			} catch (error) {
				logger.warn('[wordpress-publish] inline writer image upload failed', {
					jobId: job.id,
					slotId: asset.slotId || null,
					errorCode: error?.errorCode || null,
					message: String(error?.message || '').slice(0, 200),
				});
				if (isWpWriterDataImageUrl(sourceUrl)) {
					removeSrcs.add(sourceUrl);
				}
				// HTTPS: keep original URL in HTML
			}
		}

		if (urlRewriteMap.size) {
			contentHtml = rewriteSeodevaArticleImageSrc(contentHtml, urlRewriteMap);
		}
		if (removeSrcs.size) {
			contentHtml = removeSeodevaFiguresBySrc(contentHtml, removeSrcs);
		}
		await persistMediaState(60);
	}

	const claimStillActive = await assertWordpressPublishClaimStillActive(job);
	if (!claimStillActive) {
		return;
	}

	let updatePostId = resolveWordpressUpdatePostId(job);
	const contentType = job.payload?.contentType === 'page' ? 'page' : 'post';
	if (!updatePostId && String(job.slug || '').trim()) {
		const recovered = await findWordpressContentByExactSlug({
			url: site.url,
			username,
			appPassword,
			authType,
			slug: job.slug,
			contentType,
			logContext,
		}).catch(() => null);
		const recoveredId = Number(recovered?.id) || 0;
		if (recoveredId > 0) {
			updatePostId = recoveredId;
		}
	}
	const result = await withWordpressPublishCredits(job, async () => createOrUpdateWordpressPost({
		url: site.url,
		username,
		appPassword,
		authType,
		postId: updatePostId || undefined,
		title: job.title,
		content: contentHtml,
		excerpt: job.excerpt,
		slug: job.slug,
		status: job.wp_status,
		scheduledAt: job.scheduled_at,
		categories: job.categories || [],
		tags: job.tags || [],
		featuredMediaId: mediaId || undefined,
		authorId: job.payload?.authorId || undefined,
		metaDescription: job.meta_description,
		seo: job.seo || {},
		recipeCard: job.recipe_card || null,
		contentType,
		logContext,
	}), {
		getWorkspace: async (workspaceId) => (
			pocketbaseClient.collection('workspaces').getOne(workspaceId).catch(() => null)
		),
	});

	await persistWordpressPostIdentity(job.id, result.id, result.link, 70);
	job = { ...job, wp_post_id: result.id, wp_post_url: result.link };

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
		payload: clearPublishJobFailurePayload(job.payload),
	});

	await writeWordpressPublishQueueAudit({
		...job,
		status: 'published',
		progress: 100,
		wp_post_id: result.id,
		wp_post_url: result.link,
		completed_at: completedAt,
		last_error: '',
		dead_letter: false,
	}, 'WordPress publish completed');

	await writePublishHistory({
		ownerId,
		workspaceKey: job.workspace_key || '',
		workspaceId: typeof job.workspace === 'string' ? job.workspace : (job.workspace?.id || ''),
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

	await continueChefIaPublishWorkflow({
		job: {
			...job,
			wp_post_id: result.id,
			wp_post_url: result.link,
			wp_media_id: mediaId || 0,
			status: 'published',
		},
		result,
		historyResult,
		mediaId,
		site,
	}).catch((error) => {
		logger.warn(`[wordpress-queue] workflow continuation failed for ${job.id}: ${error.message}`);
	});
}

async function failOrRetry(job, error) {
	if (error?.wpPostId) {
		await pocketbaseClient.collection('publish_jobs').update(job.id, {
			wp_post_id: error.wpPostId,
			wp_post_url: error.wpPostUrl || job.wp_post_url || '',
		}).catch(() => null);
		job = {
			...job,
			wp_post_id: error.wpPostId,
			wp_post_url: error.wpPostUrl || job.wp_post_url || '',
		};
	}

	const attempt = Number(job.attempt_count || 0) + 1;
	const maxAttempts = Number(job.max_attempts) || 3;
	const errorCode = extractWordpressErrorCode(error);
	const authFailed = Boolean(error?.authFailed === true || errorCode === 'WP_AUTH_FAILED');
	const retryable = !authFailed && (error?.retryable !== false) && attempt < maxAttempts;
	const failurePayload = withPublishJobFailurePayload(job.payload, error);

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
			payload: failurePayload,
		});
		await notifyWordpressPublishFailure({ job, error, retrying: true }).catch(() => null);
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
		payload: failurePayload,
	});
	if (job.article_id) {
		await applyWordpressPublishFailureArticleSync(job, { retryable: false }).catch(() => null);
	}
	await writeWordpressPublishQueueAudit({
		...job,
		status: 'failed',
		attempt_count: attempt,
		last_error: error.message,
		completed_at: completedAt,
		progress: 100,
		dead_letter: true,
	}, 'WordPress publish failed');

	await writePublishHistory({
		ownerId: job.owner,
		workspaceKey: job.workspace_key || '',
		workspaceId: typeof job.workspace === 'string' ? job.workspace : (job.workspace?.id || ''),
		siteId: job.site,
		jobId: job.id,
		title: job.title,
		wpStatus: job.wp_status,
		result: 'failed',
		error: error.message,
		publishedAt: completedAt,
		durationMs: 0,
	});

	await notifyWordpressPublishFailure({ job, error, retrying: false }).catch(() => null);
	await enqueueAnalyticsRefresh(job.owner, {
		workspaceKey: job.workspace_key || '',
	}).catch(() => null);
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

	if (!isWordpressQueueEnabled()) {
		if (!envDisabledLogged) {
			logger.info('WordPress publish queue disabled by WORDPRESS_QUEUE_ENABLED');
			envDisabledLogged = true;
		}
		return;
	}

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
	const enabled = isWordpressQueueEnabled();
	return {
		running,
		enabled,
		disabledByEnv: !enabled,
		processedTotal,
		failedTotal,
		lastRunAt,
		lastSuccessAt,
		lastErrorMessage,
		pollIntervalMs: POLL_INTERVAL_MS,
	};
}
