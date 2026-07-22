import { Router } from 'express';
import { httpError } from '../../middleware/require-admin.js';
import {
	assignWorkspacePlan,
	createPlan,
	deletePlan,
	duplicatePlan,
	getPlanById,
	listPlans,
	listSubscriptions,
	setPlanEnabled,
	updatePlan,
} from '../../services/plans.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function notFound(error) {
	if (error?.status === 404) {
		throw httpError(404, 'Plan not found', 'PLAN_NOT_FOUND');
	}
	throw error;
}

router.get('/', asyncHandler(async (req, res) => {
	res.json(await listPlans());
}));

router.post('/', asyncHandler(async (req, res) => {
	res.status(201).json(await createPlan(req.body || {}));
}));

router.get('/subscriptions', asyncHandler(async (req, res) => {
	res.json(await listSubscriptions());
}));

router.post('/assign', asyncHandler(async (req, res) => {
	res.status(201).json(await assignWorkspacePlan(req.body || {}));
}));

router.get('/:id', asyncHandler(async (req, res) => {
	try {
		res.json(await getPlanById(req.params.id));
	} catch (error) {
		notFound(error);
	}
}));

router.patch('/:id', asyncHandler(async (req, res) => {
	try {
		res.json(await updatePlan(req.params.id, req.body || {}));
	} catch (error) {
		notFound(error);
	}
}));

router.post('/:id/duplicate', asyncHandler(async (req, res) => {
	try {
		res.status(201).json(await duplicatePlan(req.params.id));
	} catch (error) {
		notFound(error);
	}
}));

router.post('/:id/enable', asyncHandler(async (req, res) => {
	try {
		res.json(await setPlanEnabled(req.params.id, true));
	} catch (error) {
		notFound(error);
	}
}));

router.post('/:id/disable', asyncHandler(async (req, res) => {
	try {
		res.json(await setPlanEnabled(req.params.id, false));
	} catch (error) {
		notFound(error);
	}
}));

router.delete('/:id', asyncHandler(async (req, res) => {
	try {
		res.json(await deletePlan(req.params.id));
	} catch (error) {
		notFound(error);
	}
}));

export default router;
