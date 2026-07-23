import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import { writeAuditLog } from '../audit/write.js';
import { formatRelative, normalizePage, safeList } from './helpers.js';

function mapTemplate(row) {
	const channel = String(row.channel || 'email').replace('_', '-');
	return {
		id: row.id,
		title: row.title,
		body: row.body || '',
		channel: channel === 'in_app' ? 'in-app' : channel,
		status: row.status || 'draft',
		scheduledAt: row.scheduled_at || null,
		kind: 'template',
		created: row.created,
		updated: row.updated,
	};
}

function mapHistory(row) {
	const channel = String(row.channel || 'email').replace('_', '-');
	return {
		id: row.id,
		title: row.title,
		body: row.body || '',
		channel: channel === 'in_app' ? 'in-app' : channel,
		status: row.status || 'sent',
		kind: 'history',
		audience: row.audience || 'platform',
		sentAt: row.sent_at || row.created,
		time: formatRelative(row.sent_at || row.created),
		created: row.created,
		updated: row.updated,
	};
}

export async function listNotificationTemplates(query = {}) {
	const { page, perPage } = normalizePage(query, 50);
	const result = await safeList('notification_templates', page, perPage, {
		sort: '-updated,-created',
	});

	return {
		items: (result.items || []).map(mapTemplate),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		source: 'notification_templates',
	};
}

export async function listNotificationHistory(query = {}) {
	const { page, perPage } = normalizePage(query, 50);
	const result = await safeList('notification_history', page, perPage, {
		sort: '-sent_at,-created',
	});
	return {
		items: (result.items || []).map(mapHistory),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		source: 'notification_history',
	};
}

export async function listNotificationsOverview(query = {}) {
	const [templates, history] = await Promise.all([
		listNotificationTemplates(query),
		listNotificationHistory({ page: 1, perPage: 20 }),
	]);

	const items = [
		...templates.items,
		...history.items,
	];

	return {
		items,
		templates: templates.items,
		history: history.items,
		totalItems: items.length,
		source: 'pocketbase',
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

	await pocketbaseClient.collection('notification_history').create({
		title,
		body: String(payload.body || '').slice(0, 4000),
		channel: String(payload.channel || 'email').replace('in-app', 'in_app'),
		status: 'draft',
		audience: 'template',
		template_id: created.id,
		sent_at: new Date().toISOString(),
		meta: { event: 'template_created' },
	}).catch(() => null);

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
