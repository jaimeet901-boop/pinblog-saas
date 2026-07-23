import { Router } from 'express';
import {
	activateAdminWorkspace,
	deleteAdminWorkspace,
	getAdminWorkspace,
	listAdminWorkspaces,
	suspendAdminWorkspace,
	transferAdminWorkspace,
	updateAdminWorkspace,
} from '../../services/admin/workspaces.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function actor(req) {
	return req.adminUser || { id: req.pocketbaseUserId };
}

router.get('/', asyncHandler(async (req, res) => {
	res.json(await listAdminWorkspaces(req.query || {}));
}));

router.get('/:id', asyncHandler(async (req, res) => {
	res.json(await getAdminWorkspace(req.params.id));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
	res.json(await updateAdminWorkspace(req.params.id, req.body || {}, actor(req)));
}));

router.post('/:id/suspend', asyncHandler(async (req, res) => {
	res.json(await suspendAdminWorkspace(req.params.id, actor(req)));
}));

router.post('/:id/activate', asyncHandler(async (req, res) => {
	res.json(await activateAdminWorkspace(req.params.id, actor(req)));
}));

router.post('/:id/transfer', asyncHandler(async (req, res) => {
	res.json(await transferAdminWorkspace(req.params.id, req.body?.newOwnerUserId, actor(req)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
	res.json(await deleteAdminWorkspace(req.params.id, actor(req)));
}));

export default router;
