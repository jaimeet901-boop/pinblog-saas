import { Router } from 'express';
import {
	getCreditsSummary,
	grantCredits,
	listCreditLedger,
	listWorkspaceUsage,
} from '../../services/credits.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/summary', asyncHandler(async (req, res) => {
	res.json(await getCreditsSummary());
}));

router.get('/ledger', asyncHandler(async (req, res) => {
	res.json(await listCreditLedger(req.query || {}));
}));

router.post('/grant', asyncHandler(async (req, res) => {
	const actor = req.adminUser?.email || req.adminUser?.id || 'admin';
	res.status(201).json(await grantCredits(req.body || {}, actor));
}));

router.get('/usage', asyncHandler(async (req, res) => {
	res.json(await listWorkspaceUsage(req.query || {}));
}));

export default router;
