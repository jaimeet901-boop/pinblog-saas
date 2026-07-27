import { Router } from 'express';
import {
	activateAdminWorkspace,
	deleteAdminWorkspace,
	getAdminWorkspace,
	getAdminWorkspaceActivity,
	getAdminWorkspaceMembers,
	grantAdminWorkspaceCredits,
	listAdminWorkspaces,
	resetAdminWorkspace,
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

router.get('/:id/members', asyncHandler(async (req, res) => {
	res.json(await getAdminWorkspaceMembers(req.params.id));
}));

router.get('/:id/activity', asyncHandler(async (req, res) => {
	res.json(await getAdminWorkspaceActivity(req.params.id, req.query || {}));
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

router.post('/:id/credits/grant', asyncHandler(async (req, res) => {
	res.status(201).json(await grantAdminWorkspaceCredits(req.params.id, req.body || {}, actor(req)));
}));

router.post('/:id/reset', asyncHandler(async (req, res) => {
	res.json(await resetAdminWorkspace(req.params.id, req.body || {}, actor(req)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
	res.json(await deleteAdminWorkspace(req.params.id, actor(req)));
}));

export default router;
