import os from 'node:os';
import fs from 'node:fs';
import { getEnv } from '../../utils/env.js';

export function formatMs(ms) {
	const value = Number(ms) || 0;
	if (value <= 0) return '—';
	if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
	return `${Math.round(value)}ms`;
}

export function formatPct(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return '—';
	return `${Math.round(n)}%`;
}

export function formatClock(dateLike = new Date()) {
	const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function formatDateTime(dateLike = new Date()) {
	const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
	if (Number.isNaN(d.getTime())) return '—';
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd} ${formatClock(d)}`;
}

export function formatRelative(dateLike) {
	const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
	if (Number.isNaN(d.getTime())) return '—';
	const delta = Date.now() - d.getTime();
	if (delta < 60_000) return 'Just now';
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return formatDateTime(d);
}

export function formatUptime(seconds) {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const mins = Math.floor((total % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${mins}m`;
	return `${mins}m`;
}

export function worstStatus(...statuses) {
	const rank = { critical: 4, offline: 4, degraded: 3, warning: 2, healthy: 1, online: 1, disabled: 0, info: 0 };
	let best = 'healthy';
	let bestRank = 0;
	for (const status of statuses) {
		const key = String(status || 'healthy').toLowerCase();
		const value = rank[key] ?? 1;
		if (value > bestRank) {
			bestRank = value;
			best = key === 'offline' ? 'critical' : key === 'degraded' ? 'warning' : key === 'online' ? 'healthy' : key;
		}
	}
	return best;
}

export function mapHealthTone(status) {
	const value = String(status || '').toLowerCase();
	if (value === 'critical' || value === 'offline' || value === 'down' || value === 'error') return 'critical';
	if (value === 'warning' || value === 'degraded' || value === 'warn' || value === 'stale') return 'warning';
	return 'healthy';
}

export async function timedFetch(url, options = {}, timeoutMs = 8000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const started = Date.now();
	try {
		const response = await fetch(url, { ...options, signal: controller.signal });
		return { ok: response.ok, status: response.status, latencyMs: Date.now() - started, response };
	} catch (error) {
		return {
			ok: false,
			status: 0,
			latencyMs: Date.now() - started,
			error: error?.message || 'request failed',
		};
	} finally {
		clearTimeout(timer);
	}
}

let lastCpuSample = null;

export function sampleCpuPct() {
	const cpus = os.cpus() || [];
	if (!cpus.length) return 0;
	let idle = 0;
	let total = 0;
	for (const cpu of cpus) {
		idle += cpu.times.idle;
		total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
	}
	const sample = { idle, total, at: Date.now() };
	let pct = 0;
	if (lastCpuSample && sample.total > lastCpuSample.total) {
		const idleDelta = sample.idle - lastCpuSample.idle;
		const totalDelta = sample.total - lastCpuSample.total;
		pct = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
	} else {
		pct = Math.round((1 - idle / Math.max(total, 1)) * 100);
	}
	lastCpuSample = sample;
	return pct;
}

export function sampleMemoryPct() {
	const total = os.totalmem();
	const free = os.freemem();
	if (!total) return 0;
	return Math.round(((total - free) / total) * 100);
}

export function sampleDiskPct() {
	try {
		if (typeof fs.statfsSync === 'function') {
			const stats = fs.statfsSync(process.cwd());
			const total = Number(stats.blocks) * Number(stats.bsize);
			const free = Number(stats.bfree) * Number(stats.bsize);
			if (total > 0) return Math.round(((total - free) / total) * 100);
		}
	} catch {
		// platform may not support statfs
	}
	return Number.parseInt(getEnv('HEALTH_DISK_PCT', '0'), 10) || 0;
}

export function pushSeries(series = [], value, label) {
	const next = [...(Array.isArray(series) ? series : []), { label, value: Math.max(0, Math.min(100, Math.round(Number(value) || 0))) }];
	return next.slice(-12);
}

export function emptyResources() {
	return {
		cpu: [],
		memory: [],
		disk: [],
		bandwidth: [],
		storageGrowth: [],
	};
}
