import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import { getSubscriptionPlan } from './workspace-context.js';

const DEFAULT_PREFS = {
	workspaceName: '',
	workspaceLogo: '',
	workspaceDescription: '',
	defaultWebsiteId: '',
	defaultLanguage: 'English',
	timezone: 'UTC',
	language: 'English',
	emailNotifications: true,
	publishingNotifications: true,
	failureAlerts: true,
	weeklyReports: false,
	marketingEmails: false,
	accentColor: 'coral',
	dateFormat: 'locale',
	timeFormat: '24h',
};

function mergePrefs(stored = {}) {
	return { ...DEFAULT_PREFS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

export async function getWorkspaceSettings(req) {
	assertCapability(req, 'workspace.read');
	const prefs = mergePrefs(req.workspaceSettings?.prefs);
	if (!prefs.workspaceName) {
		prefs.workspaceName = req.workspace?.name || '';
	}
	return {
		workspace: {
			id: req.workspace.id,
			name: req.workspace.name,
			slug: req.workspace.slug,
			status: req.workspace.status,
			planSlug: req.workspace.plan_slug,
		},
		prefs,
		notificationPrefs: req.workspaceSettings?.notification_prefs || {},
		defaults: req.workspaceSettings?.defaults || {},
		role: req.workspaceRole,
	};
}

export async function updateWorkspaceSettings(req, payload = {}) {
	assertCapability(req, 'workspace.settings.manage');
	const nextPrefs = mergePrefs({
		...(req.workspaceSettings?.prefs || {}),
		...(payload.prefs && typeof payload.prefs === 'object' ? payload.prefs : {}),
	});

	if (payload.workspaceName != null) nextPrefs.workspaceName = String(payload.workspaceName).trim();
	if (payload.workspaceLogo != null) nextPrefs.workspaceLogo = String(payload.workspaceLogo).trim();
	if (payload.workspaceDescription != null) nextPrefs.workspaceDescription = String(payload.workspaceDescription).trim();

	const notificationPrefs = {
		...(req.workspaceSettings?.notification_prefs || {}),
		...(payload.notificationPrefs && typeof payload.notificationPrefs === 'object' ? payload.notificationPrefs : {}),
	};

	const defaults = {
		...(req.workspaceSettings?.defaults || {}),
		...(payload.defaults && typeof payload.defaults === 'object' ? payload.defaults : {}),
	};

	const settingsId = req.workspaceSettings?.id;
	if (!settingsId) {
		throw httpError(500, 'Workspace settings missing', 'SETTINGS_MISSING');
	}

	const updated = await pocketbaseClient.collection('workspace_settings').update(settingsId, {
		prefs: nextPrefs,
		notification_prefs: notificationPrefs,
		defaults,
	});

	if (nextPrefs.workspaceName && nextPrefs.workspaceName !== req.workspace.name) {
		await pocketbaseClient.collection('workspaces').update(req.workspace.id, {
			name: nextPrefs.workspaceName.slice(0, 200),
		});
		req.workspace.name = nextPrefs.workspaceName.slice(0, 200);
	}

	req.workspaceSettings = updated;
	return getWorkspaceSettings(req);
}

export async function getWorkspaceProfile(req) {
	assertCapability(req, 'workspace.read');
	const user = req.workspaceUser;
	const plan = await getSubscriptionPlan(req.workspaceSubscription);
	return {
		id: user.id,
		name: user.name || '',
		email: user.email || '',
		verified: Boolean(user.verified),
		plan: plan?.slug || user.plan || 'free',
		planName: plan?.name || user.plan || 'Free',
		role: req.workspaceRole,
		workspaceId: req.workspace.id,
		workspaceName: req.workspace.name,
		created: user.created,
		updated: user.updated,
	};
}

export async function updateWorkspaceProfile(req, payload = {}) {
	// Profile is self-service; any member can update their own name.
	const name = String(payload.name || '').trim();
	if (!name) {
		throw httpError(422, 'name is required', 'VALIDATION_ERROR');
	}
	if (name.length > 120) {
		throw httpError(422, 'name must be 120 characters or less', 'VALIDATION_ERROR');
	}
	const updated = await pocketbaseClient.collection('users').update(req.pocketbaseUserId, { name });
	req.workspaceUser = updated;
	return getWorkspaceProfile(req);
}
