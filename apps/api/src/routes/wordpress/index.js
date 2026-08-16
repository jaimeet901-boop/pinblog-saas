import { Router } from 'express';
import { pocketbaseAuth } from '../../middleware/pocketbase-auth.js';
import { requireAdmin, httpError } from '../../middleware/require-admin.js';
import { attachWorkspace, requireWorkspaceRead, requireWorkspaceMutation } from '../../middleware/product-access.js';
import {
	listWordpressSites,
	setDefaultWordpressSite,
	testOwnedWordpressSite,
	getSiteTaxonomy,
	getSiteContent,
	listWordpressAuthProviders,
} from '../../services/wordpress-sites.js';
import {
	enqueueWordpressPublish,
	listPublishJobs,
	getPublishJob,
	retryPublishJob,
	cancelPublishJob,
	listPublishHistory,
	getWordpressPublishAnalytics,
	mapPublishJob,
	wordpressPublishWaitJobIsVisible,
} from '../../services/wordpress-publish.js';
import {
	WORDPRESS_PUBLISH_IDEMPOTENCY_WORKSPACE_REQUIRED_MESSAGE,
} from '../../services/wordpress-publish-enqueue-idempotency.js';
import { listWordpressApiLogs } from '../../services/wordpress-api-log.js';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { getWordpressQueueStats } from '../../services/wordpress-publish-queue.js';
import { discoverOwnedWordpressSite } from '../../services/wordpress-discovery.js';
import { syncOwnedWordpressSite, processDueWordpressSyncs } from '../../services/wordpress-sync.js';
import { ensureWordpressIntegrationSchema } from '../../utils/ensure-wordpress-integration-schema.js';
import { getWorkspaceActor } from '../../services/workspace-ownership.js';
import {
	createPublishJobFailureError,
	createWordpressError,
	respondWordpressApiError,
	WORDPRESS_ERROR_CODES,
} from '../../services/wordpress-errors.js';

const router = Router();

function wordpressJobOwner(req) {
	return getWorkspaceActor(req).workspaceOwnerId || req.pocketbaseUserId;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait briefly for queue worker so Writer UX still gets a sync-like response.
 * Never returns a job from another workspace.
 */
async function waitForJobResult(req, jobId, { timeoutMs = 25000, intervalMs = 1000 } = {}) {
	const ownerId = wordpressJobOwner(req);
	const workspaceId = String(req.workspace?.id || '').trim();
	if (!workspaceId) {
		throw httpError(
			422,
			WORDPRESS_PUBLISH_IDEMPOTENCY_WORKSPACE_REQUIRED_MESSAGE,
			'WORDPRESS_PUBLISH_IDEMPOTENCY_WORKSPACE_REQUIRED',
		);
	}

	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const job = await pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
		if (!wordpressPublishWaitJobIsVisible(job, { ownerId, workspaceId })) break;
		if (job.status === 'published') {
			return {
				ok: true,
				id: job.wp_post_id,
				postId: job.wp_post_id,
				link: job.wp_post_url,
				url: job.wp_post_url,
				status: job.wp_status,
				job: mapPublishJob(job),
			};
		}
		if (job.status === 'failed' || job.status === 'cancelled') {
			const error = createPublishJobFailureError(job);
			error.job = mapPublishJob(job);
			throw error;
		}
		await sleep(intervalMs);
	}

	const job = await getPublishJob(ownerId, jobId, req);
	return {
		ok: true,
		queued: true,
		message: 'Publish job queued',
		job,
		id: job.wpPostId || null,
		postId: job.wpPostId || null,
		link: job.wpPostUrl || '',
		url: job.wpPostUrl || '',
		status: job.status,
	};
}

router.use(pocketbaseAuth);
router.use(attachWorkspace);
router.use(requireWorkspaceRead);
router.use(requireWorkspaceMutation('workspace.wordpress.publish'));

router.get('/auth-providers', async (_req, res) => {
	res.json({ items: listWordpressAuthProviders() });
});

router.get('/sites', async (req, res) => {
	res.json(await listWordpressSites(req.pocketbaseUserId, req));
});

router.post('/sites/:id/default', async (req, res) => {
	res.json(await setDefaultWordpressSite(req.pocketbaseUserId, req.params.id, req));
});

router.get('/sites/:id/categories', async (req, res) => {
	res.json(await getSiteTaxonomy(req.pocketbaseUserId, req.params.id, 'categories', req));
});

router.get('/sites/:id/tags', async (req, res) => {
	res.json(await getSiteTaxonomy(req.pocketbaseUserId, req.params.id, 'tags', req));
});

router.get('/sites/:id/authors', async (req, res) => {
	res.json(await getSiteTaxonomy(req.pocketbaseUserId, req.params.id, 'authors', req));
});

router.get('/sites/:id/posts', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'posts', req.query, req));
});

router.get('/sites/:id/posts/:postId', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'posts', { id: req.params.postId }, req));
});

router.get('/sites/:id/pages', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'pages', req.query, req));
});

router.get('/sites/:id/pages/:pageId', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'pages', { id: req.params.pageId }, req));
});

router.get('/sites/:id/media', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'media', req.query, req));
});

router.get('/sites/:id/media/:mediaId', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'media', { id: req.params.mediaId }, req));
});

router.get('/sites/:id/health', async (req, res) => {
	res.json(await getSiteTaxonomy(req.pocketbaseUserId, req.params.id, 'health', req));
});

router.post('/test', async (req, res) => {
	const siteId = req.body?.siteId || req.body?.websiteId;
	const result = await testOwnedWordpressSite(req.pocketbaseUserId, siteId, req);
	res.json(result);
});

/**
 * Explicit connection probe — same core as /test, returns richer profile fields.
 * Existing /test remains for Website Manager "Test" button compatibility.
 */
router.post('/sites/:id/connect', async (req, res) => {
	const result = await testOwnedWordpressSite(req.pocketbaseUserId, req.params.id, req);
	res.json(result);
});

router.post('/sites/:id/discover', async (req, res) => {
	const result = await discoverOwnedWordpressSite(req.pocketbaseUserId, req.params.id, {
		refreshConnection: req.body?.refreshConnection !== false,
		req,
	});
	res.json(result);
});

router.get('/sites/:id/profile', async (req, res) => {
	await ensureWordpressIntegrationSchema(pocketbaseClient);
	const sites = await listWordpressSites(req.pocketbaseUserId, req);
	const site = (sites.items || []).find((item) => (
		item.id === req.params.id || item.websiteId === req.params.id
	));
	if (!site) {
		return res.status(404).json({ message: 'WordPress site not found', errorCode: 'NOT_FOUND' });
	}
	res.json({
		site,
		profile: site.siteProfile || null,
		discovery: site.discovery || null,
		health: site.health || null,
		sync: {
			status: site.syncStatus || 'idle',
			lastSyncedAt: site.lastSyncedAt || '',
			nextSyncAt: site.nextSyncAt || '',
			cursor: site.syncCursor || null,
			lastError: site.lastSyncError || '',
		},
	});
});

router.post('/sites/:id/sync', async (req, res) => {
	const mode = req.body?.mode || 'manual';
	const result = await syncOwnedWordpressSite(req.pocketbaseUserId, req.params.id, { mode, req });
	res.json(result);
});

router.get('/sites/:id/sync/status', async (req, res) => {
	await ensureWordpressIntegrationSchema(pocketbaseClient);
	const sites = await listWordpressSites(req.pocketbaseUserId, req);
	const site = (sites.items || []).find((item) => (
		item.id === req.params.id || item.websiteId === req.params.id
	));
	if (!site) {
		return res.status(404).json({ message: 'WordPress site not found', errorCode: 'NOT_FOUND' });
	}

	const runs = await pocketbaseClient.collection('wordpress_sync_runs').getList(1, 10, {
		filter: (await import('../../services/workspace-ownership.js')).andWorkspaceScope(
			req,
			pocketbaseClient.filter('site = {:site}', { site: site.id }),
		),
		sort: '-started_at',
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0 }));

	res.json({
		status: site.syncStatus || 'idle',
		lastSyncedAt: site.lastSyncedAt || '',
		nextSyncAt: site.nextSyncAt || '',
		cursor: site.syncCursor || null,
		lastError: site.lastSyncError || '',
		runs: runs.items || [],
		totalRuns: runs.totalItems || 0,
	});
});

router.post('/sync/process-due', requireAdmin, async (req, res) => {
	const result = await processDueWordpressSyncs({
		limit: Math.min(20, Math.max(1, Number(req.body?.limit) || 5)),
	});
	res.json(result);
});

router.post('/publish', async (req, res) => {
	const job = await enqueueWordpressPublish({
		ownerId: req.workspaceOwnerId || req.pocketbaseUserId,
		workspaceId: req.workspace?.id || '',
		workspaceKey: req.workspaceKey || '',
		req,
	}, {
		...(req.body || {}),
		status: req.body?.status || 'publish',
	});
	try {
		const result = await waitForJobResult(req, job.id);
		res.status(result.queued ? 202 : 200).json(result);
	} catch (error) {
		respondWordpressApiError(res, error, {
			job: error.job || job,
		});
	}
});

router.post('/schedule', async (req, res) => {
	const scheduledAt = req.body?.scheduledAt || req.body?.scheduled_at;
	if (!scheduledAt) {
		return respondWordpressApiError(res, createWordpressError(
			WORDPRESS_ERROR_CODES.VALIDATION_ERROR,
			'scheduledAt is required',
		));
	}
	const job = await enqueueWordpressPublish({
		ownerId: req.workspaceOwnerId || req.pocketbaseUserId,
		workspaceId: req.workspace?.id || '',
		workspaceKey: req.workspaceKey || '',
		req,
	}, {
		...(req.body || {}),
		status: 'future',
		scheduledAt,
	});
	res.status(202).json({ ok: true, queued: true, job });
});

router.get('/jobs', async (req, res) => {
	res.json(await listPublishJobs(wordpressJobOwner(req), req.query, req));
});

router.get('/jobs/:id', async (req, res) => {
	res.json(await getPublishJob(wordpressJobOwner(req), req.params.id, req));
});

router.post('/jobs/:id/retry', async (req, res) => {
	const job = await retryPublishJob(wordpressJobOwner(req), req.params.id, req);
	res.json({ ok: true, job });
});

router.post('/jobs/:id/cancel', async (req, res) => {
	const job = await cancelPublishJob(wordpressJobOwner(req), req.params.id, req);
	res.json({ ok: true, job });
});

router.get('/history', async (req, res) => {
	res.json(await listPublishHistory(wordpressJobOwner(req), req.query, req));
});

router.get('/logs', async (req, res) => {
	res.json(await listWordpressApiLogs(wordpressJobOwner(req), req.query, req));
});

router.get('/analytics', async (req, res) => {
	res.json(await getWordpressPublishAnalytics(wordpressJobOwner(req), req.query, req));
});

router.get('/queue/stats', async (req, res) => {
	res.json(getWordpressQueueStats());
});

router.use((err, req, res, next) => {
	if (res.headersSent) return next(err);
	respondWordpressApiError(res, err);
});

export default router;
