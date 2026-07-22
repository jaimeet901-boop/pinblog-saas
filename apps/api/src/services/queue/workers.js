import os from 'node:os';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { formatDuration } from './types.js';

const HEARTBEAT_STALE_MS = Number.parseInt(process.env.QUEUE_WORKER_STALE_MS || String(90_000), 10);

export async function upsertWorker({
	workerId,
	status = 'online',
	jobTypes = [],
	concurrency = 1,
	currentJob = '',
	timeoutMs = 600_000,
	meta = {},
}) {
	if (!workerId) return null;
	const existing = await pocketbaseClient.collection('queue_workers').getFirstListItem(
		pocketbaseClient.filter('worker_id = {:id}', { id: workerId }),
		{ requestKey: null },
	).catch(() => null);

	const mem = process.memoryUsage();
	const memoryPct = Math.min(100, Math.round((mem.heapUsed / Math.max(mem.heapTotal, 1)) * 100));
	const load = os.loadavg?.()?.[0];
	const cpuPct = Number.isFinite(load)
		? Math.min(100, Math.round((load / Math.max(os.cpus()?.length || 1, 1)) * 100))
		: 0;

	const body = {
		worker_id: workerId,
		status,
		job_types: jobTypes,
		concurrency: Number(concurrency) || 1,
		current_job: currentJob || '',
		last_heartbeat: new Date().toISOString(),
		cpu_pct: cpuPct,
		memory_pct: memoryPct,
		timeout_ms: Number(timeoutMs) || 600_000,
		meta,
	};

	if (existing) {
		return pocketbaseClient.collection('queue_workers').update(existing.id, body).catch(() => existing);
	}
	return pocketbaseClient.collection('queue_workers').create({
		...body,
		jobs_today: 0,
		avg_duration_ms: 0,
	}).catch(() => null);
}

export async function heartbeatWorker(workerId, patch = {}) {
	return upsertWorker({
		workerId,
		status: patch.status || 'online',
		jobTypes: patch.jobTypes,
		concurrency: patch.concurrency,
		currentJob: patch.currentJob,
		timeoutMs: patch.timeoutMs,
		meta: patch.meta,
	});
}

export async function markWorkerJobComplete(workerId, durationMs = 0) {
	const worker = await pocketbaseClient.collection('queue_workers').getFirstListItem(
		pocketbaseClient.filter('worker_id = {:id}', { id: workerId }),
		{ requestKey: null },
	).catch(() => null);
	if (!worker) return null;

	const jobsToday = (Number(worker.jobs_today) || 0) + 1;
	const prevAvg = Number(worker.avg_duration_ms) || 0;
	const avg = prevAvg
		? Math.round(((prevAvg * (jobsToday - 1)) + (Number(durationMs) || 0)) / jobsToday)
		: Number(durationMs) || 0;

	return pocketbaseClient.collection('queue_workers').update(worker.id, {
		jobs_today: jobsToday,
		avg_duration_ms: avg,
		current_job: '',
		last_heartbeat: new Date().toISOString(),
		status: 'online',
	}).catch(() => null);
}

export async function recoverStaleWorkers() {
	const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MS).toISOString();
	const stale = await pocketbaseClient.collection('queue_workers').getFullList({
		filter: pocketbaseClient.filter('status = "online" && last_heartbeat < {:cutoff}', { cutoff }),
		requestKey: null,
	}).catch(() => []);

	for (const worker of stale) {
		await pocketbaseClient.collection('queue_workers').update(worker.id, {
			status: 'stale',
			current_job: '',
		}).catch(() => null);
	}
	return stale.length;
}

export async function listWorkers() {
	const items = await pocketbaseClient.collection('queue_workers').getFullList({
		sort: '-last_heartbeat',
		requestKey: null,
	}).catch(() => []);
	return items.map(mapWorkerDto);
}

export function mapWorkerDto(worker) {
	return {
		id: worker.worker_id || worker.id,
		status: worker.status || 'offline',
		currentJob: worker.current_job || '—',
		cpu: `${Number(worker.cpu_pct) || 0}%`,
		memory: `${Number(worker.memory_pct) || 0}%`,
		jobsToday: Number(worker.jobs_today) || 0,
		avgTime: formatDuration(worker.avg_duration_ms),
		jobTypes: Array.isArray(worker.job_types) ? worker.job_types : [],
		concurrency: Number(worker.concurrency) || 1,
		lastHeartbeat: worker.last_heartbeat || null,
		timeoutMs: Number(worker.timeout_ms) || 0,
	};
}
