import { Router } from 'express';
import { assertCapability } from '../../services/workspace-rbac.js';
import { PRODUCT_EVENT_NAMES, recordProductEvent } from '../../services/product-events.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

/**
 * POST /workspace/v1/product-events
 * Fire-and-forget product funnel events. Always returns quickly.
 */
router.post('/', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.read');
	const result = await recordProductEvent(req, req.body || {});
	res.status(202).json(result);
}));

router.get('/catalog', asyncHandler(async (req, res) => {
	assertCapability(req, 'workspace.read');
	res.json({ events: [...PRODUCT_EVENT_NAMES] });
}));

export default router;
