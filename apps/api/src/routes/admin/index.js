import { Router } from 'express';
import { pocketbaseAuth } from '../../middleware/pocketbase-auth.js';
import { assertAdminEnabled, requireAdmin } from '../../middleware/require-admin.js';
import providersRouter from './providers.js';
import modelsRouter from './models.js';

const router = Router();

router.use((req, res, next) => {
	try {
		assertAdminEnabled();
		next();
	} catch (error) {
		next(error);
	}
});

router.use(pocketbaseAuth);
router.use(requireAdmin);
router.use('/providers', providersRouter);
router.use('/models', modelsRouter);

export default router;
