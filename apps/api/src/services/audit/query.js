import pocketbaseClient from '../../utils/pocketbaseClient.js';
import {
	formatDateTime,
	formatRelative,
	mapAuditEvent,
	resolveUiCategory,
	resolveUiSeverity,
} from './write.js';

function startOfTodayIso() {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.toISOString();
}

function normalizePositiveInt(value, fallback, max = 100) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(max, n);
}

function categoryCodeFromLabel(label) {
	const value = String(label || '').trim();
	const map = {
		Authentication: 'auth',
		Users: 'admin',
		Workspaces: 'admin',
		'AI Requests': 'ai',
		'Image Generation': 'ai',
		WordPress: 'publishing',
		Pinterest: 'publishing',
		Publishing: 'publishing',
		Subscriptions: 'billing',
		Payments: 'billing',
		'Queue Jobs': 'queue',
		Providers: 'admin',
		API: 'api',
		Security: 'security',
		System: 'system',
	};
	return map[value] || value.toLowerCase();
}

function severityCodeFromLabel(label) {
	const value = String(label || '').trim().toLowerCase();
	if (value === 'warning') return 'warn';
	if (value === 'success') return 'success';
	if (value === 'info') return 'info';
	if (value === 'error') return 'error';
	if (value === 'critical') return 'critical';
	return value;
}

export async function buildLogsFilter(query = {}, { ownerId = null } = {}) {
	const parts = [];
	if (ownerId) {
		parts.push(pocketbaseClient.filter('actor_user = {:owner}', { owner: ownerId }));
	}
	if (query.date === 'today' || query.dateRange === 'today') {
		parts.push(pocketbaseClient.filter('occurred_at >= {:start}', { start: startOfTodayIso() }));
	}
	if (query.type || query.category || query.logType) {
		const raw = query.type || query.category || query.logType;
		const code = categoryCodeFromLabel(raw);
		parts.push(`(category = "${code}" || ui_category = "${String(raw).replace(/"/g, '')}")`);
	}
	if (query.severity) {
		const code = severityCodeFromLabel(query.severity);
		parts.push(`(severity = "${code}" || ui_severity = "${String(query.severity).replace(/"/g, '')}")`);
	}
	if (query.workspace) {
		parts.push(pocketbaseClient.filter('(workspace_label ~ {:ws} || workspace_key ~ {:ws})', { ws: query.workspace }));
	}
	if (query.user) {
		parts.push(pocketbaseClient.filter('actor_label ~ {:user}', { user: query.user }));
	}
	if (query.service) {
		parts.push(pocketbaseClient.filter('service ~ {:service}', { service: query.service }));
	}
	if (query.provider) {
		parts.push(pocketbaseClient.filter('provider ~ {:provider}', { provider: query.provider }));
	}
	if (query.q || query.search) {
		const q = String(query.q || query.search).trim();
		if (q) {
			parts.push(pocketbaseClient.filter(
				'(action ~ {:q} || message ~ {:q} || correlation_id ~ {:q} || actor_label ~ {:q} || workspace_label ~ {:q} || ip ~ {:q} || id ~ {:q})',
				{ q },
			));
		}
	}
	return parts.length ? parts.join(' && ') : '';
}

export async function listAuditLogs(query = {}, options = {}) {
	const page = normalizePositiveInt(query.page, 1);
	const perPage = normalizePositiveInt(query.perPage, 20, 100);
	const filter = await buildLogsFilter(query, options);
	const result = await pocketbaseClient.collection('audit_logs').getList(page, perPage, {
		filter: filter || undefined,
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));

	return {
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		items: (result.items || []).map(mapAuditEvent),
	};
}

export async function getAuditLog(id) {
	const row = await pocketbaseClient.collection('audit_logs').getOne(id).catch(() => null);
	return row ? mapAuditEvent(row) : null;
}

export async function getLogsSummary() {
	const today = startOfTodayIso();
	const [totalToday, warnings, errors, critical, security, adminActions] = await Promise.all([
		countFilter(pocketbaseClient.filter('occurred_at >= {:start}', { start: today })),
		countFilter(pocketbaseClient.filter('occurred_at >= {:start} && (severity = "warn" || ui_severity = "Warning")', { start: today })),
		countFilter(pocketbaseClient.filter('occurred_at >= {:start} && (severity = "error" || ui_severity = "Error")', { start: today })),
		countFilter(pocketbaseClient.filter('occurred_at >= {:start} && (severity = "critical" || ui_severity = "Critical")', { start: today })),
		countFilter(pocketbaseClient.filter('occurred_at >= {:start} && category = "security"', { start: today })),
		countFilter(pocketbaseClient.filter('occurred_at >= {:start} && category = "admin"', { start: today })),
	]);
	return { totalToday, warnings, errors, critical, security, adminActions };
}

async function countFilter(filter) {
	const result = await pocketbaseClient.collection('audit_logs').getList(1, 1, {
		filter,
		requestKey: null,
	}).catch(() => ({ totalItems: 0 }));
	return Number(result.totalItems) || 0;
}

export async function listSecurityFeed(limit = 20) {
	const rows = await pocketbaseClient.collection('security_events').getList(1, limit, {
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return (rows.items || []).map((row) => ({
		id: row.id,
		title: row.title,
		detail: row.detail || '',
		time: formatRelative(row.occurred_at || row.created),
		eventType: row.event_type,
		severity: row.severity,
	}));
}

export async function listAdminActivity(limit = 20) {
	const rows = await pocketbaseClient.collection('audit_logs').getList(1, limit, {
		filter: 'category = "admin" || category = "settings" || category = "billing"',
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return (rows.items || []).map((row) => ({
		id: row.id,
		text: `${row.action}${row.actor_label ? ` · ${row.actor_label}` : ''}`,
		time: formatRelative(row.occurred_at || row.created),
	}));
}

export async function listSystemLogLines(limit = 40) {
	const rows = await pocketbaseClient.collection('system_logs').getList(1, limit, {
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return (rows.items || []).map((row) => {
		const stamp = formatDateTime(row.occurred_at || row.created).split(' ')[1] || '';
		return `[${stamp}] ${row.source || 'api'}.${row.level} ${row.message}`;
	});
}

export async function getLogsMonitorPayload(query = {}) {
	const [summary, list, securityEvents, adminActivity, systemLogs] = await Promise.all([
		getLogsSummary(),
		listAuditLogs({ ...query, perPage: query.perPage || 100, page: query.page || 1 }),
		listSecurityFeed(12),
		listAdminActivity(12),
		listSystemLogLines(30),
	]);

	const events = list.items;
	return {
		summary,
		events,
		securityEvents,
		adminActivity,
		systemLogs,
		page: list.page,
		perPage: list.perPage,
		totalItems: list.totalItems,
		totalPages: list.totalPages,
		filters: {
			workspaces: [...new Set(events.map((e) => e.workspace).filter((v) => v && v !== '—'))].sort(),
			users: [...new Set(events.map((e) => e.user).filter((v) => v && v !== 'unknown' && v !== 'system'))].sort(),
			services: [...new Set(events.map((e) => e.service).filter(Boolean))].sort(),
			providers: [...new Set(events.map((e) => e.provider).filter((v) => v && v !== '—'))].sort(),
		},
		meta: {
			computedAt: new Date().toISOString(),
		},
	};
}

export async function exportLogs(query = {}, format = 'json') {
	const list = await listAuditLogs({ ...query, page: 1, perPage: 500 });
	if (format === 'csv') {
		const headers = ['id', 'timestamp', 'category', 'severity', 'user', 'workspace', 'service', 'action', 'result', 'ip', 'duration', 'provider', 'model', 'credits', 'correlationId'];
		const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
		const lines = [headers.join(',')];
		for (const event of list.items) {
			lines.push(headers.map((key) => escape(event[key])).join(','));
		}
		return {
			contentType: 'text/csv;charset=utf-8',
			body: `${lines.join('\n')}\n`,
			filename: 'audit-logs.csv',
		};
	}
	return {
		contentType: 'application/json',
		body: JSON.stringify({ summary: await getLogsSummary(), items: list.items }, null, 2),
		filename: 'audit-logs.json',
	};
}
