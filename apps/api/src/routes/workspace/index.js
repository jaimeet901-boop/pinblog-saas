import { Router } from 'express';
import { pocketbaseAuth } from '../../middleware/pocketbase-auth.js';
import { resolveWorkspace } from '../../middleware/resolve-workspace.js';
import {
	getWorkspaceSettings,
	updateWorkspaceSettings,
	getWorkspaceProfile,
	updateWorkspaceProfile,
} from '../../services/workspace-settings.js';
import {
	getWorkspaceSubscription,
	changeWorkspacePlan,
	startWorkspaceSubscriptionCheckout,
	getWorkspaceUsage,
	getWorkspaceCredits,
	purchaseWorkspaceCreditPack,
	cancelWorkspaceSubscription,
} from '../../services/workspace-billing.js';
import { getWorkspaceBillingHistory } from '../../services/workspace-billing-history.js';
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
	listGalleryTemplates,
	getPinTemplate,
	touchPinTemplate,
	setPinTemplateStatus,
	togglePinTemplateFavorite,
	exportPinTemplate,
	bulkPinTemplateAction,
	upsertTemplatePreviewCache,
	getTemplatePreviewFromCache,
} from '../../services/template-gallery.js';
import {
	listTemplateExportProfiles,
	listTemplateExportFormats,
	planTemplateExport,
	enqueueTemplateExportJob,
	planTemplateExportBatch,
	importTemplatePackage,
} from '../../services/template-export.js';
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
import { listUnifiedCalendarEvents } from '../../services/calendar/facade.js';
import {
	cancelCalendarScheduledItem,
	rescheduleCalendarScheduledItem,
	retryCalendarScheduledItem,
} from '../../services/calendar/mutations/router.js';
import { getWorkspaceHistory } from '../../services/workspace-history.js';
import {
	buildWorkspaceConfig,
	isWorkspaceConfigUnchanged,
	subscribeWorkspaceConfigStream,
	workspaceConfigEtag,
	WORKSPACE_CONFIG_API_VERSION,
} from '../../services/workspace-config.js';
import queueRouter from './queue.js';
import analyticsRouter from './analytics.js';
import logsRouter from './logs.js';
import productEventsRouter from './product-events.js';
import accountRouter from './account.js';

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
router.use('/product-events', productEventsRouter);
router.use('/account', accountRouter);

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
		capabilities: req.workspaceDto?.capabilities || [],
		user: {
			id: req.workspaceUser.id,
			name: req.workspaceUser.name,
			email: req.workspaceUser.email,
			plan: req.workspaceUser.plan,
		},
	});
});

router.get('/workspaces', asyncHandler(async (req, res) => {
	const { listUserWorkspaces } = await import('../../services/workspace-context.js');
	res.json({ items: await listUserWorkspaces(req.pocketbaseUserId) });
}));

router.get('/members', asyncHandler(async (req, res) => {
	const { listWorkspaceMembers } = await import('../../services/workspace-members.js');
	res.json(await listWorkspaceMembers(req, req.query || {}));
}));

router.post('/members/invite', asyncHandler(async (req, res) => {
	const { inviteWorkspaceMember } = await import('../../services/workspace-members.js');
	res.status(201).json(await inviteWorkspaceMember(req, req.body || {}));
}));

router.post('/members/accept', asyncHandler(async (req, res) => {
	const { acceptWorkspaceInvite } = await import('../../services/workspace-members.js');
	res.json(await acceptWorkspaceInvite(req, req.body || {}));
}));

router.post('/members/:id/resend', asyncHandler(async (req, res) => {
	const { resendWorkspaceInvite } = await import('../../services/workspace-members.js');
	res.json(await resendWorkspaceInvite(req, req.params.id));
}));

router.post('/members/:id/revoke', asyncHandler(async (req, res) => {
	const { revokeWorkspaceInvite } = await import('../../services/workspace-members.js');
	res.json(await revokeWorkspaceInvite(req, req.params.id));
}));

router.patch('/members/:id', asyncHandler(async (req, res) => {
	const { updateWorkspaceMember } = await import('../../services/workspace-members.js');
	res.json(await updateWorkspaceMember(req, req.params.id, req.body || {}));
}));

router.post('/members/:id/suspend', asyncHandler(async (req, res) => {
	const { suspendWorkspaceMember } = await import('../../services/workspace-members.js');
	res.json(await suspendWorkspaceMember(req, req.params.id, req.body || {}));
}));

router.post('/members/:id/reactivate', asyncHandler(async (req, res) => {
	const { reactivateWorkspaceMember } = await import('../../services/workspace-members.js');
	res.json(await reactivateWorkspaceMember(req, req.params.id));
}));

router.delete('/members/:id', asyncHandler(async (req, res) => {
	const { removeWorkspaceMember } = await import('../../services/workspace-members.js');
	res.json(await removeWorkspaceMember(req, req.params.id));
}));

router.post('/ownership/transfer', asyncHandler(async (req, res) => {
	const { transferWorkspaceOwnership } = await import('../../services/workspace-members.js');
	res.json(await transferWorkspaceOwnership(req, req.body || {}));
}));

router.get('/roles', asyncHandler(async (req, res) => {
	const { listWorkspaceRoles } = await import('../../services/workspace-members.js');
	res.json(await listWorkspaceRoles(req));
}));

router.post('/roles', asyncHandler(async (req, res) => {
	const { createWorkspaceRole } = await import('../../services/workspace-members.js');
	res.status(201).json(await createWorkspaceRole(req, req.body || {}));
}));

router.patch('/roles/:id', asyncHandler(async (req, res) => {
	const { updateWorkspaceRole } = await import('../../services/workspace-members.js');
	res.json(await updateWorkspaceRole(req, req.params.id, req.body || {}));
}));

router.delete('/roles/:id', asyncHandler(async (req, res) => {
	const { deleteWorkspaceRole } = await import('../../services/workspace-members.js');
	res.json(await deleteWorkspaceRole(req, req.params.id));
}));

router.get('/activity', asyncHandler(async (req, res) => {
	const { listWorkspaceActivityTimeline } = await import('../../services/workspace-activity.js');
	res.json(await listWorkspaceActivityTimeline(req, req.query || {}));
}));

router.get('/audit', asyncHandler(async (req, res) => {
	const { listWorkspaceAudit } = await import('../../services/workspace-audit.js');
	res.json(await listWorkspaceAudit(req, req.query || {}));
}));

router.get('/health', asyncHandler(async (req, res) => {
	const { computeWorkspaceHealthDetailed } = await import('../../services/workspace-health.js');
	res.json(await computeWorkspaceHealthDetailed({
		workspace: req.workspace,
		subscription: req.workspaceSubscription,
		ownerId: req.workspaceOwnerId,
		req,
	}));
}));

router.get('/onboarding', asyncHandler(async (req, res) => {
	const { getWorkspaceOnboarding } = await import('../../services/workspace-onboarding.js');
	res.json(await getWorkspaceOnboarding(req));
}));

router.patch('/onboarding', asyncHandler(async (req, res) => {
	const { updateWorkspaceOnboarding } = await import('../../services/workspace-onboarding.js');
	res.json(await updateWorkspaceOnboarding(req, req.body || {}));
}));

router.post('/onboarding', asyncHandler(async (req, res) => {
	const { updateWorkspaceOnboarding } = await import('../../services/workspace-onboarding.js');
	res.json(await updateWorkspaceOnboarding(req, req.body || {}));
}));

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

router.post('/subscription/checkout', async (req, res) => {
	res.status(201).json(await startWorkspaceSubscriptionCheckout(req, req.body || {}));
});

router.post('/subscription/cancel', async (req, res) => {
	res.json(await cancelWorkspaceSubscription(req, req.body || {}));
});

router.get('/usage', async (req, res) => {
	res.json(await getWorkspaceUsage(req));
});

router.get('/credits', async (req, res) => {
	res.json(await getWorkspaceCredits(req));
});

router.get('/credits/packs', async (req, res) => {
	const data = await getWorkspaceSubscription(req);
	res.json(data.creditPacks || { items: [] });
});

router.post('/credits/packs/purchase', async (req, res) => {
	res.status(201).json(await purchaseWorkspaceCreditPack(req, req.body || {}));
});

router.get('/billing/history', async (req, res) => {
	res.json(await getWorkspaceBillingHistory(req, req.query));
});

router.get('/history', async (req, res) => {
	res.json(await getWorkspaceHistory(req, req.query));
});

router.get('/templates', asyncHandler(async (req, res) => {
	if (req.query.view === 'gallery' || req.query.gallery === '1') {
		return res.json(await listGalleryTemplates(req, req.query));
	}
	res.json(await listWorkspaceTemplates(req, req.query));
}));

router.post('/templates', async (req, res) => {
	const category = req.body?.category;
	if (category && category !== 'pin' && !['recipes', 'desserts', 'fitness', 'travel', 'finance', 'technology', 'diy', 'general'].includes(category)) {
		const created = await createCatalogTemplate(req, req.body || {});
		return res.status(201).json(created);
	}
	const created = await createPinTemplate(req, req.body || {});
	return res.status(201).json(created);
});

router.post('/templates/bulk', async (req, res) => {
	res.json(await bulkPinTemplateAction(req, req.body || {}));
});

router.get('/templates/export/profiles', async (req, res) => {
	res.json({
		profiles: listTemplateExportProfiles(),
		formats: listTemplateExportFormats(),
	});
});

router.post('/templates/export/plan', async (req, res) => {
	res.json(await planTemplateExport(req, req.body || {}));
});

router.post('/templates/export/enqueue', async (req, res) => {
	res.status(201).json(await enqueueTemplateExportJob(req, req.body || {}));
});

router.post('/templates/export/batch', async (req, res) => {
	res.json(await planTemplateExportBatch(req, req.body || {}));
});

router.post('/templates/import', async (req, res) => {
	res.status(201).json(await importTemplatePackage(req, req.body || {}));
});

router.get('/templates/preview-cache', async (req, res) => {
	res.json(await getTemplatePreviewFromCache(req, req.query));
});

router.post('/templates/preview-cache', async (req, res) => {
	res.status(201).json(await upsertTemplatePreviewCache(req, req.body || {}));
});

router.get('/templates/:id', async (req, res) => {
	res.json({ item: await getPinTemplate(req, req.params.id) });
});

router.get('/templates/:id/export', async (req, res) => {
	res.json(await exportPinTemplate(req, req.params.id));
});

router.post('/templates/:id/duplicate', async (req, res) => {
	res.status(201).json(await duplicatePinTemplate(req, req.params.id));
});

router.post('/templates/:id/favorite', async (req, res) => {
	res.json(await togglePinTemplateFavorite(req, req.params.id));
});

router.post('/templates/:id/touch', async (req, res) => {
	res.json(await touchPinTemplate(req, req.params.id));
});

router.post('/templates/:id/status', async (req, res) => {
	res.json(await setPinTemplateStatus(req, req.params.id, String(req.body?.status || '')));
});

router.patch('/templates/:id', async (req, res) => {
	if (req.body?.source === 'templates' || req.query.source === 'templates') {
		return res.json(await updateCatalogTemplate(req, req.params.id, req.body || {}));
	}
	if (req.body?.name != null && Object.keys(req.body).length === 1) {
		// rename-only from gallery
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

/** Unified Calendar Facade (C1). Channel-agnostic Scheduled Items. UI cutover is C2. */
router.get('/calendar/events', asyncHandler(async (req, res) => {
	res.json(await listUnifiedCalendarEvents(req, req.query));
}));

/** Unified Calendar Mutation Router (C5). Dispatches to owning channel adapters. */
router.post('/calendar/events/:eventId/reschedule', asyncHandler(async (req, res) => {
	res.json(await rescheduleCalendarScheduledItem(req, req.params.eventId, req.body || {}));
}));

router.post('/calendar/events/:eventId/cancel', asyncHandler(async (req, res) => {
	res.json(await cancelCalendarScheduledItem(req, req.params.eventId, req.body || {}));
}));

router.post('/calendar/events/:eventId/retry', asyncHandler(async (req, res) => {
	res.json(await retryCalendarScheduledItem(req, req.params.eventId, req.body || {}));
}));

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
