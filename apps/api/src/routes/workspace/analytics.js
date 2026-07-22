import { Router } from 'express';
import { assertCapability } from '../../services/workspace-rbac.js';
import {
	buildWorkspaceOverview,
	exportWorkspaceAnalytics,
} from '../../services/analytics/index.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.analytics.read');
	const overview = await buildWorkspaceOverview(req, {
		range: req.query.range || '30d',
		from: req.query.from || '',
		to: req.query.to || '',
		bypassCache: String(req.query.refresh || '') === '1',
	});
	res.json(overview);
}));

router.get('/overview', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.analytics.read');
	const overview = await buildWorkspaceOverview(req, {
		range: req.query.range || '30d',
		from: req.query.from || '',
		to: req.query.to || '',
		bypassCache: String(req.query.refresh || '') === '1',
	});
	res.json(overview);
}));

router.get('/export', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.analytics.read');
	const format = String(req.query.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
	const file = await exportWorkspaceAnalytics(req, {
		range: req.query.range || '30d',
		from: req.query.from || '',
		to: req.query.to || '',
		format,
	});
	res.setHeader('Content-Type', file.contentType);
	res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
	res.send(file.body);
}));

export default router;
