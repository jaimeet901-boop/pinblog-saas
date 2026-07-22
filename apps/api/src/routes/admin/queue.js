import { Router } from 'express';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import {
	cancelQueueJob,
	computeQueueSummary,
	deleteQueueJob,
	enqueueJob,
	getQueueEngineStatus,
	getQueueJob,
	isQueuePaused,
	listQueueEvents,
	listRecentActivity,
	listWorkers,
	mapQueueJobDetail,
	mapQueueJobDto,
	normalizeJobType,
	pauseQueueJob,
	requeueDeadLetter,
	resumeQueueJob,
	retryQueueJob,
	setQueuePaused,
} from '../../services/queue/index.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function normalizePositiveInt(value, fallback, max = 100) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(max, n);
}

router.get('/summary', asyncHandler(async (req, res) => {
	const [summary, workers, activity, engine] = await Promise.all([
		computeQueueSummary(),
		listWorkers(),
		listRecentActivity(12),
		Promise.resolve(getQueueEngineStatus()),
	]);
	res.json({
		...summary,
		workers,
		activity,
		engine,
	});
}));

router.get('/metrics', asyncHandler(async (req, res) => {
	const summary = await computeQueueSummary();
	res.json({
		...summary.metrics,
		health: summary.health,
		paused: summary.paused,
		workersOnline: summary.workersOnline,
		avgProcessingTime: summary.avgProcessingTime,
	});
}));

router.get('/workers', asyncHandler(async (req, res) => {
	const workers = await listWorkers();
	res.json({ items: workers, totalItems: workers.length });
}));

router.get('/jobs', asyncHandler(async (req, res) => {
	const page = normalizePositiveInt(req.query.page, 1);
	const perPage = normalizePositiveInt(req.query.perPage, 20, 100);
	const q = String(req.query.q || req.query.search || '').trim().toLowerCase();
	const status = String(req.query.status || '').trim();
	const priority = String(req.query.priority || '').trim();
	const provider = String(req.query.provider || '').trim();
	const workspace = String(req.query.workspace || '').trim();
	const dateRange = String(req.query.date || req.query.dateRange || '').trim();
	const typeRaw = String(req.query.type || req.query.jobType || '').trim();
	const type = normalizeJobType(typeRaw);

	const parts = [];
	if (status) parts.push(pocketbaseClient.filter('status = {:status}', { status }));
	if (priority) parts.push(pocketbaseClient.filter('priority = {:priority}', { priority }));
	if (provider) parts.push(pocketbaseClient.filter('provider ~ {:provider}', { provider }));
	if (type) parts.push(pocketbaseClient.filter('type = {:type}', { type }));
	if (workspace) {
		parts.push(pocketbaseClient.filter('(workspace_label ~ {:ws} || workspace_key ~ {:ws})', { ws: workspace }));
	}
	if (dateRange === 'today') {
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		parts.push(pocketbaseClient.filter('created >= {:start}', { start: start.toISOString() }));
	}

	const filter = parts.length ? parts.join(' && ') : '';
	const result = await pocketbaseClient.collection('queue_jobs').getList(page, perPage, {
		filter: filter || undefined,
		sort: '-created',
		expand: 'owner,workspace',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));

	let items = (result.items || []).map((job) => mapQueueJobDto(job));
	if (q) {
		items = items.filter((job) => {
			const haystack = [job.id, job.type, job.workspace, job.owner, job.provider, job.worker].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}

	res.json({
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: q ? items.length : result.totalItems,
		totalPages: q ? Math.max(1, Math.ceil(items.length / perPage)) : result.totalPages,
		items: q ? items.slice(0, perPage) : items,
	});
}));

router.get('/jobs/:id', asyncHandler(async (req, res) => {
	const job = await getQueueJob(req.params.id);
	if (!job) throw httpError(404, 'Job not found', 'NOT_FOUND');
	res.json(await mapQueueJobDetail(job));
}));

router.get('/jobs/:id/events', asyncHandler(async (req, res) => {
	const job = await getQueueJob(req.params.id);
	if (!job) throw httpError(404, 'Job not found', 'NOT_FOUND');
	const events = await listQueueEvents(job.id, 100);
	res.json({
		items: events.map((event) => ({
			id: event.id,
			level: event.level,
			message: event.message,
			at: event.at || event.created,
			payload: event.payload || null,
		})),
	});
}));

router.post('/jobs', asyncHandler(async (req, res) => {
	const body = req.body || {};
	const owner = body.owner || req.adminUser?.id;
	if (!owner) throw httpError(422, 'owner is required', 'VALIDATION_ERROR');
	const job = await enqueueJob({
		owner,
		workspaceKey: body.workspaceKey || body.workspace || '',
		type: body.type,
		priority: body.priority || 'normal',
		payload: body.payload || body.inputs || {},
		inputs: body.inputs || body.payload || {},
		provider: body.provider || '',
		model: body.model || '',
		credits: body.credits || 0,
		maxAttempts: body.maxAttempts || 3,
		correlationId: body.correlationId || '',
	});
	res.status(201).json(await mapQueueJobDetail(job));
}));

router.post('/jobs/:id/retry', asyncHandler(async (req, res) => {
	const updated = await retryQueueJob(req.params.id);
	res.json(await mapQueueJobDetail(updated));
}));

router.post('/jobs/:id/cancel', asyncHandler(async (req, res) => {
	const updated = await cancelQueueJob(req.params.id, { actorId: req.adminUser?.id });
	res.json(await mapQueueJobDetail(updated));
}));

router.post('/jobs/:id/pause', asyncHandler(async (req, res) => {
	const updated = await pauseQueueJob(req.params.id);
	res.json(await mapQueueJobDetail(updated));
}));

router.post('/jobs/:id/resume', asyncHandler(async (req, res) => {
	const updated = await resumeQueueJob(req.params.id);
	res.json(await mapQueueJobDetail(updated));
}));

router.post('/jobs/:id/requeue', asyncHandler(async (req, res) => {
	const updated = await requeueDeadLetter(req.params.id);
	res.json(await mapQueueJobDetail(updated));
}));

router.delete('/jobs/:id', asyncHandler(async (req, res) => {
	const result = await deleteQueueJob(req.params.id);
	res.json(result);
}));

router.post('/pause', asyncHandler(async (req, res) => {
	await setQueuePaused(true);
	res.json({ paused: true, message: 'Queue paused' });
}));

router.post('/resume', asyncHandler(async (req, res) => {
	await setQueuePaused(false);
	res.json({ paused: false, message: 'Queue resumed' });
}));

router.get('/status', asyncHandler(async (req, res) => {
	res.json({
		paused: await isQueuePaused(),
		engine: getQueueEngineStatus(),
	});
}));

router.get('/stream', asyncHandler(async (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders?.();

	let closed = false;
	req.on('close', () => {
		closed = true;
	});

	const push = async () => {
		if (closed) return;
		try {
			const [summary, activity] = await Promise.all([
				computeQueueSummary(),
				listRecentActivity(8),
			]);
			res.write(`event: summary\ndata: ${JSON.stringify({ summary, activity, at: new Date().toISOString() })}\n\n`);
		} catch (error) {
			res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
		}
	};

	await push();
	const interval = setInterval(push, 5000);
	req.on('close', () => clearInterval(interval));
}));

export default router;
