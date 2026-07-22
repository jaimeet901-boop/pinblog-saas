import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { formatClock, formatRelative } from './helpers.js';

export async function openOrRefreshIncident({
	incidentKey,
	title,
	type = 'Service interruptions',
	service = 'System',
	severity = 'warning',
	message = '',
	isAlert = true,
} = {}) {
	if (!incidentKey || !title) return null;
	const existing = await pocketbaseClient.collection('health_incidents').getFirstListItem(
		pocketbaseClient.filter('incident_key = {:key} && status != "resolved"', { key: incidentKey }),
		{ requestKey: null },
	).catch(() => null);

	const payload = {
		incident_key: incidentKey,
		title,
		type,
		service,
		severity,
		status: existing?.status === 'acknowledged' ? 'acknowledged' : 'open',
		message: message || title,
		is_alert: Boolean(isAlert),
		meta: { refreshedAt: new Date().toISOString() },
		started_at: existing?.started_at || new Date().toISOString(),
	};

	if (existing) {
		return pocketbaseClient.collection('health_incidents').update(existing.id, payload).catch(() => existing);
	}
	return pocketbaseClient.collection('health_incidents').create(payload).catch(() => null);
}

export async function resolveIncidentByKey(incidentKey) {
	if (!incidentKey) return null;
	const open = await pocketbaseClient.collection('health_incidents').getFullList({
		filter: pocketbaseClient.filter('incident_key = {:key} && status != "resolved"', { key: incidentKey }),
		requestKey: null,
	}).catch(() => []);
	const now = new Date().toISOString();
	for (const row of open) {
		await pocketbaseClient.collection('health_incidents').update(row.id, {
			status: 'resolved',
			resolved_at: now,
			meta: { ...(row.meta || {}), resolvedAt: now },
		}).catch(() => null);
	}
	return open.length;
}

export async function acknowledgeAlert(id) {
	const row = await pocketbaseClient.collection('health_incidents').getOne(id);
	return pocketbaseClient.collection('health_incidents').update(id, {
		status: 'acknowledged',
		acknowledged_at: new Date().toISOString(),
		is_alert: true,
		meta: { ...(row.meta || {}), acknowledgedAt: new Date().toISOString() },
	});
}

export async function resolveAlert(id) {
	const row = await pocketbaseClient.collection('health_incidents').getOne(id);
	return pocketbaseClient.collection('health_incidents').update(id, {
		status: 'resolved',
		resolved_at: new Date().toISOString(),
		meta: { ...(row.meta || {}), resolvedAt: new Date().toISOString() },
	});
}

export async function listActiveAlerts(limit = 20) {
	const rows = await pocketbaseClient.collection('health_incidents').getList(1, limit, {
		filter: 'is_alert = true && status != "resolved"',
		sort: '-started_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return (rows.items || []).map((row) => ({
		id: row.id,
		severity: row.severity || 'warning',
		service: row.service || 'System',
		message: row.message || row.title,
		started: row.started_at ? formatClock(row.started_at) : formatClock(row.created),
		status: row.status || 'open',
	}));
}

export async function listIncidentHistory(limit = 20) {
	const rows = await pocketbaseClient.collection('health_incidents').getList(1, limit, {
		sort: '-started_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return (rows.items || []).map((row) => ({
		id: row.id,
		text: row.title || row.message,
		type: row.type || 'Service interruptions',
		time: formatRelative(row.started_at || row.created),
		severity: row.severity,
		status: row.status,
		service: row.service,
	}));
}

export async function listIncidents(query = {}) {
	const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
	const perPage = Math.min(100, Math.max(1, Number.parseInt(query.perPage, 10) || 50));
	const parts = [];
	if (query.status) parts.push(pocketbaseClient.filter('status = {:status}', { status: query.status }));
	if (query.severity) parts.push(pocketbaseClient.filter('severity = {:severity}', { severity: query.severity }));
	const result = await pocketbaseClient.collection('health_incidents').getList(page, perPage, {
		filter: parts.length ? parts.join(' && ') : undefined,
		sort: '-started_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));
	return {
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		items: (result.items || []).map((row) => ({
			id: row.id,
			title: row.title,
			text: row.title,
			type: row.type,
			service: row.service,
			severity: row.severity,
			status: row.status,
			message: row.message,
			isAlert: Boolean(row.is_alert),
			startedAt: row.started_at || row.created,
			acknowledgedAt: row.acknowledged_at || null,
			resolvedAt: row.resolved_at || null,
			time: formatRelative(row.started_at || row.created),
		})),
	};
}
