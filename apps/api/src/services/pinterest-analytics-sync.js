import { assertPinterestAnalyticsWorkspaceIsolation } from './pinterest-workspace-isolation.js';

const POLL_INTERVAL_MS = Number.parseInt(process.env.PINTEREST_ANALYTICS_POLL_MS || String(15 * 60 * 1000), 10);
const MAX_PINS_PER_TICK = Number.parseInt(process.env.PINTEREST_ANALYTICS_BATCH || '20', 10);
const RESYNC_AFTER_MS = Number.parseInt(process.env.PINTEREST_ANALYTICS_RESYNC_MS || String(6 * 60 * 60 * 1000), 10);

let workerTimer = null;
let running = false;
let syncedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';
let pocketbaseClientPromise = null;

function analyticsLog(level, ...args) {
	import('../utils/logger.js')
		.then(({ default: logger }) => logger[level](...args))
		.catch(() => {
			const fn = console[level] || console.log;
			fn(...args);
		});
}

async function getDefaultPocketbaseClient() {
	if (!pocketbaseClientPromise) {
		pocketbaseClientPromise = import('../utils/pocketbaseClient.js').then((mod) => mod.default);
	}
	return pocketbaseClientPromise;
}

function formatDateUtc(date) {
	return date.toISOString().slice(0, 10);
}

function extractSummaryMetrics(payload) {
	if (!payload || typeof payload !== 'object') {
		return {
			impressions: null,
			saves: null,
			outboundClicks: null,
			closeups: null,
		};
	}

	// Pinterest returns keyed summary objects; prefer first available summary_metrics.
	const first = Object.values(payload).find((entry) => entry && typeof entry === 'object');
	const summary = first?.summary_metrics || payload.summary_metrics || {};

	return {
		impressions: summary.IMPRESSION ?? summary.impressions ?? null,
		saves: summary.SAVE ?? summary.saves ?? null,
		outboundClicks: summary.OUTBOUND_CLICK ?? summary.outbound_clicks ?? null,
		closeups: summary.PIN_CLICK ?? summary.pin_clicks ?? null,
	};
}

async function getPublishedJobsNeedingSync() {
	const pocketbaseClient = await getDefaultPocketbaseClient();
	const { buildSchemaSafeFilter, safeGetFullList } = await import('../utils/pocketbase-safe-query.js');
	const { filter } = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-analytics:published',
		parts: [
			{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'published' }) },
			{ field: 'pinterest_pin_id', expression: 'pinterest_pin_id != ""' },
		],
	});

	const jobs = await safeGetFullList({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-analytics:published',
		filter,
		sort: 'published_at',
	});

	const now = Date.now();
	return jobs.filter((job) => {
		if (!String(job.pinterest_pin_id || '').trim()) {
			return false;
		}
		const performance = job.performance || {};
		const neverSynced = !job.analytics_synced_at;
		const markedReady = performance.readyForAnalyticsSync !== false;
		const stale = job.analytics_synced_at
			? (now - new Date(job.analytics_synced_at).getTime()) >= RESYNC_AFTER_MS
			: true;
		return markedReady && (neverSynced || stale);
	}).slice(0, MAX_PINS_PER_TICK);
}

async function syncJobAnalytics(job) {
	return syncPinterestJobAnalytics(job);
}

export async function syncPinterestJobAnalytics(job, deps = {}) {
	let getAccount = deps.getOwnedPinterestAccountById;
	let ensureToken = deps.ensureValidPinterestAccessToken;
	let fetchAnalytics = deps.fetchPinterestPinAnalytics;
	if (!getAccount || !ensureToken || !fetchAnalytics) {
		const api = await import('./pinterest-api.js');
		getAccount = getAccount || api.getOwnedPinterestAccountById;
		ensureToken = ensureToken || api.ensureValidPinterestAccessToken;
		fetchAnalytics = fetchAnalytics || api.fetchPinterestPinAnalytics;
	}
	const client = deps.pocketbaseClient || await getDefaultPocketbaseClient();
	let sanitize = deps.sanitizeCollectionPayload;
	if (!sanitize) {
		({ sanitizeCollectionPayload: sanitize } = await import('../utils/pocketbase-safe-query.js'));
	}

	const account = await getAccount({ owner: job.owner, accountId: job.account });
	try {
		assertPinterestAnalyticsWorkspaceIsolation({ job, account });
	} catch (isolationError) {
		analyticsLog('warn', `Pinterest analytics skipped job ${job.id}: ${isolationError.message}`);
		return;
	}

	const tokenState = await ensureToken({ account });
	const end = new Date();
	const start = new Date(end.getTime() - 89 * 24 * 60 * 60 * 1000);
	const analytics = await fetchAnalytics({
		accessToken: tokenState.accessToken,
		pinId: job.pinterest_pin_id,
		startDate: formatDateUtc(start),
		endDate: formatDateUtc(end),
	});

	const metrics = extractSummaryMetrics(analytics);
	const syncedAt = new Date().toISOString();
	const performance = {
		...(job.performance && typeof job.performance === 'object' ? job.performance : {}),
		...metrics,
		readyForAnalyticsSync: true,
		lastSyncedAt: syncedAt,
	};

	const payload = await sanitize({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-analytics:update-job',
		payload: {
			performance,
			analytics_synced_at: syncedAt,
		},
	});

	await client.collection('pinterest_publish_jobs').update(job.id, payload);

	if (job.ai_pin) {
		const pin = await client.collection('ai_pins').getOne(job.ai_pin).catch(() => null);
		try {
			const { assertJobPinOwnership } = await import('./queue/job-ownership.js');
			assertJobPinOwnership(job, pin);
			await client.collection('ai_pins').update(job.ai_pin, {
				performance,
			}).catch(() => null);
		} catch (ownershipError) {
			analyticsLog(
				'warn',
				`Pinterest analytics skipped pin update for job ${job.id}: ${ownershipError.message}`,
			);
		}
	}
}

async function processAnalyticsSync() {
	if (running) {
		return;
	}

	running = true;
	lastRunAt = new Date().toISOString();
	try {
		const jobs = await getPublishedJobsNeedingSync();
		for (const job of jobs) {
			try {
				await syncJobAnalytics(job);
				syncedTotal += 1;
				lastSuccessAt = new Date().toISOString();
			} catch (error) {
				const { normalizePinterestError } = await import('./pinterest-api.js');
				const normalized = normalizePinterestError(error);
				lastErrorMessage = normalized.message;
				analyticsLog('warn', `Pinterest analytics sync failed for job ${job.id}: ${normalized.message}`);
			}
		}
	} catch (error) {
		lastErrorMessage = error?.message || 'Analytics sync failed';
		analyticsLog('error', 'Pinterest analytics sync failed:', error);
	} finally {
		running = false;
	}
}

export function getPinterestAnalyticsStatus() {
	return {
		running,
		active: Boolean(workerTimer),
		pollIntervalMs: POLL_INTERVAL_MS,
		batchSize: MAX_PINS_PER_TICK,
		syncedTotal,
		lastRunAt,
		lastSuccessAt,
		lastErrorMessage,
	};
}

export function startPinterestAnalyticsSync() {
	if (workerTimer) {
		return;
	}

	workerTimer = setInterval(() => {
		processAnalyticsSync();
	}, POLL_INTERVAL_MS);

	processAnalyticsSync();
	analyticsLog('info', `Pinterest analytics sync started (interval ${POLL_INTERVAL_MS}ms)`);
}

export function stopPinterestAnalyticsSync() {
	if (!workerTimer) {
		return;
	}
	clearInterval(workerTimer);
	workerTimer = null;
	analyticsLog('info', 'Pinterest analytics sync stopped');
}
