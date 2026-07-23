import { Router } from 'express';
import {
	listInventoryPinterestAccounts,
	listInventoryWebsites,
} from '../../services/admin/inventory.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/websites', asyncHandler(async (req, res) => {
	res.json(await listInventoryWebsites(req.query || {}));
}));

router.get('/pinterest-accounts', asyncHandler(async (req, res) => {
	res.json(await listInventoryPinterestAccounts(req.query || {}));
}));

export default router;
