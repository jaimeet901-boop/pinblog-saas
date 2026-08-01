import { Router } from 'express';
import {
	getAccountPasswordStatus,
	updateAccountPassword,
} from '../../services/account-password.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/password', asyncHandler(async (req, res) => {
	res.json(await getAccountPasswordStatus(req));
}));

router.post('/password', asyncHandler(async (req, res) => {
	res.json(await updateAccountPassword(req, req.body || {}));
}));

export default router;
