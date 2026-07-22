import { Router } from 'express';
import {
	exportLogs,
	getAuditLog,
	getLogsMonitorPayload,
	listAdminActivity,
	listAuditLogs,
	listSecurityFeed,
	listSystemLogLines,
} from '../../services/audit/index.js';
import { httpError } from '../../middleware/require-admin.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/', asyncHandler(async (req, res) => {
	const payload = await getLogsMonitorPayload(req.query || {});
	res.json(payload);
}));

router.get('/summary', asyncHandler(async (req, res) => {
	const payload = await getLogsMonitorPayload({ ...(req.query || {}), perPage: 1 });
	res.json({
		summary: payload.summary,
		filters: payload.filters,
		meta: payload.meta,
	});
}));

router.get('/export', asyncHandler(async (req, res) => {
	const format = String(req.query.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
	const file = await exportLogs(req.query || {}, format);
	res.setHeader('Content-Type', file.contentType);
	res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
	res.send(file.body);
}));

router.get('/security', asyncHandler(async (req, res) => {
	const items = await listSecurityFeed(Number(req.query.limit) || 50);
	res.json({ items, totalItems: items.length });
}));

router.get('/admin-activity', asyncHandler(async (req, res) => {
	const items = await listAdminActivity(Number(req.query.limit) || 50);
	res.json({ items, totalItems: items.length });
}));

router.get('/system', asyncHandler(async (req, res) => {
	const items = await listSystemLogLines(Number(req.query.limit) || 100);
	res.json({ items });
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
			const list = await listAuditLogs({ page: 1, perPage: 10 });
			res.write(`event: logs\ndata: ${JSON.stringify({ items: list.items, at: new Date().toISOString() })}\n\n`);
		} catch (error) {
			res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
		}
	};

	await push();
	const interval = setInterval(push, 5000);
	req.on('close', () => clearInterval(interval));
}));

router.get('/:id', asyncHandler(async (req, res) => {
	const event = await getAuditLog(req.params.id);
	if (!event) throw httpError(404, 'Log event not found', 'NOT_FOUND');
	res.json(event);
}));

export default router;
