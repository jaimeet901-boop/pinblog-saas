import { Router } from 'express';
import {
	listBillingProviders,
	resolveBillingConfig,
	handleBillingWebhook,
	runBillingAutomationTick,
	runMonthlyCreditResetJob,
	listCreditPacks,
	purchaseCreditPack,
} from '../../services/billing/index.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/providers', asyncHandler(async (req, res) => {
	const [providers, config] = await Promise.all([
		listBillingProviders(),
		resolveBillingConfig(),
	]);
	res.json({ items: providers, config });
}));

router.get('/packs', asyncHandler(async (req, res) => {
	res.json(await listCreditPacks({
		planId: req.query.planId || '',
		planSlug: req.query.planSlug || '',
	}));
}));

router.post('/packs/fulfill-local', asyncHandler(async (req, res) => {
	const actor = req.adminUser?.email || req.adminUser?.id || 'admin';
	res.status(201).json(await purchaseCreditPack({
		...(req.body || {}),
		actor,
		actorUserId: req.adminUser?.id || '',
		allowLocalFulfillment: true,
	}));
}));

router.post('/automation/run', asyncHandler(async (req, res) => {
	res.json(await runBillingAutomationTick());
}));

router.post('/automation/reset-credits', asyncHandler(async (req, res) => {
	res.json(await runMonthlyCreditResetJob({ force: Boolean(req.body?.force) }));
}));

export default router;
