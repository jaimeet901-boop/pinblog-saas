export const JOB_TYPE_LABELS = {
	ai_article_generation: 'AI Article Generation',
	recipe_generation: 'Recipe Generation',
	image_generation: 'Image Generation',
	ai_pin_analyze: 'AI Pin Analyze',
	ai_pin_prompt: 'AI Pin Prompt',
	pinterest_publishing: 'Pinterest Publishing',
	wordpress_publishing: 'WordPress Publishing',
	bulk_publishing: 'Bulk Publishing',
	seo_optimization: 'SEO Optimization',
	template_rendering: 'Template Rendering',
	website_scan: 'Website Scan',
	import: 'Import',
	export: 'Export',
	webhook_delivery: 'Webhook Delivery',
	email_notification: 'Email Notification',
	notification: 'Notification',
	media_upload: 'Media Upload',
	analytics_refresh: 'Analytics Refresh',
	health_check: 'Health Checks',
};

export const LABEL_TO_JOB_TYPE = Object.fromEntries(
	Object.entries(JOB_TYPE_LABELS).map(([code, label]) => [label.toLowerCase(), code]),
);

export const NATIVE_JOB_TYPES = [
	'webhook_delivery',
	'email_notification',
	'notification',
	'media_upload',
	'analytics_refresh',
	'health_check',
];

export const ACTIVE_STATUSES = ['pending', 'queued', 'waiting', 'waiting_provider', 'running', 'retrying', 'paused'];
export const QUEUE_DEPTH_STATUSES = ['pending', 'queued', 'waiting', 'waiting_provider', 'retrying'];
export const TERMINAL_STATUSES = ['completed', 'cancelled', 'failed'];

export const PRIORITY_WEIGHT = {
	critical: 0,
	high: 1,
	normal: 2,
	low: 3,
};

export const RETRY_DELAYS_MS = [0, 30_000, 120_000, 300_000];

export function normalizeJobType(value) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	if (JOB_TYPE_LABELS[raw]) return raw;
	const fromLabel = LABEL_TO_JOB_TYPE[raw.toLowerCase()];
	if (fromLabel) return fromLabel;
	const slug = raw.toLowerCase().replace(/\s+/g, '_');
	if (JOB_TYPE_LABELS[slug]) return slug;
	return raw;
}

export function jobTypeLabel(type) {
	const code = normalizeJobType(type);
	return JOB_TYPE_LABELS[code] || type || 'Unknown';
}

export function mapSourceStatusToQueue(sourceCollection, status) {
	const value = String(status || '').toLowerCase();
	if (sourceCollection === 'publish_jobs') {
		if (value === 'queued') return 'queued';
		if (value === 'scheduled') return 'waiting';
		if (value === 'publishing') return 'running';
		if (value === 'retrying') return 'retrying';
		if (value === 'published') return 'completed';
		if (value === 'failed') return 'failed';
		if (value === 'cancelled') return 'cancelled';
	}
	if (sourceCollection === 'pinterest_publish_jobs') {
		if (value === 'scheduled') return 'waiting';
		if (value === 'waiting_provider') return 'waiting_provider';
		if (value === 'publishing') return 'running';
		if (value === 'retrying') return 'retrying';
		if (value === 'published') return 'completed';
		if (value === 'failed') return 'failed';
		if (value === 'cancelled') return 'cancelled';
	}
	if (sourceCollection === 'ai_pin_image_jobs') {
		if (value === 'queued') return 'queued';
		if (value === 'processing') return 'running';
		if (value === 'completed' || value === 'fallback') return 'completed';
		if (value === 'failed') return 'failed';
	}
	if (ACTIVE_STATUSES.includes(value) || TERMINAL_STATUSES.includes(value)) return value;
	if (value === 'pending') return 'pending';
	return 'queued';
}

export function formatDuration(ms) {
	const value = Number(ms) || 0;
	if (value <= 0) return '—';
	if (value < 1000) return `${value}ms`;
	if (value < 60_000) return `${Math.round(value / 1000)}s`;
	const minutes = Math.floor(value / 60_000);
	const seconds = Math.round((value % 60_000) / 1000);
	if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const rem = minutes % 60;
	return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

export function formatDateTime(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatRelative(value) {
	if (!value) return '—';
	const ms = Date.now() - new Date(value).getTime();
	if (Number.isNaN(ms) || ms < 0) return 'just now';
	if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
	return `${Math.round(ms / 86_400_000)}d ago`;
}

export function nextRetryAt(attemptCount = 1) {
	const capped = Math.max(1, Math.min(10, attemptCount));
	const delay = RETRY_DELAYS_MS[Math.min(capped, RETRY_DELAYS_MS.length - 1)] || capped * 60_000;
	return new Date(Date.now() + delay).toISOString();
}
