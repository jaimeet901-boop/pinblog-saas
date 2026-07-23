import { Router } from 'express';
import { pocketbaseAuth } from '../../middleware/pocketbase-auth.js';
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
} from '../../services/wordpress-publish.js';
import { listWordpressApiLogs } from '../../services/wordpress-api-log.js';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { getWordpressQueueStats } from '../../services/wordpress-publish-queue.js';

const router = Router();

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait briefly for queue worker so Writer UX still gets a sync-like response.
 */
async function waitForJobResult(ownerId, jobId, { timeoutMs = 25000, intervalMs = 1000 } = {}) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const job = await pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
		if (!job || job.owner !== ownerId) break;
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
			const error = new Error(job.last_error || 'WordPress publish failed');
			error.status = 502;
			error.errorCode = 'WP_PUBLISH_FAILED';
			error.job = mapPublishJob(job);
			throw error;
		}
		await sleep(intervalMs);
	}

	const job = await getPublishJob(ownerId, jobId);
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

router.get('/auth-providers', async (_req, res) => {
	res.json({ items: listWordpressAuthProviders() });
});

router.get('/sites', async (req, res) => {
	res.json(await listWordpressSites(req.pocketbaseUserId));
});

router.post('/sites/:id/default', async (req, res) => {
	res.json(await setDefaultWordpressSite(req.pocketbaseUserId, req.params.id));
});

router.get('/sites/:id/categories', async (req, res) => {
	res.json(await getSiteTaxonomy(req.pocketbaseUserId, req.params.id, 'categories'));
});

router.get('/sites/:id/tags', async (req, res) => {
	res.json(await getSiteTaxonomy(req.pocketbaseUserId, req.params.id, 'tags'));
});

router.get('/sites/:id/authors', async (req, res) => {
	res.json(await getSiteTaxonomy(req.pocketbaseUserId, req.params.id, 'authors'));
});

router.get('/sites/:id/posts', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'posts', req.query));
});

router.get('/sites/:id/posts/:postId', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'posts', { id: req.params.postId }));
});

router.get('/sites/:id/pages', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'pages', req.query));
});

router.get('/sites/:id/pages/:pageId', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'pages', { id: req.params.pageId }));
});

router.get('/sites/:id/media', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'media', req.query));
});

router.get('/sites/:id/media/:mediaId', async (req, res) => {
	res.json(await getSiteContent(req.pocketbaseUserId, req.params.id, 'media', { id: req.params.mediaId }));
});

router.get('/sites/:id/health', async (req, res) => {
	res.json(await getSiteTaxonomy(req.pocketbaseUserId, req.params.id, 'health'));
});

router.post('/test', async (req, res) => {
	const siteId = req.body?.siteId || req.body?.websiteId;
	const result = await testOwnedWordpressSite(req.pocketbaseUserId, siteId);
	res.json(result);
});

router.post('/publish', async (req, res) => {
	const job = await enqueueWordpressPublish(req.pocketbaseUserId, {
		...(req.body || {}),
		status: req.body?.status || 'publish',
	});
	try {
		const result = await waitForJobResult(req.pocketbaseUserId, job.id);
		res.status(result.queued ? 202 : 200).json(result);
	} catch (error) {
		res.status(error.status || 502).json({
			ok: false,
			message: error.message,
			errorCode: error.errorCode || 'WP_PUBLISH_FAILED',
			job: error.job || job,
		});
	}
});

router.post('/schedule', async (req, res) => {
	const scheduledAt = req.body?.scheduledAt || req.body?.scheduled_at;
	if (!scheduledAt) {
		return res.status(422).json({ message: 'scheduledAt is required', errorCode: 'VALIDATION_ERROR' });
	}
	const job = await enqueueWordpressPublish(req.pocketbaseUserId, {
		...(req.body || {}),
		status: 'future',
		scheduledAt,
	});
	res.status(202).json({ ok: true, queued: true, job });
});

router.get('/jobs', async (req, res) => {
	res.json(await listPublishJobs(req.pocketbaseUserId, req.query));
});

router.get('/jobs/:id', async (req, res) => {
	res.json(await getPublishJob(req.pocketbaseUserId, req.params.id));
});

router.post('/jobs/:id/retry', async (req, res) => {
	const job = await retryPublishJob(req.pocketbaseUserId, req.params.id);
	res.json({ ok: true, job });
});

router.post('/jobs/:id/cancel', async (req, res) => {
	const job = await cancelPublishJob(req.pocketbaseUserId, req.params.id);
	res.json({ ok: true, job });
});

router.get('/history', async (req, res) => {
	res.json(await listPublishHistory(req.pocketbaseUserId, req.query));
});

router.get('/logs', async (req, res) => {
	res.json(await listWordpressApiLogs(req.pocketbaseUserId, req.query));
});

router.get('/analytics', async (req, res) => {
	res.json(await getWordpressPublishAnalytics(req.pocketbaseUserId, req.query));
});

router.get('/queue/stats', async (req, res) => {
	res.json(getWordpressQueueStats());
});

export default router;
