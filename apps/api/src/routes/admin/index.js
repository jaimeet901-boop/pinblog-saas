import { Router } from 'express';
import { pocketbaseAuth } from '../../middleware/pocketbase-auth.js';
import { assertAdminEnabled, requireAdmin } from '../../middleware/require-admin.js';
import { adminAuditMiddleware } from '../../middleware/admin-audit.js';
import providersRouter from './providers.js';
import modelsRouter from './models.js';
import plansRouter from './plans.js';
import creditsRouter from './credits.js';
import queueRouter from './queue.js';
import analyticsRouter from './analytics.js';
import logsRouter from './logs.js';
import systemRouter from './system.js';
import usersRouter from './users.js';
import workspacesRouter from './workspaces.js';
import inventoryRouter from './inventory.js';
import dashboardRouter from './dashboard.js';
import notificationsRouter from './notifications.js';
import pinterestRouter from './pinterest.js';
import settingsRouter from './settings.js';

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
router.use(adminAuditMiddleware);
router.use('/providers', providersRouter);
router.use('/models', modelsRouter);
router.use('/plans', plansRouter);
router.use('/credits', creditsRouter);
router.use('/queue', queueRouter);
router.use('/analytics', analyticsRouter);
router.use('/logs', logsRouter);
router.use('/system', systemRouter);
router.use('/users', usersRouter);
router.use('/workspaces', workspacesRouter);
router.use('/inventory', inventoryRouter);
router.use('/dashboard', dashboardRouter);
router.use('/notifications', notificationsRouter);
router.use('/pinterest', pinterestRouter);
router.use('/settings', settingsRouter);

export default router;
