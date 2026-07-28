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

function workspaceLogOptions(req) {
	return {
		workspaceKey: req.workspaceKey || req.workspace?.workspace_key || '',
		ownerId: req.workspaceKey ? null : req.pocketbaseUserId,
	};
}

router.get('/', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.read');
	const list = await listAuditLogs(req.query || {}, workspaceLogOptions(req));
	res.json(list);
}));

router.get('/export', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.read');
	const format = String(req.query.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
	const list = await listAuditLogs({ ...(req.query || {}), page: 1, perPage: 500 }, workspaceLogOptions(req));
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
	const workspaceKey = req.workspaceKey || req.workspace?.workspace_key || '';
	const matchesWorkspace = workspaceKey && event?.workspaceKey === workspaceKey;
	const matchesActor = !workspaceKey && event?.actorUserId === req.pocketbaseUserId;
	if (!event || (!matchesWorkspace && !matchesActor)) {
		throw httpError(404, 'Log event not found', 'NOT_FOUND');
	}
	res.json(event);
}));

export default router;
