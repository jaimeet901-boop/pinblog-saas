import { Router } from 'express';
import {
	activateAdminUser,
	deleteAdminUser,
	getAdminUser,
	listAdminUsers,
	resetAdminUserPassword,
	suspendAdminUser,
	updateAdminUser,
} from '../../services/admin/users.js';

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
	res.json(await listAdminUsers(req.query || {}));
}));

router.get('/:id', asyncHandler(async (req, res) => {
	res.json(await getAdminUser(req.params.id));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
	res.json(await updateAdminUser(req.params.id, req.body || {}, actor(req)));
}));

router.post('/:id/suspend', asyncHandler(async (req, res) => {
	res.json(await suspendAdminUser(req.params.id, req.body?.reason || '', actor(req)));
}));

router.post('/:id/activate', asyncHandler(async (req, res) => {
	res.json(await activateAdminUser(req.params.id, actor(req)));
}));

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
	res.json(await resetAdminUserPassword(req.params.id, actor(req)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
	res.json(await deleteAdminUser(req.params.id, actor(req)));
}));

export default router;
