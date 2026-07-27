import { Router } from 'express';
import { handleBillingWebhook } from '../services/billing/index.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

/**
 * Public provider webhooks — no session auth; verified by provider signature later.
 * POST /billing/webhooks/:provider
 */
router.post('/webhooks/:provider', asyncHandler(async (req, res) => {
	try {
		const result = await handleBillingWebhook(req, req.params.provider);
		res.status(200).json(result);
	} catch (error) {
		const status = error?.status || 500;
		res.status(status).json({
			ok: false,
			error: error?.errorCode || 'WEBHOOK_ERROR',
			message: error?.message || 'Webhook failed',
		});
	}
}));

router.post('/webhooks', asyncHandler(async (req, res) => {
	try {
		const result = await handleBillingWebhook(req);
		res.status(200).json(result);
	} catch (error) {
		const status = error?.status || 500;
		res.status(status).json({
			ok: false,
			error: error?.errorCode || 'WEBHOOK_ERROR',
			message: error?.message || 'Webhook failed',
		});
	}
}));

export default router;
