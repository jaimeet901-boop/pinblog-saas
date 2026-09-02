import { Router } from 'express';
import { getPublicPricingCatalog } from '../services/public-plan-catalog.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

/**
 * Public plan catalog for /pricing — no auth.
 * GET /
 */
router.get('/', asyncHandler(async (_req, res) => {
	res.setHeader('Cache-Control', 'public, max-age=60');
	res.json(await getPublicPricingCatalog());
}));

export default router;
