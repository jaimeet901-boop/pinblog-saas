import { Router } from 'express';
import {
	createNotificationTemplate,
	listNotificationHistory,
	listNotificationTemplates,
	listNotificationsOverview,
} from '../../services/admin/notifications.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/templates', asyncHandler(async (req, res) => {
	res.json(await listNotificationTemplates(req.query || {}));
}));

router.post('/templates', asyncHandler(async (req, res) => {
	const actor = req.adminUser || { id: req.pocketbaseUserId };
	res.status(201).json(await createNotificationTemplate(req.body || {}, actor));
}));

router.get('/history', asyncHandler(async (req, res) => {
	res.json(await listNotificationHistory(req.query || {}));
}));

router.get('/', asyncHandler(async (req, res) => {
	res.json(await listNotificationsOverview(req.query || {}));
}));

export default router;
