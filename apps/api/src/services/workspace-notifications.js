import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import { assertSameWorkspace } from './workspace-context.js';

function mapNotification(record) {
	return {
		id: record.id,
		title: record.title,
		body: record.body || '',
		priority: record.priority || 'normal',
		channel: record.channel || 'in_app',
		readAt: record.read_at || null,
		dismissedAt: record.dismissed_at || null,
		unread: !record.read_at,
		meta: record.meta || {},
		created: record.created,
		updated: record.updated,
	};
}

export async function listWorkspaceNotifications(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const unreadOnly = String(query.unread || '') === 'true';

	const filter = pocketbaseClient.filter(
		'workspace = {:ws} && (user = "" || user = {:user})',
		{ ws: req.workspace.id, user: req.pocketbaseUserId },
	);

	const result = await pocketbaseClient.collection('workspace_notifications').getList(page, perPage, {
		filter,
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], page: 1, perPage, totalItems: 0, totalPages: 0 }));

	let items = result.items
		.filter((item) => !item.dismissed_at)
		.map(mapNotification);

	if (unreadOnly) {
		items = items.filter((item) => item.unread);
	}

	return {
		items,
		page: result.page,
		perPage: result.perPage,
		totalItems: items.length,
		totalPages: Math.max(1, Math.ceil(items.length / perPage)),
	};
}

export async function createWorkspaceNotification(req, payload = {}) {
	assertCapability(req, 'workspace.notifications.manage');
	const title = String(payload.title || '').trim();
	if (!title) throw httpError(422, 'title is required', 'VALIDATION_ERROR');

	const created = await pocketbaseClient.collection('workspace_notifications').create({
		workspace: req.workspace.id,
		user: payload.userId || req.pocketbaseUserId,
		title,
		body: String(payload.body || '').slice(0, 2000),
		priority: payload.priority || 'normal',
		channel: payload.channel || 'in_app',
		meta: payload.meta || {},
	});
	return mapNotification(created);
}

async function loadOwnedNotification(req, id) {
	const record = await pocketbaseClient.collection('workspace_notifications').getOne(id).catch(() => null);
	if (!record) throw httpError(404, 'Notification not found', 'NOT_FOUND');
	assertSameWorkspace(record.workspace, req.workspace.id);
	if (record.user && record.user !== req.pocketbaseUserId) {
		throw httpError(403, 'Cannot access another user notification', 'FORBIDDEN');
	}
	return record;
}

export async function markNotificationRead(req, id) {
	assertCapability(req, 'workspace.read');
	const existing = await loadOwnedNotification(req, id);
	const updated = await pocketbaseClient.collection('workspace_notifications').update(existing.id, {
		read_at: new Date().toISOString(),
	});
	return mapNotification(updated);
}

export async function dismissNotification(req, id) {
	assertCapability(req, 'workspace.read');
	const existing = await loadOwnedNotification(req, id);
	const updated = await pocketbaseClient.collection('workspace_notifications').update(existing.id, {
		dismissed_at: new Date().toISOString(),
		read_at: existing.read_at || new Date().toISOString(),
	});
	return mapNotification(updated);
}

export async function markAllNotificationsRead(req) {
	assertCapability(req, 'workspace.read');
	const items = await pocketbaseClient.collection('workspace_notifications').getFullList({
		filter: pocketbaseClient.filter(
			'workspace = {:ws} && (user = "" || user = {:user})',
			{ ws: req.workspace.id, user: req.pocketbaseUserId },
		),
		requestKey: null,
	}).catch(() => []);

	const now = new Date().toISOString();
	const unread = items.filter((item) => !item.dismissed_at && !item.read_at);
	await Promise.all(unread.map((item) => (
		pocketbaseClient.collection('workspace_notifications').update(item.id, { read_at: now })
	)));

	return { ok: true, updated: unread.length };
}
