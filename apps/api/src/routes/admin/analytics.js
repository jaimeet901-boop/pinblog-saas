import { Router } from 'express';
import {
	buildPlatformOverview,
	exportPlatformAnalytics,
	refreshAnalyticsCaches,
} from '../../services/analytics/index.js';
import { computeQueueSummary, listWorkers } from '../../services/queue/index.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/overview', asyncHandler(async (req, res) => {
	const range = String(req.query.range || '30d');
	const from = req.query.from || '';
	const to = req.query.to || '';
	const bypassCache = String(req.query.refresh || '') === '1';
	const overview = await buildPlatformOverview({ range, from, to, bypassCache });
	res.json(overview);
}));

router.get('/export', asyncHandler(async (req, res) => {
	const range = String(req.query.range || '30d');
	const from = req.query.from || '';
	const to = req.query.to || '';
	const format = String(req.query.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
	const file = await exportPlatformAnalytics({ range, from, to, format });
	res.setHeader('Content-Type', file.contentType);
	res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
	res.send(file.body);
}));

router.get('/providers', asyncHandler(async (req, res) => {
	const overview = await buildPlatformOverview({ range: req.query.range || '30d' });
	res.json({ items: overview.providers || [], topModels: overview.topModels || [] });
}));

router.get('/queue', asyncHandler(async (req, res) => {
	const [summary, workers] = await Promise.all([
		computeQueueSummary(),
		listWorkers(),
	]);
	res.json({
		...summary.metrics,
		health: summary.health,
		queue: {
			running: summary.running,
			queued: summary.queued,
			failed: summary.failed,
			retry: summary.retry,
			completedToday: summary.completedToday,
			avgProcessingTime: summary.avgProcessingTime,
			jobsPerMinute: summary.jobsPerMinute,
		},
		workers,
	});
}));

router.get('/publishing', asyncHandler(async (req, res) => {
	const overview = await buildPlatformOverview({ range: req.query.range || '30d' });
	res.json(overview.publishing || {});
}));

router.post('/refresh', asyncHandler(async (req, res) => {
	const result = await refreshAnalyticsCaches({ ownerId: req.adminUser?.id });
	res.json(result);
}));

export default router;
