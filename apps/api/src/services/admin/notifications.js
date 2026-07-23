import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import { writeAuditLog } from '../audit/write.js';
import { normalizePage, safeList } from './helpers.js';

function mapTemplate(row) {
	const channel = String(row.channel || 'email').replace('_', '-');
	return {
		id: row.id,
		title: row.title,
		body: row.body || '',
		channel: channel === 'in_app' ? 'in-app' : channel,
		status: row.status || 'draft',
		scheduledAt: row.scheduled_at || null,
		created: row.created,
		updated: row.updated,
	};
}

export async function listNotificationTemplates(query = {}) {
	const { page, perPage } = normalizePage(query, 50);
	const result = await safeList('notification_templates', page, perPage, {
		sort: '-updated,-created',
	});

	if ((result.items || []).length === 0 && (result.totalItems || 0) === 0) {
		// Fallback: surface recent workspace notifications as read-only templates.
		const live = await safeList('workspace_notifications', 1, 20, { sort: '-created' });
		const items = (live.items || []).map((row) => ({
			id: row.id,
			title: row.title,
			body: row.body || '',
			channel: String(row.channel || 'in_app').replace('_', '-') === 'in-app' ? 'in-app' : (row.channel || 'email'),
			status: row.read_at ? 'active' : 'draft',
		}));
		return { items, page: 1, perPage: items.length || 20, totalItems: items.length, totalPages: 1, source: 'workspace_notifications' };
	}

	return {
		items: (result.items || []).map(mapTemplate),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		source: 'notification_templates',
	};
}

export async function createNotificationTemplate(payload = {}, actor = {}) {
	const title = String(payload.title || '').trim();
	if (!title) throw httpError(422, 'title is required', 'VALIDATION_ERROR');
	const created = await pocketbaseClient.collection('notification_templates').create({
		title,
		body: String(payload.body || '').slice(0, 4000),
		channel: String(payload.channel || 'email').replace('in-app', 'in_app'),
		status: payload.status || 'draft',
		scheduled_at: payload.scheduledAt || undefined,
		meta: payload.meta || {},
	});
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'System',
		action: `Created notification template ${title}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'notification_template',
		resourceId: created.id,
		result: 'ok',
	});
	return mapTemplate(created);
}
