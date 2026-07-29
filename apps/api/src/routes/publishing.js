/**
 * Publishing History routes — Phase 2 read API.
 * Does not alter /pinterest/history or /wordpress/history.
 */

import { Router } from 'express';
import { listPublishingHistory } from '../services/publishing-history/list.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/history', asyncHandler(async (req, res) => {
	const payload = await listPublishingHistory(req, req.query || {});
	res.json(payload);
}));

export default router;
