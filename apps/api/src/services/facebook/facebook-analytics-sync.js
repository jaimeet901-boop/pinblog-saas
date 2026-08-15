/**
 * Facebook Channel Pack — Insights sync worker (F7-4).
 * Polls published facebook_publish_jobs and refreshes performance metrics.
 */

import { FACEBOOK_JOB_COLLECTION } from './channel-pack.js';
import {
	extractFacebookPostInsightsMetrics,
	fetchFacebookPostInsights,
} from './facebook-analytics.js';
import { normalizeFacebookGraphError } from './graph-publish.js';
import {
	assertFacebookQueueWorkspaceIsolation,
	buildFacebookQueuePageFilterParams,
} from './workspace-isolation.js';

const POLL_INTERVAL_MS = Number.parseInt(
	process.env.FACEBOOK_ANALYTICS_POLL_MS || String(15 * 60 * 1000),
	10,
);
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.FACEBOOK_ANALYTICS_BATCH || '20', 10);
const RESYNC_AFTER_MS = Number.parseInt(
	process.env.FACEBOOK_ANALYTICS_RESYNC_MS || String(6 * 60 * 60 * 1000),
	10,
);

let workerTimer = null;
let running = false;
let syncedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';
let envDisabledLogged = false;

function syncLog(level, ...args) {
	if (!process.env.PB_SUPERUSER_EMAIL) {
		const fn = console[level] || console.log;
		fn(...args);
		return;
	}
	import('../../utils/logger.js')
		.then(({ default: logger }) => logger[level](...args))
		.catch(() => {});
}

let pocketbaseClientPromise = null;

async function getDefaultPocketbaseClient() {
	if (!pocketbaseClientPromise) {
		pocketbaseClientPromise = import('../../utils/pocketbaseClient.js').then((mod) => mod.default);
	}
	return pocketbaseClientPromise;
}

async function resolvePocketbaseClient(deps = {}) {
	if (deps.pocketbaseClient) return deps.pocketbaseClient;
	if (deps.client) return deps.client;
	return getDefaultPocketbaseClient();
}

async function loadSafeQuery() {
	return import('../../utils/pocketbase-safe-query.js');
}

async function resolveSyncDeps(deps = {}) {
	let getOwnedFacebookAccountById = deps.getOwnedFacebookAccountById;
	if (!getOwnedFacebookAccountById) {
		({ getOwnedFacebookAccountById } = await import('./api.js'));
	}

	let decryptPageTokenMap = deps.decryptPageTokenMap;
	if (!decryptPageTokenMap) {
		({ decryptPageTokenMap } = await import('./secrets.js'));
	}

	const pocketbaseClient = await resolvePocketbaseClient(deps);

	return {
		pocketbaseClient,
		getOwnedFacebookAccountById,
		decryptPageTokenMap,
		fetchFacebookPostInsights: deps.fetchFacebookPostInsights || fetchFacebookPostInsights,
		getFacebookPageForQueueJob: deps.getFacebookPageForQueueJob || null,
		client: pocketbaseClient,
	};
}

function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

async function loadFacebookPageForJob({
	pocketbaseClient,
	owner,
	workspaceId,
	accountId,
	pageId,
	loader = null,
}) {
	if (typeof loader === 'function') {
		return loader({ owner, workspaceId, accountId, pageId });
	}
	const params = buildFacebookQueuePageFilterParams({
		owner,
		workspaceId,
		accountId,
		pageId,
	});
	if (!params.owner || !params.workspace || !params.account || !params.pageId) {
		return null;
	}
	return pocketbaseClient.collection('facebook_pages').getFirstListItem(
		pocketbaseClient.filter(
			'owner = {:owner} && workspace = {:workspace} && account = {:account} && page_id = {:pageId}',
			params,
		),
		{ requestKey: null },
	).catch(() => null);
}

/**
 * Worker gate. Unset defaults to enabled.
 */
export function isFacebookAnalyticsSyncEnabled() {
	const raw = String(process.env.FACEBOOK_ANALYTICS_ENABLED ?? '').trim().toLowerCase();
	if (!raw) {
		return true;
	}
	if (raw === '1' || raw === 'true') {
		return true;
	}
	if (raw === '0' || raw === 'false') {
		return false;
	}
	return true;
}

function shouldSyncJob(job, nowMs, resyncAfterMs = RESYNC_AFTER_MS) {
	if (!String(job?.facebook_post_id || '').trim()) {
		return false;
	}

	const performance = job.performance && typeof job.performance === 'object' ? job.performance : {};
	const neverSynced = !job.analytics_synced_at;
	const markedReady = performance.readyForAnalyticsSync !== false;
	const stale = job.analytics_synced_at
		? (nowMs - new Date(job.analytics_synced_at).getTime()) >= resyncAfterMs
		: true;

	return markedReady && (neverSynced || stale);
}

export function shouldSyncFacebookAnalyticsJob(job, nowMs = Date.now(), resyncAfterMs = RESYNC_AFTER_MS) {
	return shouldSyncJob(job, nowMs, resyncAfterMs);
}

/**
 * @param {object} [deps]
 * @param {number} [deps.resyncAfterMs]
 * @param {number} [deps.batchSize]
 */
export async function getPublishedFacebookJobsNeedingSync(deps = {}) {
	const resyncAfterMs = deps.resyncAfterMs ?? RESYNC_AFTER_MS;
	const batchSize = deps.batchSize ?? MAX_JOBS_PER_TICK;

	if (typeof deps.listPublishedJobs === 'function') {
		const jobs = await deps.listPublishedJobs(deps);
		const now = Date.now();
		return jobs
			.filter((job) => shouldSyncJob(job, now, resyncAfterMs))
			.slice(0, batchSize);
	}

	const { pocketbaseClient } = await resolveSyncDeps(deps);
	const { buildSchemaSafeFilter, safeGetFullList } = await loadSafeQuery();

	const { filter } = await buildSchemaSafeFilter({
		collection: FACEBOOK_JOB_COLLECTION,
		context: 'facebook-analytics:published',
		parts: [
			{
				field: 'status',
				expression: pocketbaseClient.filter('status = {:status}', { status: 'published' }),
			},
			{ field: 'facebook_post_id', expression: 'facebook_post_id != ""' },
		],
	});

	const jobs = await safeGetFullList({
		collection: FACEBOOK_JOB_COLLECTION,
		context: 'facebook-analytics:published',
		filter,
		sort: 'published_at',
	});

	const now = Date.now();
	return jobs
		.filter((job) => shouldSyncJob(job, now, resyncAfterMs))
		.slice(0, batchSize);
}

/**
 * @param {object} job
 * @param {object} [deps]
 */
export async function syncFacebookJobAnalytics(job, deps = {}) {
	const resolved = await resolveSyncDeps(deps);
	const {
		pocketbaseClient,
		getOwnedFacebookAccountById,
		decryptPageTokenMap,
		fetchFacebookPostInsights: fetchInsights,
		getFacebookPageForQueueJob,
	} = resolved;

	const postId = String(job?.facebook_post_id || '').trim();
	if (!postId) {
		return;
	}

	const owner = recordFieldId(job.owner);
	const accountId = recordFieldId(job.account);
	const pageId = String(job.page_id || '').trim();
	const account = await getOwnedFacebookAccountById({
		owner,
		accountId,
	});
	const page = await loadFacebookPageForJob({
		pocketbaseClient,
		owner,
		workspaceId: recordFieldId(job.workspace || job.workspace_id),
		accountId,
		pageId,
		loader: getFacebookPageForQueueJob,
	});
	try {
		assertFacebookQueueWorkspaceIsolation({ job, account, page });
	} catch (isolationError) {
		syncLog(
			'warn',
			`Facebook analytics skipped job ${job.id}: ${isolationError.message}`,
		);
		return;
	}
	if (!account?.connected) {
		return;
	}
	const pageTokens = decryptPageTokenMap(account);
	const accessToken = pageTokens[pageId] || '';
	if (!accessToken) {
		return;
	}

	let insightsPayload;
	try {
		insightsPayload = await fetchInsights({
			postId,
			accessToken,
			fetchImpl: deps.fetchImpl,
		});
	} catch (error) {
		const normalized = normalizeFacebookGraphError(error);
		if (normalized.tokenExpired && job.account) {
			let markFacebookAccountStatus = deps.markFacebookAccountStatus;
			if (!markFacebookAccountStatus) {
				({ markFacebookAccountStatus } = await import('./api.js'));
			}
			await markFacebookAccountStatus({
				accountId: job.account,
				status: 'expired',
				statusError: normalized.message,
			}).catch(() => null);
		}
		throw normalized;
	}

	const metrics = extractFacebookPostInsightsMetrics(insightsPayload);
	const syncedAt = new Date().toISOString();
	const performance = {
		...(job.performance && typeof job.performance === 'object' ? job.performance : {}),
		...metrics,
		readyForAnalyticsSync: true,
		lastSyncedAt: syncedAt,
	};

	const updatePayload = {
		performance,
		analytics_synced_at: syncedAt,
	};
	const payload = deps.sanitizePayload
		? await deps.sanitizePayload(updatePayload)
		: await (async () => {
			const { sanitizeCollectionPayload } = await loadSafeQuery();
			return sanitizeCollectionPayload({
				collection: FACEBOOK_JOB_COLLECTION,
				context: 'facebook-analytics:update-job',
				payload: updatePayload,
			});
		})();

	await pocketbaseClient.collection(FACEBOOK_JOB_COLLECTION).update(job.id, payload);

	if (job.ai_pin) {
		const pin = await pocketbaseClient.collection('ai_pins').getOne(job.ai_pin).catch(() => null);
		try {
			const { assertJobPinOwnership } = await import('../queue/job-ownership.js');
			assertJobPinOwnership(job, pin);
			await pocketbaseClient.collection('ai_pins').update(job.ai_pin, {
				performance,
			}).catch(() => null);
		} catch (ownershipError) {
			syncLog(
				'warn',
				`Facebook analytics skipped pin update for job ${job.id}: ${ownershipError.message}`,
			);
		}
	}
}

/**
 * @param {object} [deps]
 */
export async function processFacebookAnalyticsSync(deps = {}) {
	if (running) {
		return;
	}

	running = true;
	lastRunAt = new Date().toISOString();
	try {
		const jobs = await getPublishedFacebookJobsNeedingSync(deps);
		for (const job of jobs) {
			try {
				await syncFacebookJobAnalytics(job, deps);
				syncedTotal += 1;
				lastSuccessAt = new Date().toISOString();
			} catch (error) {
				const normalized = normalizeFacebookGraphError(error);
				lastErrorMessage = normalized.message;
				syncLog('warn', `Facebook analytics sync failed for job ${job.id}: ${normalized.message}`);
			}
		}
	} catch (error) {
		lastErrorMessage = error?.message || 'Facebook analytics sync failed';
		syncLog('error', 'Facebook analytics sync failed:', error);
	} finally {
		running = false;
	}
}

export function getFacebookAnalyticsSyncStatus() {
	return {
		running,
		active: Boolean(workerTimer),
		enabled: isFacebookAnalyticsSyncEnabled(),
		pollIntervalMs: POLL_INTERVAL_MS,
		batchSize: MAX_JOBS_PER_TICK,
		resyncAfterMs: RESYNC_AFTER_MS,
		syncedTotal,
		lastRunAt,
		lastSuccessAt,
		lastErrorMessage,
	};
}

export function startFacebookAnalyticsSync() {
	if (workerTimer) {
		return;
	}
	if (!isFacebookAnalyticsSyncEnabled()) {
		if (!envDisabledLogged) {
			syncLog('info', 'Facebook analytics sync disabled via FACEBOOK_ANALYTICS_ENABLED');
			envDisabledLogged = true;
		}
		return;
	}

	workerTimer = setInterval(() => {
		processFacebookAnalyticsSync();
	}, POLL_INTERVAL_MS);

	processFacebookAnalyticsSync();
	syncLog('info', `Facebook analytics sync started (interval ${POLL_INTERVAL_MS}ms)`);
}

export function stopFacebookAnalyticsSync() {
	if (!workerTimer) {
		return;
	}
	clearInterval(workerTimer);
	workerTimer = null;
	syncLog('info', 'Facebook analytics sync stopped');
}
