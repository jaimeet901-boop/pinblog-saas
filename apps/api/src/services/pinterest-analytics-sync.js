import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import {
	ensureValidPinterestAccessToken,
	fetchPinterestPinAnalytics,
	getOwnedPinterestAccountById,
	normalizePinterestError,
} from './pinterest-api.js';
import {
	buildSchemaSafeFilter,
	safeGetFullList,
	sanitizeCollectionPayload,
} from '../utils/pocketbase-safe-query.js';

const POLL_INTERVAL_MS = Number.parseInt(process.env.PINTEREST_ANALYTICS_POLL_MS || String(15 * 60 * 1000), 10);
const MAX_PINS_PER_TICK = Number.parseInt(process.env.PINTEREST_ANALYTICS_BATCH || '20', 10);
const RESYNC_AFTER_MS = Number.parseInt(process.env.PINTEREST_ANALYTICS_RESYNC_MS || String(6 * 60 * 60 * 1000), 10);

let workerTimer = null;
let running = false;
let syncedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';

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
	const account = await getOwnedPinterestAccountById({ owner: job.owner, accountId: job.account });
	if (!account?.connected) {
		return;
	}

	const tokenState = await ensureValidPinterestAccessToken({ account });
	const end = new Date();
	const start = new Date(end.getTime() - 89 * 24 * 60 * 60 * 1000);
	const analytics = await fetchPinterestPinAnalytics({
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

	const payload = await sanitizeCollectionPayload({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-analytics:update-job',
		payload: {
			performance,
			analytics_synced_at: syncedAt,
		},
	});

	await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, payload);

	if (job.ai_pin) {
		await pocketbaseClient.collection('ai_pins').update(job.ai_pin, {
			performance,
		}).catch(() => null);
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
				const normalized = normalizePinterestError(error);
				lastErrorMessage = normalized.message;
				logger.warn(`Pinterest analytics sync failed for job ${job.id}: ${normalized.message}`);
			}
		}
	} catch (error) {
		lastErrorMessage = error?.message || 'Analytics sync failed';
		logger.error('Pinterest analytics sync failed:', error);
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
	logger.info(`Pinterest analytics sync started (interval ${POLL_INTERVAL_MS}ms)`);
}

export function stopPinterestAnalyticsSync() {
	if (!workerTimer) {
		return;
	}
	clearInterval(workerTimer);
	workerTimer = null;
	logger.info('Pinterest analytics sync stopped');
}
