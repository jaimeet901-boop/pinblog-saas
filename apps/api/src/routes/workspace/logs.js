import { Router } from 'express';
import { assertCapability } from '../../services/workspace-rbac.js';
import { getAuditLog, listAuditLogs } from '../../services/audit/index.js';

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

router.get('/', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.read');
	const list = await listAuditLogs(req.query || {}, { ownerId: req.pocketbaseUserId });
	res.json(list);
}));

router.get('/export', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.read');
	const format = String(req.query.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
	const list = await listAuditLogs({ ...(req.query || {}), page: 1, perPage: 500 }, { ownerId: req.pocketbaseUserId });
	if (format === 'csv') {
		const headers = ['id', 'timestamp', 'category', 'severity', 'action', 'result', 'service'];
		const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
		const lines = [headers.join(',')];
		for (const event of list.items) {
			lines.push(headers.map((key) => escape(event[key])).join(','));
		}
		res.setHeader('Content-Type', 'text/csv;charset=utf-8');
		res.setHeader('Content-Disposition', 'attachment; filename="workspace-audit.csv"');
		res.send(`${lines.join('\n')}\n`);
		return;
	}
	res.setHeader('Content-Type', 'application/json');
	res.setHeader('Content-Disposition', 'attachment; filename="workspace-audit.json"');
	res.send(JSON.stringify(list, null, 2));
}));

router.get('/:id', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.read');
	const event = await getAuditLog(req.params.id);
	if (!event || event.actorUserId !== req.pocketbaseUserId) {
		throw httpError(404, 'Log event not found', 'NOT_FOUND');
	}
	res.json(event);
}));

export default router;
