/**
 * Workspace calendar_events CRUD (manual / planned overlay only).
 *
 * C10 architecture lock (docs/calendar-architecture.md):
 * - Channel jobs remain the sole write SoT for scheduled publishing.
 * - Dual-write of channel job schedules into calendar_events is frozen.
 * - Legacy GET /workspace/v1/calendar returns calendar_events only (no PPJ merge).
 * - Product Calendar reads the Unified Facade; this module must not grow
 *   Pinterest/WordPress/Facebook business logic.
 */
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import {
	assertCalendarEventsNotChannelJobMirror,
	isOrphanChannelJobMirrorEvent,
} from './calendar/calendar-architecture.js';
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

/**
 * Legacy CE list for manual / planned events only.
 * Does not merge channel publish jobs (C10 — publish SoT is channel job tables).
 */
export async function listCalendarEvents(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const month = String(query.month || '').trim();
	const filter = pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id });
	const records = await pocketbaseClient.collection('calendar_events').getFullList({
		filter,
		sort: 'scheduled_at',
		requestKey: null,
	}).catch(() => []);

	let items = records
		.map(mapEvent)
		.filter((item) => !isOrphanChannelJobMirrorEvent(item));
	if (month) {
		items = items.filter((item) => String(item.scheduledAt || '').startsWith(month));
	}

	return {
		items: items.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
		month: month || null,
		meta: {
			source: 'calendar_events',
			channelJobMerge: false,
			phase: 'C10',
		},
	};
}

export async function createCalendarEvent(req, payload = {}) {
	assertCapability(req, 'workspace.calendar.manage');
	const title = String(payload.title || '').trim();
	const scheduledAt = payload.scheduledAt || payload.scheduled_at;
	if (!title) throw httpError(422, 'title is required', 'VALIDATION_ERROR');
	if (!scheduledAt) throw httpError(422, 'scheduledAt is required', 'VALIDATION_ERROR');
	assertCalendarEventsNotChannelJobMirror(payload, { operation: 'create' });

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
	assertCalendarEventsNotChannelJobMirror(payload, { operation: 'update' });

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
	// ref_type / ref_id not accepted on update (C0: prevent attaching channel job mirrors).

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
