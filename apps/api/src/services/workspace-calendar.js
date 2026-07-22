import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import { assertSameWorkspace } from './workspace-context.js';

function mapEvent(record) {
	return {
		id: record.id,
		title: record.title,
		description: record.description || '',
		eventType: record.event_type || 'schedule',
		status: record.status || 'scheduled',
		scheduledAt: record.scheduled_at,
		timezone: record.timezone || 'UTC',
		refType: record.ref_type || '',
		refId: record.ref_id || '',
		meta: record.meta || {},
		created: record.created,
		updated: record.updated,
	};
}

export async function listCalendarEvents(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const month = String(query.month || '').trim();
	const filter = pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id });
	const records = await pocketbaseClient.collection('calendar_events').getFullList({
		filter,
		sort: 'scheduled_at',
		requestKey: null,
	}).catch(() => []);

	let items = records.map(mapEvent);
	if (month) {
		items = items.filter((item) => String(item.scheduledAt || '').startsWith(month));
	}

	// Also surface owned Pinterest publish jobs as calendar entries (read-only merge).
	let publishJobs = [];
	try {
		publishJobs = await pocketbaseClient.collection('pinterest_publish_jobs').getFullList({
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: req.pocketbaseUserId }),
			sort: 'scheduled_at',
			requestKey: null,
		});
	} catch {
		publishJobs = [];
	}

	const fromJobs = publishJobs
		.filter((job) => job.scheduled_at)
		.filter((job) => !month || String(job.scheduled_at).startsWith(month))
		.map((job) => ({
			id: job.id,
			title: job.title || 'Pinterest publish',
			description: job.publish_error || '',
			eventType: 'publish',
			status: job.status || 'scheduled',
			scheduledAt: job.scheduled_at,
			timezone: job.scheduled_timezone || 'UTC',
			refType: 'pinterest_publish_jobs',
			refId: job.id,
			meta: { source: 'pinterest' },
			created: job.created,
			updated: job.updated,
			readOnly: true,
		}));

	return {
		items: [...items, ...fromJobs].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
		month: month || null,
	};
}

export async function createCalendarEvent(req, payload = {}) {
	assertCapability(req, 'workspace.calendar.manage');
	const title = String(payload.title || '').trim();
	const scheduledAt = payload.scheduledAt || payload.scheduled_at;
	if (!title) throw httpError(422, 'title is required', 'VALIDATION_ERROR');
	if (!scheduledAt) throw httpError(422, 'scheduledAt is required', 'VALIDATION_ERROR');

	const created = await pocketbaseClient.collection('calendar_events').create({
		workspace: req.workspace.id,
		owner: req.pocketbaseUserId,
		title,
		description: String(payload.description || '').slice(0, 2000),
		event_type: payload.eventType || payload.event_type || 'schedule',
		status: payload.status || 'scheduled',
		scheduled_at: scheduledAt,
		timezone: payload.timezone || 'UTC',
		ref_type: payload.refType || '',
		ref_id: payload.refId || '',
		meta: payload.meta || {},
	});
	return mapEvent(created);
}

async function loadEvent(req, id) {
	const record = await pocketbaseClient.collection('calendar_events').getOne(id).catch(() => null);
	if (!record) throw httpError(404, 'Calendar event not found', 'NOT_FOUND');
	assertSameWorkspace(record.workspace, req.workspace.id);
	return record;
}

export async function updateCalendarEvent(req, id, payload = {}) {
	assertCapability(req, 'workspace.calendar.manage');
	const existing = await loadEvent(req, id);
	const updates = {};
	if (payload.title != null) updates.title = String(payload.title).trim();
	if (payload.description != null) updates.description = String(payload.description).slice(0, 2000);
	if (payload.eventType != null || payload.event_type != null) {
		updates.event_type = payload.eventType || payload.event_type;
	}
	if (payload.status != null) updates.status = payload.status;
	if (payload.scheduledAt != null || payload.scheduled_at != null) {
		updates.scheduled_at = payload.scheduledAt || payload.scheduled_at;
	}
	if (payload.timezone != null) updates.timezone = payload.timezone;
	if (payload.meta != null) updates.meta = payload.meta;

	const updated = await pocketbaseClient.collection('calendar_events').update(existing.id, updates);
	return mapEvent(updated);
}

export async function rescheduleCalendarEvent(req, id, payload = {}) {
	const scheduledAt = payload.scheduledAt || payload.scheduled_at;
	if (!scheduledAt) throw httpError(422, 'scheduledAt is required', 'VALIDATION_ERROR');
	return updateCalendarEvent(req, id, {
		scheduledAt,
		timezone: payload.timezone,
		status: 'scheduled',
	});
}

export async function deleteCalendarEvent(req, id) {
	assertCapability(req, 'workspace.calendar.manage');
	const existing = await loadEvent(req, id);
	await pocketbaseClient.collection('calendar_events').delete(existing.id);
	return { ok: true, id };
}
