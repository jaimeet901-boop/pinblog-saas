export const ANALYTICS_TTL_SECONDS = Number.parseInt(process.env.ANALYTICS_CACHE_TTL || '180', 10);

export function resolveRange(range = '30d', from, to) {
	const now = new Date();
	const end = to ? new Date(to) : now;
	end.setHours(23, 59, 59, 999);

	let start;
	const key = String(range || '30d');
	if (key === 'today') {
		start = new Date(now);
		start.setHours(0, 0, 0, 0);
	} else if (key === '7d') {
		start = new Date(now);
		start.setDate(start.getDate() - 6);
		start.setHours(0, 0, 0, 0);
	} else if (key === '90d') {
		start = new Date(now);
		start.setDate(start.getDate() - 89);
		start.setHours(0, 0, 0, 0);
	} else if (key === 'custom' && from) {
		start = new Date(from);
		start.setHours(0, 0, 0, 0);
	} else {
		start = new Date(now);
		start.setDate(start.getDate() - 29);
		start.setHours(0, 0, 0, 0);
	}

	return {
		rangeKey: key === 'custom' ? 'custom' : (['today', '7d', '30d', '90d'].includes(key) ? key : '30d'),
		start,
		end,
		startIso: start.toISOString(),
		endIso: end.toISOString(),
	};
}

export function formatDuration(ms) {
	const value = Number(ms) || 0;
	if (value <= 0) return '—';
	if (value < 1000) return `${value}ms`;
	if (value < 60_000) return `${Math.round(value / 1000)}s`;
	const minutes = Math.floor(value / 60_000);
	const seconds = Math.round((value % 60_000) / 1000);
	return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
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

export function dayLabel(date) {
	return date.toLocaleDateString('en-US', { weekday: 'short' });
}

export function monthLabel(date) {
	return date.toLocaleDateString('en-US', { month: 'short' });
}

export function dayKey(date) {
	const d = new Date(date);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function inRange(value, start, end) {
	if (!value) return false;
	const t = new Date(value).getTime();
	if (!Number.isFinite(t)) return false;
	return t >= start.getTime() && t <= end.getTime();
}

export function pct(part, total) {
	if (!total) return 0;
	return Math.round((part / total) * 1000) / 10;
}

export function avg(numbers) {
	const list = (numbers || []).filter((n) => Number.isFinite(n) && n > 0);
	if (!list.length) return 0;
	return Math.round(list.reduce((sum, n) => sum + n, 0) / list.length);
}

export function seriesFromMap(map, sorter = (a, b) => a.localeCompare(b)) {
	return [...map.entries()]
		.sort((a, b) => sorter(a[0], b[0]))
		.map(([label, value]) => ({ label, value: Number(value) || 0 }));
}

export function bump(map, key, amount = 1) {
	map.set(key, (map.get(key) || 0) + amount);
}

export function safeList(promise, fallback = []) {
	return promise.catch(() => fallback);
}
