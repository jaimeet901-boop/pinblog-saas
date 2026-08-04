/**
 * Admin AI Runtime management endpoints (data only — no UI redesign).
 */

import { Router } from 'express';
import { httpError } from '../../middleware/require-admin.js';
import {
	getAiRuntimeDashboard,
	getRuntimePriority,
	setRuntimeProviderPriority,
} from '../../services/text-providers/dashboard.js';
import { getTextProviderRegistrySnapshot } from '../../services/text-providers/registry.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

/** Full runtime dashboard payload for Admin Console. */
router.get('/', asyncHandler(async (_req, res) => {
	const dashboard = await getAiRuntimeDashboard();
	res.json(dashboard);
}));

router.get('/dashboard', asyncHandler(async (_req, res) => {
	const dashboard = await getAiRuntimeDashboard();
	res.json(dashboard);
}));

router.get('/registry', asyncHandler(async (_req, res) => {
	const snapshot = await getTextProviderRegistrySnapshot();
	res.json(snapshot);
}));

router.get('/priority', asyncHandler(async (_req, res) => {
	const priority = await getRuntimePriority();
	res.json(priority);
}));

/**
 * Body: { order: string[] } or { runtimePriority: string[] }
 * Sets failover order used by the Universal Runtime.
 */
router.put('/priority', asyncHandler(async (req, res) => {
	const order = req.body?.order || req.body?.runtimePriority;
	if (!Array.isArray(order) || order.length === 0) {
		throw httpError(422, 'Provide order: string[] of provider codes', 'VALIDATION_ERROR');
	}
	const actor = {
		id: req.user?.id,
		email: req.user?.email,
		name: req.user?.name,
	};
	const dashboard = await setRuntimeProviderPriority(order, actor);
	res.json(dashboard);
}));

export default router;
