import { Router } from 'express';
import { httpError } from '../../middleware/require-admin.js';
import {
	exportPlatformSettings,
	getPlatformSettings,
	importPlatformSettings,
	resetPlatformSettings,
	upsertPlatformSettings,
	ensurePlatformSettingsSeeded,
} from '../../services/platform-settings.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function actorFromReq(req) {
	return {
		id: req.adminUser?.id || req.pocketbaseUserId,
		email: req.adminUser?.email,
		name: req.adminUser?.name,
	};
}

router.get('/', asyncHandler(async (_req, res) => {
	await ensurePlatformSettingsSeeded().catch(() => null);
	res.json(await getPlatformSettings());
}));

router.put('/', asyncHandler(async (req, res) => {
	const settings = req.body?.settings || req.body;
	if (!settings || typeof settings !== 'object') {
		throw httpError(422, 'settings object is required', 'VALIDATION_ERROR');
	}
	res.json(await upsertPlatformSettings(settings, actorFromReq(req)));
}));

router.post('/reset', asyncHandler(async (req, res) => {
	res.json(await resetPlatformSettings(actorFromReq(req)));
}));

router.get('/export', asyncHandler(async (_req, res) => {
	const document = await exportPlatformSettings();
	res.setHeader('Content-Disposition', 'attachment; filename="chef-ia-platform-settings.json"');
	res.json(document);
}));

router.post('/import', asyncHandler(async (req, res) => {
	res.json(await importPlatformSettings(req.body || {}, actorFromReq(req)));
}));

export default router;
