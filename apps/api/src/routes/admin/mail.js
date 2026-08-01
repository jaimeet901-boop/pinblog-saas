import { Router } from 'express';
import {
	getPocketBaseMailDiagnostics,
	sendPocketBaseTestEmail,
	syncPlatformSmtpToPocketBase,
	updatePocketBaseMailSettings,
} from '../../services/pocketbase-mail.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/', asyncHandler(async (_req, res) => {
	res.json(await getPocketBaseMailDiagnostics());
}));

router.post('/test', asyncHandler(async (req, res) => {
	res.json(await sendPocketBaseTestEmail(req.body || {}));
}));

router.post('/sync-platform-smtp', asyncHandler(async (_req, res) => {
	res.json(await syncPlatformSmtpToPocketBase());
}));

router.put('/settings', asyncHandler(async (req, res) => {
	res.json(await updatePocketBaseMailSettings(req.body || {}));
}));

export default router;
