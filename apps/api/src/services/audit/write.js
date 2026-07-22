import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../../utils/pocketbaseClient.js';

const SECRET_KEYS = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|refresh|ciphertext|app[_-]?password/i;

export const CATEGORY_LABELS = {
	auth: 'Authentication',
	admin: 'Users',
	billing: 'Subscriptions',
	ai: 'AI Requests',
	publishing: 'Publishing',
	security: 'Security',
	system: 'System',
	queue: 'Queue Jobs',
	api: 'API',
	settings: 'System',
	wordpress: 'WordPress',
	pinterest: 'Pinterest',
	image: 'Image Generation',
	workspace: 'Workspaces',
	payments: 'Payments',
	providers: 'Providers',
};

export const SEVERITY_LABELS = {
	debug: 'Info',
	info: 'Info',
	success: 'Success',
	warn: 'Warning',
	error: 'Error',
	critical: 'Critical',
};

export function redactSecrets(value, depth = 0) {
	if (depth > 6) return '[truncated]';
	if (value == null) return value;
	if (typeof value === 'string') {
		if (value.length > 4000) return `${value.slice(0, 4000)}…`;
		return value;
	}
	if (Array.isArray(value)) {
		return value.slice(0, 50).map((item) => redactSecrets(item, depth + 1));
	}
	if (typeof value === 'object') {
		const out = {};
		for (const [key, item] of Object.entries(value)) {
			if (SECRET_KEYS.test(key)) {
				out[key] = '[redacted]';
			} else {
				out[key] = redactSecrets(item, depth + 1);
			}
		}
		return out;
	}
	return value;
}

export function formatDateTime(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDuration(ms) {
	const value = Number(ms);
	if (!Number.isFinite(value) || value <= 0) return '—';
	if (value < 1000) return `${Math.round(value)}ms`;
	if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)}s`;
	return `${Math.round(value / 60_000)}m`;
}

export function formatRelative(value) {
	if (!value) return '—';
	const ms = Date.now() - new Date(value).getTime();
	if (!Number.isFinite(ms) || ms < 0) return 'just now';
	if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
	return `${Math.round(ms / 86_400_000)}d ago`;
}

export function correlationId() {
	return `corr_${randomBytes(5).toString('hex')}`;
}

export function resolveUiCategory(category, uiCategory) {
	if (uiCategory) return uiCategory;
	return CATEGORY_LABELS[category] || category || 'System';
}

export function resolveUiSeverity(severity, result) {
	if (severity === 'success' || result === 'ok' || result === 'success') {
		if (severity === 'warn') return 'Warning';
		if (severity === 'error') return 'Error';
		if (severity === 'critical') return 'Critical';
		return 'Success';
	}
	return SEVERITY_LABELS[severity] || 'Info';
}

export function mapAuditEvent(row) {
	const occurred = row.occurred_at || row.created;
	const severity = resolveUiSeverity(row.severity, row.result);
	const category = resolveUiCategory(row.category, row.ui_category);
	const result = row.result === 'success' ? 'ok' : (row.result || 'ok');
	return {
		id: row.id,
		timestamp: formatDateTime(occurred),
		at: occurred,
		category,
		severity,
		message: row.message || row.action || '',
		user: row.actor_label || (row.actor_user ? row.actor_user : 'system'),
		workspace: row.workspace_label || row.workspace_key || '—',
		service: row.service || 'API',
		action: row.action || row.message || 'Event',
		result,
		ip: row.ip || '—',
		duration: formatDuration(row.duration_ms),
		durationMs: Number(row.duration_ms) || 0,
		provider: row.provider || '—',
		model: row.model || '—',
		credits: Number(row.credits) || 0,
		correlationId: row.correlation_id || '',
		request: row.request || {},
		response: row.response || {},
		headers: row.headers || {},
		metadata: row.metadata || {},
		timeline: Array.isArray(row.timeline) ? row.timeline : [],
		categoryCode: row.category,
		severityCode: row.severity,
		actorUserId: row.actor_user || null,
		workspaceKey: row.workspace_key || '',
	};
}

export async function writeAuditLog(input = {}) {
	const now = new Date().toISOString();
	const category = String(input.category || 'system');
	const severity = String(input.severity || 'info');
	const payload = {
		category,
		ui_category: input.uiCategory || resolveUiCategory(category, input.uiCategory),
		severity: severity === 'warning' ? 'warn' : severity,
		ui_severity: input.uiSeverity || resolveUiSeverity(severity, input.result),
		actor_user: input.actorUserId || undefined,
		actor_label: input.actorLabel || (input.actorUserId ? '' : 'system'),
		workspace: input.workspaceId || undefined,
		workspace_key: input.workspaceKey || '',
		workspace_label: input.workspaceLabel || '',
		service: input.service || 'API',
		action: String(input.action || input.message || 'Event').slice(0, 500),
		message: String(input.message || input.action || '').slice(0, 2000),
		result: input.result || 'ok',
		resource_type: input.resourceType || '',
		resource_id: input.resourceId || '',
		ip: input.ip || '',
		user_agent: String(input.userAgent || '').slice(0, 500),
		provider: input.provider || '',
		model: input.model || '',
		credits: Number(input.credits) || 0,
		duration_ms: Number(input.durationMs) || 0,
		correlation_id: input.correlationId || correlationId(),
		request: redactSecrets(input.request || {}),
		response: redactSecrets(input.response || {}),
		headers: redactSecrets(input.headers || {}),
		metadata: redactSecrets(input.metadata || {}),
		timeline: Array.isArray(input.timeline) ? input.timeline : [{ text: input.action || 'Event recorded', time: formatDateTime(now).split(' ')[1] }],
		occurred_at: input.occurredAt || now,
	};

	return pocketbaseClient.collection('audit_logs').create(payload).catch(() => null);
}

export async function writeSystemLog({ level = 'info', source = 'api', message, meta = {} } = {}) {
	if (!message) return null;
	return pocketbaseClient.collection('system_logs').create({
		level: level === 'warning' ? 'warn' : level,
		source: String(source).slice(0, 120),
		message: String(message).slice(0, 4000),
		meta: redactSecrets(meta),
		occurred_at: new Date().toISOString(),
	}).catch(() => null);
}

export async function writeSecurityEvent({
	eventType,
	title,
	detail = '',
	actorUserId,
	actorLabel = '',
	ip = '',
	severity = 'warn',
	meta = {},
} = {}) {
	if (!eventType || !title) return null;
	const row = await pocketbaseClient.collection('security_events').create({
		event_type: String(eventType).slice(0, 80),
		title: String(title).slice(0, 200),
		detail: String(detail).slice(0, 2000),
		actor_user: actorUserId || undefined,
		actor_label: actorLabel,
		ip,
		severity: severity === 'warning' ? 'warn' : severity,
		meta: redactSecrets(meta),
		occurred_at: new Date().toISOString(),
	}).catch(() => null);

	await writeAuditLog({
		category: 'security',
		uiCategory: 'Security',
		severity,
		action: title,
		message: detail || title,
		actorUserId,
		actorLabel: actorLabel || 'system',
		ip,
		result: eventType.includes('denied') || eventType.includes('failed') ? 'denied' : 'ok',
		metadata: { eventType, ...meta },
		service: 'Security',
	});

	return row;
}

export async function writeApiRequest(input = {}) {
	return pocketbaseClient.collection('api_requests').create({
		actor_user: input.actorUserId || undefined,
		method: input.method || 'GET',
		path: String(input.path || '').slice(0, 500),
		status: Number(input.status) || 0,
		duration_ms: Number(input.durationMs) || 0,
		ip: input.ip || '',
		user_agent: String(input.userAgent || '').slice(0, 500),
		correlation_id: input.correlationId || '',
		meta: redactSecrets(input.meta || {}),
		occurred_at: new Date().toISOString(),
	}).catch(() => null);
}

export async function writeLoginHistory(input = {}) {
	return pocketbaseClient.collection('login_history').create({
		user: input.userId || undefined,
		email: input.email || '',
		event: input.event || 'login',
		success: input.success !== false,
		ip: input.ip || '',
		user_agent: String(input.userAgent || '').slice(0, 500),
		reason: input.reason || '',
		meta: redactSecrets(input.meta || {}),
		occurred_at: new Date().toISOString(),
	}).catch(() => null);
}

export async function writeQueueAudit({
	job,
	action,
	severity = 'info',
	result = 'ok',
	message = '',
} = {}) {
	if (!job) return null;
	return writeAuditLog({
		category: 'queue',
		uiCategory: 'Queue Jobs',
		severity,
		action: action || `Queue job ${job.status}`,
		message: message || action,
		actorUserId: job.owner,
		actorLabel: job.owner ? '' : 'system',
		workspaceKey: job.workspace_key || '',
		workspaceLabel: job.workspace_label || '',
		service: 'Job Queue',
		provider: job.provider || '',
		model: job.model || '',
		credits: job.credits || 0,
		durationMs: job.duration_ms || 0,
		result,
		resourceType: 'queue_job',
		resourceId: job.id,
		correlationId: job.correlation_id || `queue_${job.id}`,
		request: { type: job.type, priority: job.priority },
		response: { status: job.status, progress: job.progress },
		metadata: { sourceCollection: job.source_collection || '', sourceId: job.source_id || '' },
	});
}
