import { Router } from 'express';
import { getPublicPlatformIdentity } from '../services/platform-settings.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

/**
 * Public Platform Identity slice for shell + public pages.
 * Read-only projection of platform_settings — no secrets.
 */
router.get('/', asyncHandler(async (_req, res) => {
	res.setHeader('Cache-Control', 'public, max-age=60');
	res.json(await getPublicPlatformIdentity());
}));

export default router;
