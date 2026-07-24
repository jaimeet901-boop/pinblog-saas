import { Router } from 'express';
import { pocketbaseAuth } from '../../middleware/pocketbase-auth.js';
import { resolveWorkspace } from '../../middleware/resolve-workspace.js';
import { mapMemberDto } from '../../services/workspace-rbac.js';
import {
	getWorkspaceSettings,
	updateWorkspaceSettings,
	getWorkspaceProfile,
	updateWorkspaceProfile,
} from '../../services/workspace-settings.js';
import {
	getWorkspaceSubscription,
	changeWorkspacePlan,
	getWorkspaceUsage,
	getWorkspaceCredits,
} from '../../services/workspace-billing.js';
import { getWorkspaceDashboard } from '../../services/workspace-dashboard.js';
import {
	listWorkspaceTemplates,
	createPinTemplate,
	updatePinTemplate,
	deletePinTemplate,
	duplicatePinTemplate,
	createCatalogTemplate,
	updateCatalogTemplate,
	deleteCatalogTemplate,
} from '../../services/workspace-templates.js';
import {
	listWorkspaceNotifications,
	createWorkspaceNotification,
	markNotificationRead,
	dismissNotification,
	markAllNotificationsRead,
} from '../../services/workspace-notifications.js';
import {
	listCalendarEvents,
	createCalendarEvent,
	updateCalendarEvent,
	rescheduleCalendarEvent,
	deleteCalendarEvent,
} from '../../services/workspace-calendar.js';
import { getWorkspaceHistory } from '../../services/workspace-history.js';
import {
	buildWorkspaceConfig,
	isWorkspaceConfigUnchanged,
	subscribeWorkspaceConfigStream,
	workspaceConfigEtag,
	WORKSPACE_CONFIG_API_VERSION,
} from '../../services/workspace-config.js';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import queueRouter from './queue.js';
import analyticsRouter from './analytics.js';
import logsRouter from './logs.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.use(pocketbaseAuth, resolveWorkspace);
router.use('/queue', queueRouter);
router.use('/analytics', analyticsRouter);
router.use('/logs', logsRouter);

/**
 * Additive Workspace Config API (Phase 1).
 * Optional for unmigrated modules — existing /workspace/v1/* endpoints unchanged.
 */
router.get('/config', asyncHandler(async (req, res) => {
	const config = await buildWorkspaceConfig(req);
	const etag = workspaceConfigEtag(config);
	res.setHeader('ETag', etag);
	res.setHeader('Cache-Control', 'private, no-cache');
	res.setHeader('X-Workspace-Config-Version', String(config.configVersion));
	res.setHeader('X-Workspace-Config-Api', WORKSPACE_CONFIG_API_VERSION);

	if (isWorkspaceConfigUnchanged(req, config)) {
		return res.status(304).end();
	}

	return res.json(config);
}));

router.get('/config/stream', asyncHandler(async (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');
	res.flushHeaders?.();

	const unsubscribe = subscribeWorkspaceConfigStream(res, {
		workspaceId: req.workspace?.id || '',
		apiVersion: WORKSPACE_CONFIG_API_VERSION,
	});

	const heartbeat = setInterval(() => {
		try {
			res.write(': heartbeat\n\n');
		} catch {
			clearInterval(heartbeat);
			unsubscribe();
		}
	}, 25000);

	req.on('close', () => {
		clearInterval(heartbeat);
		unsubscribe();
	});
}));

router.get('/me', async (req, res) => {
	res.json({
		workspace: req.workspaceDto,
		role: req.workspaceRole,
		user: {
			id: req.workspaceUser.id,
			name: req.workspaceUser.name,
			email: req.workspaceUser.email,
			plan: req.workspaceUser.plan,
		},
	});
});

router.get('/members', async (req, res) => {
	const records = await pocketbaseClient.collection('workspace_members').getFullList({
		filter: pocketbaseClient.filter('workspace = {:ws} && status = "active"', { ws: req.workspace.id }),
		requestKey: null,
	});
	res.json({ items: records.map(mapMemberDto), totalItems: records.length });
});

router.get('/dashboard', async (req, res) => {
	res.json(await getWorkspaceDashboard(req));
});

router.get('/settings', async (req, res) => {
	res.json(await getWorkspaceSettings(req));
});

router.patch('/settings', async (req, res) => {
	res.json(await updateWorkspaceSettings(req, req.body || {}));
});

router.put('/settings', async (req, res) => {
	res.json(await updateWorkspaceSettings(req, req.body || {}));
});

router.get('/profile', async (req, res) => {
	res.json(await getWorkspaceProfile(req));
});

router.patch('/profile', async (req, res) => {
	res.json(await updateWorkspaceProfile(req, req.body || {}));
});

router.get('/subscription', async (req, res) => {
	res.json(await getWorkspaceSubscription(req));
});

router.post('/subscription/change', async (req, res) => {
	res.json(await changeWorkspacePlan(req, req.body || {}));
});

router.get('/usage', async (req, res) => {
	res.json(await getWorkspaceUsage(req));
});

router.get('/credits', async (req, res) => {
	res.json(await getWorkspaceCredits(req));
});

router.get('/history', async (req, res) => {
	res.json(await getWorkspaceHistory(req, req.query));
});

router.get('/templates', async (req, res) => {
	res.json(await listWorkspaceTemplates(req, req.query));
});

router.post('/templates', async (req, res) => {
	const category = req.body?.category;
	if (category && category !== 'pin') {
		const created = await createCatalogTemplate(req, req.body || {});
		return res.status(201).json(created);
	}
	const created = await createPinTemplate(req, req.body || {});
	return res.status(201).json(created);
});

router.post('/templates/:id/duplicate', async (req, res) => {
	res.status(201).json(await duplicatePinTemplate(req, req.params.id));
});

router.patch('/templates/:id', async (req, res) => {
	if (req.body?.source === 'templates' || req.query.source === 'templates') {
		return res.json(await updateCatalogTemplate(req, req.params.id, req.body || {}));
	}
	res.json(await updatePinTemplate(req, req.params.id, req.body || {}));
});

router.delete('/templates/:id', async (req, res) => {
	if (req.query.source === 'templates') {
		return res.json(await deleteCatalogTemplate(req, req.params.id));
	}
	res.json(await deletePinTemplate(req, req.params.id));
});

router.get('/notifications', async (req, res) => {
	res.json(await listWorkspaceNotifications(req, req.query));
});

router.post('/notifications', async (req, res) => {
	res.status(201).json(await createWorkspaceNotification(req, req.body || {}));
});

router.post('/notifications/read-all', async (req, res) => {
	res.json(await markAllNotificationsRead(req));
});

router.post('/notifications/:id/read', async (req, res) => {
	res.json(await markNotificationRead(req, req.params.id));
});

router.post('/notifications/:id/dismiss', async (req, res) => {
	res.json(await dismissNotification(req, req.params.id));
});

router.get('/calendar', async (req, res) => {
	res.json(await listCalendarEvents(req, req.query));
});

router.post('/calendar', async (req, res) => {
	res.status(201).json(await createCalendarEvent(req, req.body || {}));
});

router.patch('/calendar/:id', async (req, res) => {
	res.json(await updateCalendarEvent(req, req.params.id, req.body || {}));
});

router.post('/calendar/:id/reschedule', async (req, res) => {
	res.json(await rescheduleCalendarEvent(req, req.params.id, req.body || {}));
});

router.delete('/calendar/:id', async (req, res) => {
	res.json(await deleteCalendarEvent(req, req.params.id));
});

export default router;
