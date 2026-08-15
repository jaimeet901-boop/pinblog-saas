/**
 * Facebook Channel Pack — publish queue executor (F4-4/5).
 * Polls facebook_publish_jobs, CAS-claims, publishes via Graph client (F4-1).
 */

import { randomBytes } from 'node:crypto';
import { FACEBOOK_JOB_COLLECTION } from './channel-pack.js';
import {
	hasExistingFacebookPostId,
	normalizeFacebookGraphError,
	publishFacebookFeedPost,
	resolveFacebookPostPublicUrl,
	sanitizeFacebookGraphErrorPayload,
} from './graph-publish.js';
import {
	buildFacebookPublishClaimedEventPayload,
	buildFacebookPublishFailedEventPayload,
	buildFacebookPublishPublishedEventPayload,
	buildFacebookPublishRetryScheduledEventPayload,
	recordFacebookPublishEvent,
} from './publish-events.js';
import {
	assertFacebookQueueWorkspaceIsolation,
	buildFacebookQueuePageFilterParams,
} from './workspace-isolation.js';

const POLL_INTERVAL_MS = Number.parseInt(process.env.FACEBOOK_QUEUE_POLL_MS || '15000', 10);
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.FACEBOOK_QUEUE_BATCH || '10', 10);
const STUCK_PUBLISHING_MS = Number.parseInt(process.env.FACEBOOK_QUEUE_STUCK_MS || String(15 * 60 * 1000), 10);

let workerTimer = null;
let running = false;
let processedTotal = 0;
let failedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';
let envDisabledLogged = false;

function queueLog(level, ...args) {
	if (!process.env.PB_SUPERUSER_EMAIL) {
		const fn = console[level] || console.log;
		fn(...args);
		return;
	}
	import('../../utils/logger.js')
		.then(({ default: logger }) => logger[level](...args))
		.catch(() => {});
}

/**
 * Facebook legacy poller gate. Unset defaults to enabled.
 */
export function isFacebookQueueEnabled() {
	const raw = String(process.env.FACEBOOK_QUEUE_ENABLED ?? '').trim().toLowerCase();
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

function httpError(status, message, extras = {}) {
	const error = new Error(message);
	error.status = status;
	Object.assign(error, extras);
	return error;
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

function nextRetryDate({ retryAfter = 0, attemptCount = 1, rateLimitRetryAfterMs = 0 }) {
	const cappedAttempt = Math.max(1, Math.min(10, attemptCount));
	const fromRateLimit = rateLimitRetryAfterMs > 0
		? rateLimitRetryAfterMs
		: (retryAfter > 0 ? retryAfter * 1000 : 0);
	const backoffMs = Math.max(fromRateLimit, cappedAttempt * 60 * 1000);
	return new Date(Date.now() + backoffMs).toISOString();
}

function isRetryDue(job, nowMs) {
	if (!job?.next_retry_at) {
		return true;
	}

	const retryAt = new Date(job.next_retry_at).getTime();
	if (!Number.isFinite(retryAt)) {
		return true;
	}

	return retryAt <= nowMs;
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

async function resolveQueueDeps(deps = {}) {
	let getOwnedFacebookAccountById = deps.getOwnedFacebookAccountById;
	if (!getOwnedFacebookAccountById) {
		({ getOwnedFacebookAccountById } = await import('./api.js'));
	}

	let markFacebookAccountStatus = deps.markFacebookAccountStatus;
	if (!markFacebookAccountStatus) {
		({ markFacebookAccountStatus } = await import('./api.js'));
	}

	let validateFacebookDestinationPost = deps.validateFacebookDestinationPost;
	if (!validateFacebookDestinationPost) {
		({ validateFacebookDestinationPost } = await import('./destinations.js'));
	}

	let decryptPageTokenMap = deps.decryptPageTokenMap;
	if (!decryptPageTokenMap) {
		({ decryptPageTokenMap } = await import('./secrets.js'));
	}

	const pocketbaseClient = await resolvePocketbaseClient(deps);

	return {
		pocketbaseClient,
		getOwnedFacebookAccountById,
		markFacebookAccountStatus,
		publishFacebookFeedPost: deps.publishFacebookFeedPost || publishFacebookFeedPost,
		validateFacebookDestinationPost,
		decryptPageTokenMap,
		recordPublishEvent: deps.recordFacebookPublishEvent || recordFacebookPublishEvent,
		sanitizePayload: deps.sanitizePayload || sanitizeJobPayload,
		getFacebookPageForQueueJob: deps.getFacebookPageForQueueJob || null,
		client: pocketbaseClient,
	};
}

async function emitFacebookPublishEvent({ job, eventRecord, deps = {} }) {
	const { recordPublishEvent } = await resolveQueueDeps(deps);
	return recordPublishEvent({
		job,
		eventRecord,
		deps: {
			...deps,
			pocketbaseClient: deps.pocketbaseClient || deps.client,
			loadEventIdempotencyKeys: deps.loadEventIdempotencyKeys,
			createPublishEvent: deps.createPublishEvent,
		},
	});
}

async function sanitizeJobPayload(payload, context = 'facebook-queue:update') {
	const { sanitizeCollectionPayload } = await loadSafeQuery();
	return sanitizeCollectionPayload({
		collection: FACEBOOK_JOB_COLLECTION,
		context,
		payload,
	});
}

/**
 * Optimistic CAS claim: scheduled → publishing.
 *
 * @param {string} jobId
 * @param {object} [deps]
 */
export async function claimScheduledJob(jobId, deps = {}) {
	const { client, sanitizePayload } = await resolveQueueDeps(deps);
	const col = client.collection(FACEBOOK_JOB_COLLECTION);
	const current = await col.getOne(jobId).catch(() => null);
	if (!current || current.status !== 'scheduled') {
		return null;
	}

	const claimToken = randomBytes(16).toString('hex');
	const nextVersion = Number(current.claim_version || 0) + 1;
	const lockPayload = await sanitizePayload({
		status: 'publishing',
		claim_token: claimToken,
		claim_version: nextVersion,
	}, 'facebook-queue:lock-job');

	const locked = await col.update(jobId, lockPayload).catch(() => null);
	if (!locked || locked.status !== 'publishing') {
		return null;
	}

	const verified = await col.getOne(jobId).catch(() => null);
	if (!verified || verified.status !== 'publishing' || verified.claim_token !== claimToken) {
		return null;
	}

	return verified;
}

/**
 * Execute a claimed facebook_publish_jobs row.
 *
 * @param {object} job
 * @param {object} [deps]
 */
export async function processJob(job, deps = {}) {
	const {
		pocketbaseClient: pb,
		getOwnedFacebookAccountById,
		markFacebookAccountStatus,
		publishFacebookFeedPost: publishFeed,
		validateFacebookDestinationPost: validatePost,
		decryptPageTokenMap: decryptPages,
		recordPublishEvent,
		sanitizePayload,
		getFacebookPageForQueueJob,
	} = await resolveQueueDeps(deps);

	const owner = job.owner;
	const accountId = recordFieldId(job.account || job.accountId);
	const pageId = String(job.page_id || job.pageId || '').trim();

	if (hasExistingFacebookPostId(job.facebook_post_id)) {
		const publishedAt = job.published_at || new Date().toISOString();
		const postId = String(job.facebook_post_id).trim();
		const postUrl = String(job.facebook_post_url || '').trim() || resolveFacebookPostPublicUrl(postId, pageId);

		const publishPayload = await sanitizePayload({
			status: 'published',
			published_at: publishedAt,
			last_error: '',
			next_retry_at: null,
			facebook_post_id: postId,
			facebook_post_url: postUrl,
		}, 'facebook-queue:mark-published-idempotent');

		await pb.collection(FACEBOOK_JOB_COLLECTION).update(job.id, publishPayload);

		await emitFacebookPublishEvent({
			job,
			eventRecord: buildFacebookPublishPublishedEventPayload({
				job,
				facebookPostId: postId,
				facebookPostUrl: postUrl,
				idempotent: true,
			}),
			deps: { ...deps, pocketbaseClient: pb },
		});
		return;
	}

	const account = await getOwnedFacebookAccountById({ owner, accountId });
	const page = await loadFacebookPageForJob({
		pocketbaseClient: pb,
		owner,
		workspaceId: recordFieldId(job.workspace || job.workspace_id),
		accountId,
		pageId,
		loader: getFacebookPageForQueueJob,
	});
	assertFacebookQueueWorkspaceIsolation({ job, account, page });
	if (!account?.connected) {
		throw httpError(422, 'Facebook account is not connected', { retryable: false });
	}

	const validation = await validatePost({
		owner,
		accountId,
		pageId,
		post: {
			message: job.message,
			imageUrl: job.image_url || job.imageUrl,
			linkUrl: job.destination_url || job.destinationUrl,
		},
		deps,
	});

	if (!validation.ok) {
		throw httpError(
			422,
			validation.errors.join('; ') || 'Facebook destination validation failed',
			{ retryable: false },
		);
	}

	const pageTokens = decryptPages(account);
	const accessToken = pageTokens[pageId] || pageTokens[validation.normalized?.pageId || ''];
	if (!accessToken) {
		throw httpError(422, 'Facebook Page access token is missing', { retryable: false });
	}

	let result;
	try {
		result = await publishFeed({
			pageId: validation.normalized?.pageId || pageId,
			accessToken,
			message: job.message,
			linkUrl: job.destination_url || job.destinationUrl,
			imageUrl: job.image_url || job.imageUrl,
			fetchImpl: deps.fetchImpl,
		});
	} catch (error) {
		const normalized = normalizeFacebookGraphError(error);
		if (normalized.tokenExpired && accountId) {
			await markFacebookAccountStatus({
				accountId,
				status: 'expired',
				statusError: normalized.message,
			}).catch(() => null);
		}
		throw normalized;
	}

	const publishedAt = new Date().toISOString();
	const postId = String(result.postId || '').trim();
	const postUrl = String(result.postUrl || '').trim() || resolveFacebookPostPublicUrl(postId, pageId);

	const publishPayload = await sanitizePayload({
		status: 'published',
		attempt_count: (job.attempt_count || 0) + 1,
		published_at: publishedAt,
		last_error: '',
		next_retry_at: null,
		facebook_post_id: postId,
		facebook_post_url: postUrl,
	}, 'facebook-queue:mark-published');

	await pb.collection(FACEBOOK_JOB_COLLECTION).update(job.id, publishPayload);

	await emitFacebookPublishEvent({
		job,
		eventRecord: buildFacebookPublishPublishedEventPayload({
			job,
			facebookPostId: postId,
			facebookPostUrl: postUrl,
		}),
		deps: { ...deps, pocketbaseClient: pb },
	});

	const burnFacebookPublishCredits = deps.burnFacebookPublishCredits
		|| (await import('./facebook-publish-credits.js')).burnFacebookPublishCredits;
	await burnFacebookPublishCredits(job, { facebookPostId: postId, deps });
}

async function getDuePublishJobs(now, deps = {}) {
	if (typeof deps.loadDueJobs === 'function') {
		return deps.loadDueJobs(now);
	}

	const pb = await resolvePocketbaseClient(deps);
	const { buildSchemaSafeFilter, safeGetFullList } = await loadSafeQuery();
	const { filter, fields } = await buildSchemaSafeFilter({
		collection: FACEBOOK_JOB_COLLECTION,
		context: 'facebook-queue:due-jobs',
		parts: [
			{ field: 'status', expression: pb.filter('status = {:status}', { status: 'scheduled' }) },
			{ field: 'scheduled_at', expression: pb.filter('scheduled_at <= {:now}', { now }) },
		],
	});

	const sort = fields.has('scheduled_at') ? 'scheduled_at' : fields.has('created') ? 'created' : '';
	const scheduledJobs = await safeGetFullList({
		collection: FACEBOOK_JOB_COLLECTION,
		context: 'facebook-queue:due-jobs',
		filter,
		sort,
	});

	const nowMs = new Date(now).getTime();
	return scheduledJobs.filter((job) => isRetryDue(job, nowMs));
}

/**
 * Poll tick: load due jobs, claim, publish, retry or fail.
 *
 * @param {object} [deps]
 */
export async function processDueJobs(deps = {}) {
	if (running) {
		return;
	}

	running = true;
	lastRunAt = new Date().toISOString();
	const pb = await resolvePocketbaseClient(deps);
	const { sanitizePayload } = await resolveQueueDeps(deps);

	try {
		const now = new Date().toISOString();
		const dueJobs = await getDuePublishJobs(now, deps);

		for (const job of dueJobs.slice(0, MAX_JOBS_PER_TICK)) {
			const locked = await claimScheduledJob(job.id, deps);
			if (!locked) {
				continue;
			}

			await emitFacebookPublishEvent({
				job: locked,
				eventRecord: buildFacebookPublishClaimedEventPayload({
					job: locked,
					claimToken: locked.claim_token,
				}),
				deps: { ...deps, pocketbaseClient: pb },
			});

			try {
				await processJob(locked, deps);
				processedTotal += 1;
				lastSuccessAt = new Date().toISOString();
			} catch (error) {
				const normalized = normalizeFacebookGraphError(error);
				failedTotal += 1;
				const storedError = normalized.message || error?.message || 'Facebook publish failed';
				lastErrorMessage = storedError;
				queueLog('warn', `Facebook publish failed for job ${locked.id}`, {
					errorCode: normalized.errorCode || null,
					retryable: normalized.retryable !== false,
					message: storedError,
				});

				const nextAttempts = (locked.attempt_count || 0) + 1;
				const maxAttempts = locked.max_attempts || 3;
				const exhausted = nextAttempts >= maxAttempts;
				const shouldRetry = !exhausted && normalized.retryable !== false;
				const nextRetryAt = shouldRetry
					? nextRetryDate({
						retryAfter: normalized.retryAfter || 0,
						rateLimitRetryAfterMs: normalized.rateLimitRetryAfterMs || 0,
						attemptCount: nextAttempts,
					})
					: null;

				const retryPayload = await sanitizePayload({
					status: shouldRetry ? 'scheduled' : 'failed',
					attempt_count: nextAttempts,
					last_error: storedError,
					next_retry_at: nextRetryAt,
					...(normalized.raw
						? { raw_api_error: sanitizeFacebookGraphErrorPayload(normalized.raw) }
						: {}),
				}, 'facebook-queue:retry-update');

				await pb.collection(FACEBOOK_JOB_COLLECTION).update(locked.id, retryPayload);

				await emitFacebookPublishEvent({
					job: locked,
					eventRecord: shouldRetry
						? buildFacebookPublishRetryScheduledEventPayload({
							job: locked,
							normalizedError: normalized,
							nextRetryAt,
							attempt: nextAttempts,
							maxAttempts,
						})
						: buildFacebookPublishFailedEventPayload({
							job: locked,
							normalizedError: normalized,
							attempt: nextAttempts,
							maxAttempts,
						}),
					deps: { ...deps, pocketbaseClient: pb },
				});
			}
		}
	} catch (error) {
		lastErrorMessage = error?.message || 'Facebook queue processing failed';
		queueLog('error', 'Facebook queue processing failed:', error);
	} finally {
		running = false;
	}
}

/**
 * Re-queue jobs stuck in publishing longer than the stuck threshold.
 *
 * @param {object} [deps]
 */
export async function recoverStuckPublishingJobs(deps = {}) {
	const pb = await resolvePocketbaseClient(deps);
	const { sanitizePayload } = await resolveQueueDeps(deps);

	const stuck = typeof deps.loadStuckJobs === 'function'
		? await deps.loadStuckJobs()
		: await (async () => {
			const { buildSchemaSafeFilter, safeGetFullList } = await loadSafeQuery();
			const { filter } = await buildSchemaSafeFilter({
				collection: FACEBOOK_JOB_COLLECTION,
				context: 'facebook-queue:recover-stuck',
				parts: [{ field: 'status', expression: pb.filter('status = {:status}', { status: 'publishing' }) }],
			});
			return safeGetFullList({
				collection: FACEBOOK_JOB_COLLECTION,
				context: 'facebook-queue:recover-stuck',
				filter,
				sort: '',
			});
		})();

	if (stuck.length === 0) {
		return;
	}

	const nowMs = Date.now();
	const now = new Date(nowMs).toISOString();
	let recovered = 0;

	await Promise.all(stuck.map(async (job) => {
		const updatedAt = new Date(job.updated || job.created || 0).getTime();
		const ageMs = Number.isFinite(updatedAt) ? nowMs - updatedAt : STUCK_PUBLISHING_MS + 1;
		if (ageMs < STUCK_PUBLISHING_MS) {
			return;
		}

		if (hasExistingFacebookPostId(job.facebook_post_id)) {
			const postId = String(job.facebook_post_id).trim();
			const pageId = String(job.page_id || '').trim();
			const postUrl = String(job.facebook_post_url || '').trim() || resolveFacebookPostPublicUrl(postId, pageId);
			const publishPayload = await sanitizePayload({
				status: 'published',
				published_at: job.published_at || now,
				last_error: '',
				next_retry_at: null,
				facebook_post_id: postId,
				facebook_post_url: postUrl,
			}, 'facebook-queue:recover-published');
			await pb.collection(FACEBOOK_JOB_COLLECTION).update(job.id, publishPayload).catch(() => null);
			await emitFacebookPublishEvent({
				job,
				eventRecord: buildFacebookPublishPublishedEventPayload({
					job: { ...job, facebook_post_id: postId, facebook_post_url: postUrl },
					facebookPostId: postId,
					facebookPostUrl: postUrl,
					idempotent: true,
				}),
				deps: { ...deps, pocketbaseClient: pb },
			}).catch(() => null);
			recovered += 1;
			return;
		}

		const recoveryPayload = await sanitizePayload({
			status: 'scheduled',
			next_retry_at: now,
			last_error: 'Recovered after stuck publishing state',
		}, 'facebook-queue:recover-update');

		await pb.collection(FACEBOOK_JOB_COLLECTION).update(job.id, recoveryPayload).catch(() => null);
		await emitFacebookPublishEvent({
			job,
			eventRecord: buildFacebookPublishRetryScheduledEventPayload({
				job,
				normalizedError: {
					message: 'Recovered after stuck publishing state',
					retryable: true,
					errorCode: 'FACEBOOK_QUEUE_STUCK_RECOVERY',
				},
				nextRetryAt: now,
				attempt: (job.attempt_count || 0) + 1,
				maxAttempts: job.max_attempts || 3,
			}),
			deps: { ...deps, pocketbaseClient: pb },
		}).catch(() => null);
		recovered += 1;
	}));

	if (recovered > 0) {
		queueLog('info', `Recovered ${recovered} stuck Facebook publishing jobs`);
	}
}

export function getFacebookQueueStatus() {
	const enabled = isFacebookQueueEnabled();
	return {
		running,
		active: Boolean(workerTimer),
		enabled,
		disabledByEnv: !enabled,
		pollIntervalMs: POLL_INTERVAL_MS,
		batchSize: MAX_JOBS_PER_TICK,
		processedTotal,
		failedTotal,
		lastRunAt,
		lastSuccessAt,
		lastErrorMessage,
	};
}

export function startFacebookPublishQueue() {
	if (workerTimer) {
		return;
	}

	if (!isFacebookQueueEnabled()) {
		if (!envDisabledLogged) {
			queueLog('info', 'Facebook publish queue disabled by FACEBOOK_QUEUE_ENABLED');
			envDisabledLogged = true;
		}
		return;
	}

	workerTimer = setInterval(() => {
		processDueJobs();
	}, POLL_INTERVAL_MS);

	loadSafeQuery().then(({ verifyCollectionFields }) => {
		verifyCollectionFields({
			collection: FACEBOOK_JOB_COLLECTION,
			requiredFields: ['status', 'scheduled_at', 'next_retry_at', 'attempt_count', 'max_attempts', 'last_error'],
			context: 'facebook-queue:start-schema-check',
		}).catch(() => null);
	}).catch(() => null);

	recoverStuckPublishingJobs().finally(() => {
		processDueJobs();
	});
	queueLog('info', `Facebook publish queue started (interval ${POLL_INTERVAL_MS}ms)`);
}

export function stopFacebookPublishQueue() {
	if (!workerTimer) {
		return;
	}

	clearInterval(workerTimer);
	workerTimer = null;
	queueLog('info', 'Facebook publish queue stopped');
}
