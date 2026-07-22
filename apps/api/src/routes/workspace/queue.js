import { Router } from 'express';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import {
	cancelQueueJob,
	getQueueJob,
	mapQueueJobDetail,
	mapQueueJobDto,
	normalizeJobType,
	retryQueueJob,
} from '../../services/queue/index.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function normalizePositiveInt(value, fallback, max = 100) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(max, n);
}

router.get('/jobs', asyncHandler(async (req, res) => {
	const owner = req.pocketbaseUserId;
	const page = normalizePositiveInt(req.query.page, 1);
	const perPage = normalizePositiveInt(req.query.perPage, 20, 100);
	const status = String(req.query.status || '').trim();
	const type = normalizeJobType(req.query.type || '');

	const parts = [pocketbaseClient.filter('owner = {:owner}', { owner })];
	if (status) parts.push(pocketbaseClient.filter('status = {:status}', { status }));
	if (type) parts.push(pocketbaseClient.filter('type = {:type}', { type }));

	const result = await pocketbaseClient.collection('queue_jobs').getList(page, perPage, {
		filter: parts.join(' && '),
		sort: '-created',
		expand: 'owner,workspace',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));

	res.json({
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		items: (result.items || []).map((job) => mapQueueJobDto(job)),
	});
}));

router.get('/jobs/:id', asyncHandler(async (req, res) => {
	const job = await getQueueJob(req.params.id);
	if (!job || job.owner !== req.pocketbaseUserId) {
		throw httpError(404, 'Job not found', 'NOT_FOUND');
	}
	res.json(await mapQueueJobDetail(job));
}));

router.post('/jobs/:id/cancel', asyncHandler(async (req, res) => {
	const job = await getQueueJob(req.params.id);
	if (!job || job.owner !== req.pocketbaseUserId) {
		throw httpError(404, 'Job not found', 'NOT_FOUND');
	}
	const updated = await cancelQueueJob(job.id, { actorId: req.pocketbaseUserId });
	res.json(await mapQueueJobDetail(updated));
}));

router.post('/jobs/:id/retry', asyncHandler(async (req, res) => {
	const job = await getQueueJob(req.params.id);
	if (!job || job.owner !== req.pocketbaseUserId) {
		throw httpError(404, 'Job not found', 'NOT_FOUND');
	}
	const updated = await retryQueueJob(job.id);
	res.json(await mapQueueJobDetail(updated));
}));

export default router;
