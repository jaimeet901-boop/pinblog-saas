import { Router } from 'express';
import { getAdminDashboard } from '../../services/admin/dashboard.js';

const router = Router();

router.get('/', async (req, res, next) => {
	try {
		res.json(await getAdminDashboard());
	} catch (error) {
		next(error);
	}
});

export default router;
