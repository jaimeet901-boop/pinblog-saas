import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { formatDuration, QUEUE_DEPTH_STATUSES } from './types.js';
import { listWorkers } from './workers.js';

const CONTROL_KEY = 'global_control';
const SNAPSHOT_KEY = 'live_snapshot';

async function getMetricRow(bucketKey) {
	return pocketbaseClient.collection('queue_metrics').getFirstListItem(
		pocketbaseClient.filter('bucket_key = {:key}', { key: bucketKey }),
		{ requestKey: null },
	).catch(() => null);
}

export async function isQueuePaused() {
	const row = await getMetricRow(CONTROL_KEY);
	return Boolean(row?.paused);
}

export async function setQueuePaused(paused) {
	const existing = await getMetricRow(CONTROL_KEY);
	const body = {
		bucket_key: CONTROL_KEY,
		bucket_at: new Date().toISOString(),
		paused: Boolean(paused),
		meta: { updatedAt: new Date().toISOString() },
	};
	if (existing) {
		return pocketbaseClient.collection('queue_metrics').update(existing.id, body);
	}
	return pocketbaseClient.collection('queue_metrics').create(body);
}

async function countByStatus(status) {
	const result = await pocketbaseClient.collection('queue_jobs').getList(1, 1, {
		filter: pocketbaseClient.filter('status = {:status}', { status }),
		requestKey: null,
	}).catch(() => ({ totalItems: 0 }));
	return Number(result.totalItems) || 0;
}

async function countFilter(filter) {
	const result = await pocketbaseClient.collection('queue_jobs').getList(1, 1, {
		filter,
		requestKey: null,
	}).catch(() => ({ totalItems: 0 }));
	return Number(result.totalItems) || 0;
}

function startOfTodayIso() {
	const now = new Date();
	now.setHours(0, 0, 0, 0);
	return now.toISOString();
}

export async function computeQueueSummary() {
	const [
		running,
		queued,
		waiting,
		pending,
		retrying,
		failed,
		paused,
		completedToday,
		workers,
		recentCompleted,
		longestWaiting,
		oldestRunning,
		pausedFlag,
	] = await Promise.all([
		countByStatus('running'),
		countByStatus('queued'),
		countByStatus('waiting'),
		countByStatus('pending'),
		countByStatus('retrying'),
		countByStatus('failed'),
		countByStatus('paused'),
		countFilter(pocketbaseClient.filter('status = "completed" && completed_at >= {:today}', { today: startOfTodayIso() })),
		listWorkers(),
		pocketbaseClient.collection('queue_jobs').getList(1, 40, {
			filter: pocketbaseClient.filter('status = "completed" && completed_at >= {:since}', {
				since: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
			}),
			sort: '-completed_at',
			requestKey: null,
		}).catch(() => ({ items: [] })),
		pocketbaseClient.collection('queue_jobs').getList(1, 1, {
			filter: pocketbaseClient.filter(`(${QUEUE_DEPTH_STATUSES.map((s) => `status="${s}"`).join(' || ')})`),
			sort: 'created',
			requestKey: null,
		}).catch(() => ({ items: [] })),
		pocketbaseClient.collection('queue_jobs').getList(1, 1, {
			filter: pocketbaseClient.filter('status = "running"'),
			sort: 'started_at',
			requestKey: null,
		}).catch(() => ({ items: [] })),
		isQueuePaused(),
	]);

	const durations = (recentCompleted.items || [])
		.map((item) => Number(item.duration_ms) || 0)
		.filter((value) => value > 0);
	const avgMs = durations.length
		? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
		: 0;

	const completedLastMinute = (recentCompleted.items || []).filter((item) => {
		const at = item.completed_at ? new Date(item.completed_at).getTime() : 0;
		return at >= Date.now() - 60_000;
	}).length;

	const onlineWorkers = workers.filter((worker) => worker.status === 'online');
	const queueSize = queued + waiting + pending + retrying + paused;
	const decided = completedToday + failed;
	const failureRate = decided ? Math.round((failed / decided) * 1000) / 10 : 0;
	const retryRate = decided + retrying
		? Math.round((retrying / Math.max(decided + retrying, 1)) * 1000) / 10
		: 0;

	const waitJob = longestWaiting.items?.[0];
	const runJob = oldestRunning.items?.[0];
	const waitAge = waitJob?.created ? Date.now() - new Date(waitJob.created).getTime() : 0;
	const runAge = runJob?.started_at ? Date.now() - new Date(runJob.started_at).getTime() : 0;

	const summary = {
		running,
		queued: queueSize,
		completedToday,
		failed,
		retry: retrying,
		avgProcessingTime: formatDuration(avgMs),
		workersOnline: `${onlineWorkers.length} / ${Math.max(workers.length, onlineWorkers.length)}`,
		jobsPerMinute: completedLastMinute,
		paused: pausedFlag,
		metrics: {
			jobsPerMinute: completedLastMinute,
			averageDurationMs: avgMs,
			failureRate,
			retryRate,
			workerHealth: onlineWorkers.length ? 'healthy' : 'degraded',
			queueSize,
		},
		health: {
			avgQueueTime: formatDuration(waitAge || avgMs),
			longestWaiting: waitJob ? `${waitJob.id} · ${formatDuration(waitAge)}` : '—',
			oldestRunning: runJob ? `${runJob.id} · ${formatDuration(runAge)}` : '—',
			queueCapacity: `${Math.min(100, Math.round((queueSize / 100) * 100))}%`,
			workerUtilization: workers.length
				? `${Math.round((onlineWorkers.filter((w) => w.currentJob && w.currentJob !== '—').length / Math.max(onlineWorkers.length, 1)) * 100)}%`
				: '0%',
		},
	};

	await persistSnapshot(summary, onlineWorkers.length, workers.length);
	return summary;
}

async function persistSnapshot(summary, workersOnline, workersTotal) {
	const body = {
		bucket_key: SNAPSHOT_KEY,
		bucket_at: new Date().toISOString(),
		jobs_per_minute: summary.jobsPerMinute,
		avg_duration_ms: summary.metrics.averageDurationMs,
		failure_rate: summary.metrics.failureRate,
		retry_rate: summary.metrics.retryRate,
		queue_size: summary.metrics.queueSize,
		workers_online: workersOnline,
		workers_total: workersTotal,
		running: summary.running,
		queued: summary.queued,
		failed: summary.failed,
		retrying: summary.retry,
		completed_today: summary.completedToday,
		paused: summary.paused,
		meta: { health: summary.health },
	};
	const existing = await getMetricRow(SNAPSHOT_KEY);
	if (existing) {
		await pocketbaseClient.collection('queue_metrics').update(existing.id, body).catch(() => null);
	} else {
		await pocketbaseClient.collection('queue_metrics').create(body).catch(() => null);
	}
}

export async function listRecentActivity(limit = 12) {
	const events = await pocketbaseClient.collection('queue_job_events').getList(1, limit, {
		sort: '-created',
		expand: 'job',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	return (events.items || []).map((event) => ({
		id: event.id,
		text: event.message,
		kind: event.expand?.job?.type || event.level || 'Jobs',
		time: formatRelativeSafe(event.at || event.created),
		jobId: event.job,
		at: event.at || event.created,
	}));
}

function formatRelativeSafe(value) {
	if (!value) return '—';
	const ms = Date.now() - new Date(value).getTime();
	if (!Number.isFinite(ms) || ms < 0) return 'just now';
	if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
	return `${Math.round(ms / 86_400_000)}d ago`;
}

export async function cleanupOldJobs({ retainDays = 30 } = {}) {
	const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000).toISOString();
	const old = await pocketbaseClient.collection('queue_jobs').getList(1, 50, {
		filter: pocketbaseClient.filter('(status = "completed" || status = "cancelled") && updated < {:cutoff}', { cutoff }),
		requestKey: null,
	}).catch(() => ({ items: [] }));

	let deleted = 0;
	for (const job of old.items || []) {
		await pocketbaseClient.collection('queue_jobs').delete(job.id).catch(() => null);
		deleted += 1;
	}
	return deleted;
}
