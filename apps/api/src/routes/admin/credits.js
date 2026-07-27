import { Router } from 'express';
import {
	adminCommitReservation,
	adminReleaseReservation,
	adminReserveCredits,
	adminResetCredits,
	adminSuspendCredits,
	getCreditsSummary,
	getWorkspaceWallet,
	grantCredits,
	listBillingHistory,
	listCreditLedger,
	listReservations,
	listWorkspaceUsage,
} from '../../services/credits.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function actor(req) {
	return req.adminUser?.email || req.adminUser?.id || 'admin';
}

router.get('/summary', asyncHandler(async (req, res) => {
	res.json(await getCreditsSummary());
}));

router.get('/ledger', asyncHandler(async (req, res) => {
	res.json(await listCreditLedger(req.query || {}));
}));

router.post('/grant', asyncHandler(async (req, res) => {
	res.status(201).json(await grantCredits(req.body || {}, actor(req)));
}));

router.get('/usage', asyncHandler(async (req, res) => {
	res.json(await listWorkspaceUsage(req.query || {}));
}));

router.get('/wallets/:workspaceKey', asyncHandler(async (req, res) => {
	res.json(await getWorkspaceWallet(req.params.workspaceKey));
}));

router.get('/reservations', asyncHandler(async (req, res) => {
	res.json(await listReservations(req.query || {}));
}));

router.post('/reservations', asyncHandler(async (req, res) => {
	res.status(201).json(await adminReserveCredits(req.body || {}, req.adminUser?.id || ''));
}));

router.post('/reservations/:id/commit', asyncHandler(async (req, res) => {
	res.json(await adminCommitReservation(req.params.id, actor(req)));
}));

router.post('/reservations/:id/release', asyncHandler(async (req, res) => {
	res.json(await adminReleaseReservation(req.params.id, actor(req)));
}));

router.post('/refund', asyncHandler(async (req, res) => {
	res.status(201).json(await grantCredits({ ...(req.body || {}), type: 'refund' }, actor(req)));
}));

router.post('/reset', asyncHandler(async (req, res) => {
	const workspaceKey = req.body?.workspaceKey || req.body?.workspace_key;
	res.json(await adminResetCredits(workspaceKey, actor(req)));
}));

router.post('/suspend', asyncHandler(async (req, res) => {
	const workspaceKey = req.body?.workspaceKey || req.body?.workspace_key;
	res.json(await adminSuspendCredits(workspaceKey, req.body?.suspended !== false, actor(req)));
}));

router.post('/unsuspend', asyncHandler(async (req, res) => {
	const workspaceKey = req.body?.workspaceKey || req.body?.workspace_key;
	res.json(await adminSuspendCredits(workspaceKey, false, actor(req)));
}));

router.get('/history', asyncHandler(async (req, res) => {
	res.json(await listBillingHistory(req.query || {}));
}));

export default router;
