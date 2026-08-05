import { Router } from 'express';
import { httpError } from '../../middleware/require-admin.js';
import {
	computeQueueSummary,
	enqueueJob,
	getQueueEngineStatus,
	isQueuePaused,
	listRecentActivity,
	listWorkers,
	setQueuePaused,
} from '../../services/queue/index.js';
import {
	getAdminQueueJobDetail,
	listAdminQueueJobs,
} from '../../services/queue/admin-read/index.js';
import {
	isAdminQueueChannelControlsEnabled,
	listAdminQueueJobEvents,
	mapAdminQueueJobControlResponse,
} from '../../services/queue/admin-controls/index.js';
import { resolveTrustedEnqueueOwnership } from '../../services/queue/job-ownership.js';
import { getQueueJob, listQueueEvents, mapQueueJobDetail } from '../../services/queue/jobs.js';
import {
	cancelQueueJob,
	deleteQueueJob,
	pauseQueueJob,
	requeueDeadLetter,
	resumeQueueJob,
	retryQueueJob,
} from '../../services/queue/controls.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
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
	const result = await listAdminQueueJobs(req.query);
	res.json(result);
}));

router.get('/jobs/:id', asyncHandler(async (req, res) => {
	const detail = await getAdminQueueJobDetail(req.params.id);
	if (!detail) throw httpError(404, 'Job not found', 'NOT_FOUND');
	res.json(detail);
}));

router.get('/jobs/:id/events', asyncHandler(async (req, res) => {
	if (isAdminQueueChannelControlsEnabled()) {
		const events = await listAdminQueueJobEvents(req.params.id, 100);
		res.json({ items: events });
		return;
	}
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
	// Ownership is derived from trusted workspace records / authenticated admin — never body.owner.
	const ownership = await resolveTrustedEnqueueOwnership({
		adminUserId: req.adminUser?.id || '',
		workspaceId: body.workspaceId || '',
		workspaceKey: body.workspaceKey || body.workspace || '',
	});
	const forgedOwner = body.owner != null && String(body.owner).trim() !== ''
		&& String(body.owner).trim() !== String(ownership.owner);
	if (forgedOwner) {
		throw httpError(422, 'Forged owner is not allowed', 'FORGED_OWNERSHIP');
	}
	const job = await enqueueJob({
		owner: ownership.owner,
		workspaceKey: ownership.workspaceKey,
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
	if (!isAdminQueueChannelControlsEnabled()) {
		const updated = await retryQueueJob(req.params.id);
		res.json(await mapQueueJobDetail(updated));
		return;
	}
	res.json(await mapAdminQueueJobControlResponse('retry', req.params.id));
}));

router.post('/jobs/:id/cancel', asyncHandler(async (req, res) => {
	if (!isAdminQueueChannelControlsEnabled()) {
		const updated = await cancelQueueJob(req.params.id, { actorId: req.adminUser?.id });
		res.json(await mapQueueJobDetail(updated));
		return;
	}
	res.json(await mapAdminQueueJobControlResponse('cancel', req.params.id, { actorId: req.adminUser?.id }));
}));

router.post('/jobs/:id/pause', asyncHandler(async (req, res) => {
	if (!isAdminQueueChannelControlsEnabled()) {
		const updated = await pauseQueueJob(req.params.id);
		res.json(await mapQueueJobDetail(updated));
		return;
	}
	res.json(await mapAdminQueueJobControlResponse('pause', req.params.id));
}));

router.post('/jobs/:id/resume', asyncHandler(async (req, res) => {
	if (!isAdminQueueChannelControlsEnabled()) {
		const updated = await resumeQueueJob(req.params.id);
		res.json(await mapQueueJobDetail(updated));
		return;
	}
	res.json(await mapAdminQueueJobControlResponse('resume', req.params.id));
}));

router.post('/jobs/:id/requeue', asyncHandler(async (req, res) => {
	if (!isAdminQueueChannelControlsEnabled()) {
		const updated = await requeueDeadLetter(req.params.id);
		res.json(await mapQueueJobDetail(updated));
		return;
	}
	res.json(await mapAdminQueueJobControlResponse('requeue', req.params.id));
}));

router.delete('/jobs/:id', asyncHandler(async (req, res) => {
	if (!isAdminQueueChannelControlsEnabled()) {
		const result = await deleteQueueJob(req.params.id);
		res.json(result);
		return;
	}
	res.json(await mapAdminQueueJobControlResponse('delete', req.params.id));
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
