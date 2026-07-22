import { Router } from 'express';
import {
	acknowledgeAlert,
	exportHealthReport,
	getHealthHistory,
	getLatestHealthPayload,
	listIncidents,
	listProviderHealth,
	listServiceStatuses,
	listWorkerHealth,
	resolveAlert,
	runHealthCheck,
} from '../../services/health/index.js';
import { httpError } from '../../middleware/require-admin.js';
import { refreshAnalyticsCaches } from '../../services/analytics/index.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/health', asyncHandler(async (req, res) => {
	const refresh = String(req.query.refresh || '') === '1';
	const payload = await getLatestHealthPayload({ refresh });
	res.json(payload);
}));

router.get('/overview', asyncHandler(async (req, res) => {
	const payload = await getLatestHealthPayload({ refresh: String(req.query.refresh || '') === '1' });
	res.json(payload);
}));

router.get('/services', asyncHandler(async (_req, res) => {
	const items = await listServiceStatuses();
	res.json({ items });
}));

router.get('/providers', asyncHandler(async (_req, res) => {
	const items = await listProviderHealth();
	res.json({ items });
}));

router.get('/workers', asyncHandler(async (_req, res) => {
	const items = await listWorkerHealth();
	res.json({ items });
}));

router.get('/incidents', asyncHandler(async (req, res) => {
	const result = await listIncidents(req.query || {});
	res.json(result);
}));

router.get('/history', asyncHandler(async (req, res) => {
	const items = await getHealthHistory(Number(req.query.limit) || 24);
	res.json({ items });
}));

router.get('/certificates', asyncHandler(async (req, res) => {
	const payload = await getLatestHealthPayload();
	res.json({ items: payload.certificates || [] });
}));

router.get('/export', asyncHandler(async (req, res) => {
	const format = String(req.query.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
	const file = await exportHealthReport(format);
	res.setHeader('Content-Type', file.contentType);
	res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
	res.send(file.body);
}));

router.post('/checks/run', asyncHandler(async (_req, res) => {
	const payload = await runHealthCheck({ persist: true });
	res.json({ ok: true, overall: payload.overall, summary: payload.summary, checkedAt: payload.meta?.checkedAt });
}));

router.post('/refresh', asyncHandler(async (_req, res) => {
	const payload = await runHealthCheck({ persist: true });
	res.json(payload);
}));

router.post('/alerts/:id/acknowledge', asyncHandler(async (req, res) => {
	const row = await acknowledgeAlert(req.params.id).catch(() => null);
	if (!row) throw httpError(404, 'Alert not found', 'NOT_FOUND');
	res.json({ ok: true, id: row.id, status: row.status });
}));

router.post('/alerts/:id/resolve', asyncHandler(async (req, res) => {
	const row = await resolveAlert(req.params.id).catch(() => null);
	if (!row) throw httpError(404, 'Alert not found', 'NOT_FOUND');
	res.json({ ok: true, id: row.id, status: row.status });
}));

router.post('/actions/clear-cache', asyncHandler(async (req, res) => {
	const result = await refreshAnalyticsCaches({ ownerId: req.adminUser?.id }).catch(() => ({ ok: false }));
	res.json({ ok: true, message: 'Caches refreshed', result });
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
			const payload = await getLatestHealthPayload();
			res.write(`event: health\ndata: ${JSON.stringify({
				overall: payload.overall,
				summary: payload.summary,
				alerts: payload.alerts,
				at: new Date().toISOString(),
			})}\n\n`);
		} catch (error) {
			res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
		}
	};

	await push();
	const interval = setInterval(push, 5000);
	req.on('close', () => clearInterval(interval));
}));

export default router;
