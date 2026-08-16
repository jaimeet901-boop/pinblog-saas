import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { randomBytes } from 'node:crypto';
import {
	createPinterestPin,
	ensureValidPinterestAccessToken,
	getOwnedPinterestAccountById,
	getPinterestPinPublicUrl,
	isPinterestTrialAccessError,
	markPinterestAccountStatus,
	normalizePinterestError,
} from './pinterest-api.js';
import {
	decryptAccountRefreshToken,
	describePinterestTokenState,
} from './pinterest-secrets.js';
import {
	buildSchemaSafeFilter,
	safeGetFullList,
	sanitizeCollectionPayload,
	verifyCollectionFields,
} from '../utils/pocketbase-safe-query.js';
import { writePinterestPublishHistory } from './pinterest-publish-history.js';
import { assertPinterestQueueWorkspaceIsolation } from './pinterest-workspace-isolation.js';
import { writeQueueAudit } from './audit/write.js';
import { promoteWaitingProviderPinterestJobs } from './publish-pipeline.js';
import { notifyWorkspaceUser, logWorkflowStep } from './workspace-notify.js';
import { enqueueAnalyticsRefresh } from './analytics/refresh.js';
import { resolvePinDestinationUrl, validatePinForPinterestPublish } from '../utils/pin-publish-destination.js';
import { safeTransitionArticleLifecycle } from './article-lifecycle.js';
import { withPinterestPublishCredits } from './pinterest-publish-credits.js';

const POLL_INTERVAL_MS = Number.parseInt(process.env.PINTEREST_QUEUE_POLL_MS || '15000', 10);
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.PINTEREST_QUEUE_BATCH || '10', 10);
const STUCK_PUBLISHING_MS = Number.parseInt(process.env.PINTEREST_QUEUE_STUCK_MS || String(15 * 60 * 1000), 10);

let workerTimer = null;
let running = false;
let processedTotal = 0;
let failedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';
let envDisabledLogged = false;

/**
 * Pinterest legacy poller gate (Phase 9b). Unset defaults to enabled.
 */
export function isPinterestQueueEnabled() {
	const raw = String(process.env.PINTEREST_QUEUE_ENABLED ?? '').trim().toLowerCase();
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

async function appendPublishEvent({ owner, jobId, eventType, message, payload = null }) {
	await pocketbaseClient.collection('pinterest_publish_events').create({
		owner,
		job: jobId,
		event_type: eventType,
		message,
		payload,
	}).catch(() => {});
}

async function writePinterestPublishQueueAudit(job, eventMessage = '') {
	if (!job?.id) return null;
	if (job.status !== 'published' && job.status !== 'failed') return null;
	return writeQueueAudit({
		job: {
			id: job.id,
			owner: job.owner,
			workspace_key: job.workspace_key || '',
			type: 'pinterest_publishing',
			provider: 'Pinterest',
			status: job.status,
			source_collection: 'pinterest_publish_jobs',
			source_id: job.id,
			correlation_id: job.workflow_id ? `workflow_${job.workflow_id}` : `pinterest_${job.id}`,
			priority: 'high',
			progress: job.status === 'published' ? 100 : 0,
			credits: 0,
			duration_ms: 0,
		},
		action: job.status === 'published' ? 'Pinterest pin published' : 'Pinterest publish failed',
		severity: job.status === 'published' ? 'success' : 'error',
		result: job.status === 'published' ? 'ok' : 'failed',
		message: eventMessage || job.last_error || '',
	}).catch(() => null);
}

function nextRetryDate({ retryAfter = 0, attemptCount = 1 }) {
	const cappedAttempt = Math.max(1, Math.min(10, attemptCount));
	const fromRateLimit = retryAfter > 0 ? retryAfter * 1000 : 0;
	const backoffMs = Math.max(fromRateLimit, cappedAttempt * 60 * 1000);
	return new Date(Date.now() + backoffMs).toISOString();
}

async function markPinStatus(pinId, updates) {
	await pocketbaseClient.collection('ai_pins').update(pinId, updates).catch(() => {});
}

function extractPinImageUrl(pin) {
	return String(pin.image_url || '').trim();
}

async function claimScheduledJob(jobId) {
	const current = await pocketbaseClient.collection('pinterest_publish_jobs').getOne(jobId).catch(() => null);
	if (!current || current.status !== 'scheduled') {
		return null;
	}

	const claimToken = randomBytes(16).toString('hex');
	const nextVersion = Number(current.claim_version || 0) + 1;
	const lockPayload = await sanitizeCollectionPayload({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-queue:lock-job',
		payload: {
			status: 'publishing',
			claim_token: claimToken,
			claim_version: nextVersion,
		},
	});

	const locked = await pocketbaseClient.collection('pinterest_publish_jobs').update(jobId, lockPayload).catch(() => null);
	if (!locked || locked.status !== 'publishing') {
		return null;
	}

	// Optimistic ownership check for multi-instance workers.
	const verified = await pocketbaseClient.collection('pinterest_publish_jobs').getOne(jobId).catch(() => null);
	if (!verified || verified.status !== 'publishing' || verified.claim_token !== claimToken) {
		return null;
	}

	return verified;
}

async function processJob(job) {
	const owner = job.owner;
	const startedMs = Date.now();

	const pin = await pocketbaseClient.collection('ai_pins').getOne(job.ai_pin).catch(() => null);
	const accountId = typeof job.account === 'object'
		? String(job.account?.id || '').trim()
		: String(job.account || '').trim();
	const account = await getOwnedPinterestAccountById({ owner, accountId });
	const board = account
		? await pocketbaseClient.collection('pinterest_boards').getFirstListItem(
			pocketbaseClient.filter(
				'owner = {:owner} && workspace = {:workspace} && account = {:account} && board_id = {:boardId}',
				{
					owner,
					workspace: String(job.workspace || '').trim(),
					account: account.id,
					boardId: job.board_id,
				},
			),
		).catch(() => null)
		: null;

	const { workspaceId } = assertPinterestQueueWorkspaceIsolation({
		job,
		pin,
		account,
		board,
	});

	// Idempotency: if this job (or pin) already has a Pinterest pin id, mark published and skip create.
	const existingPinId = String(job.pinterest_pin_id || pin.pinterest_pin_id || '').trim();
	if (existingPinId) {
		const publishedAt = job.published_at || pin.published_at || new Date().toISOString();
		const pinterestPinUrl = job.pinterest_pin_url || pin.pinterest_pin_url || getPinterestPinPublicUrl(existingPinId);
		const publishPayload = await sanitizeCollectionPayload({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest-queue:mark-published-idempotent',
			payload: {
				status: 'published',
				published_at: publishedAt,
				last_error: '',
				next_retry_at: null,
				pinterest_pin_id: existingPinId,
				pinterest_pin_url: pinterestPinUrl,
			},
		});
		await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, publishPayload);
	await markPinStatus(pin.id, {
		status: 'published',
		scheduled_at: '',
		scheduled_timezone: '',
		publish_error: '',
		pinterest_pin_id: existingPinId,
		pinterest_pin_url: pinterestPinUrl,
		published_at: publishedAt,
	});
	if (pin.articleId) {
		await safeTransitionArticleLifecycle(pin.articleId, 'PUBLISHED', {
			ownerId: owner,
			source: 'pinterest_publish_queue',
			message: 'Pin already published; article marked published',
			force: true,
		});
	}
	await appendPublishEvent({
		owner,
		jobId: job.id,
		eventType: 'published',
		message: 'Pin already published; skipped duplicate create',
		payload: { pinterestPinId: existingPinId, pinterestPinUrl },
	});
		await writePinterestPublishHistory({
			owner,
			accountId: job.account,
			jobId: job.id,
			workspaceId,
			title: pin.title || 'Pin',
			boardId: job.board_id,
			boardName: job.board_name,
			result: 'published',
			pinterestPinId: existingPinId,
			pinterestPinUrl,
			publishedAt,
			durationMs: Date.now() - startedMs,
			attemptCount: job.attempt_count || 0,
			meta: { idempotent: true },
		});
		return;
	}

	const imageUrl = extractPinImageUrl(pin);
	if (!imageUrl) {
		throw httpError(422, 'Pin image URL is required before publishing to Pinterest');
	}

	const article = pin.articleId
		? await pocketbaseClient.collection('website_articles').getOne(pin.articleId).catch(() => null)
		: null;
	const publishCheck = validatePinForPinterestPublish(pin, article);
	const targetLink = publishCheck.destinationUrl
		|| resolvePinDestinationUrl(pin, article, job.destination_url);
	if (!targetLink) {
		throw httpError(422, 'Destination URL is required before publishing to Pinterest');
	}

	const pinterestPin = await withPinterestPublishCredits(job, async () => {
		logger.info('[pinterest-publish] token state before ensureValid', {
			jobId: job.id,
			...describePinterestTokenState(account),
		});

		let tokenState;
		try {
			tokenState = await ensureValidPinterestAccessToken({ account });
		} catch (error) {
			logger.error('[pinterest-publish] ensureValid failed', {
				jobId: job.id,
				accountId: account.id,
				message: error?.message || 'ensureValid failed',
				status: error?.status || null,
			});
			throw normalizePinterestError(error);
		}

		logger.info('[pinterest-publish] token ready for createPin', {
			jobId: job.id,
			usedRefresh: Boolean(tokenState.usedRefresh),
			...describePinterestTokenState(tokenState.account, {
				accessToken: tokenState.accessToken,
				refreshToken: decryptAccountRefreshToken(tokenState.account),
			}),
		});

		try {
			return await createPinterestPin({
				accessToken: tokenState.accessToken,
				boardId: job.board_id,
				title: pin.title || 'Untitled pin',
				description: pin.description || '',
				imageUrl,
				link: targetLink,
				account: tokenState.account || account,
			});
		} catch (error) {
			if (isPinterestTrialAccessError(error)) {
				throw normalizePinterestError(error);
			}
			if (error?.status === 401 || error?.pinterestStatus === 401) {
				logger.warn('[pinterest-publish] createPin returned 401 — forcing refresh then retry', {
					jobId: job.id,
					accountId: account.id,
					tokenUsed: describePinterestTokenState(tokenState.account, {
						accessToken: tokenState.accessToken,
					}),
					pinterestDiagnostics: error?.pinterestDiagnostics || null,
				});

				// Re-load secrets from DB so we never retry with the rejected access token.
				// Do not mark expired until refresh+retry both fail — reconnect may have just landed.
				const freshAccount = await getOwnedPinterestAccountById({ owner, accountId: account.id });
				try {
					const forced = await ensureValidPinterestAccessToken({ account: freshAccount, forceRefresh: true });
					const refreshed = forced.account;
					const refreshedToken = forced.accessToken;
					logger.info('[pinterest-publish] retrying createPin with refreshed token', {
						jobId: job.id,
						accountId: account.id,
						...describePinterestTokenState(refreshed, { accessToken: refreshedToken }),
						usedRefresh: true,
					});
					return await createPinterestPin({
						accessToken: refreshedToken,
						boardId: job.board_id,
						title: pin.title || 'Untitled pin',
						description: pin.description || '',
						imageUrl,
						link: targetLink,
						account: refreshed || freshAccount,
					});
				} catch (refreshError) {
					await markPinterestAccountStatus({
						accountId: account.id,
						status: 'expired',
						statusError: refreshError?.message || 'Access token expired',
					});
					logger.error('[pinterest-publish] refresh/retry after 401 failed', {
						jobId: job.id,
						accountId: account.id,
						message: refreshError?.message || 'refresh failed',
					});
					throw normalizePinterestError(refreshError);
				}
			}
			throw normalizePinterestError(error);
		}
	}, {
		getWorkspace: async (workspaceId) => (
			pocketbaseClient.collection('workspaces').getOne(workspaceId).catch(() => null)
		),
	});

	const pinterestPinId = String(pinterestPin?.id || '').trim();
	const pinterestPinUrl = getPinterestPinPublicUrl(pinterestPinId);
	const publishedAt = new Date().toISOString();

	const publishPayload = await sanitizeCollectionPayload({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-queue:mark-published',
		payload: {
			status: 'published',
			attempt_count: (job.attempt_count || 0) + 1,
			published_at: publishedAt,
			last_error: '',
			next_retry_at: null,
			pinterest_pin_id: pinterestPinId,
			pinterest_pin_url: pinterestPinUrl,
			performance: {
				impressions: null,
				saves: null,
				outboundClicks: null,
				closeups: null,
				readyForAnalyticsSync: true,
			},
		},
	});

	await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, publishPayload);

	await markPinStatus(pin.id, {
		status: 'published',
		scheduled_at: '',
		scheduled_timezone: '',
		publish_error: '',
		pinterest_account_id: job.account,
		pinterest_account_label: job.account_label || '',
		published_at: publishedAt,
		pinterest_pin_id: pinterestPinId,
		pinterest_pin_url: pinterestPinUrl,
		pinterest_board_id: job.board_id,
		pinterest_board_name: job.board_name,
		performance: {
			impressions: null,
			saves: null,
			outboundClicks: null,
			closeups: null,
			readyForAnalyticsSync: true,
		},
	});

	if (pin.articleId) {
		await safeTransitionArticleLifecycle(pin.articleId, 'PUBLISHED', {
			ownerId: owner,
			source: 'pinterest_publish_queue',
			message: 'Pin published successfully',
			force: true,
		});
	}

	await appendPublishEvent({
		owner,
		jobId: job.id,
		eventType: 'published',
		message: 'Pin published successfully',
		payload: {
			pinterestPinId,
			pinterestPinUrl,
		},
	});

	await writePinterestPublishHistory({
		owner,
		accountId: job.account,
		jobId: job.id,
		workspaceId,
		title: pin.title || 'Pin',
		boardId: job.board_id,
		boardName: job.board_name,
		result: 'published',
		pinterestPinId,
		pinterestPinUrl,
		publishedAt,
		durationMs: Date.now() - startedMs,
		attemptCount: (job.attempt_count || 0) + 1,
	});

	await writePinterestPublishQueueAudit({
		...job,
		status: 'published',
		attempt_count: (job.attempt_count || 0) + 1,
		published_at: publishedAt,
		pinterest_pin_id: pinterestPinId,
		pinterest_pin_url: pinterestPinUrl,
		last_error: '',
	}, 'Pinterest pin published');

	const isRetrySuccess = Number(job.attempt_count || 0) > 0;
	await notifyWorkspaceUser({
		ownerId: owner,
		title: isRetrySuccess
			? 'Retry completed — Pinterest pin published'
			: 'Pinterest pin published',
		body: pinterestPinUrl || `${pin.title || 'Pin'} published successfully`,
		priority: 'normal',
		meta: {
			type: isRetrySuccess ? 'publishing_completed' : 'publishing_completed',
			event: 'publishing_completed',
			provider: 'pinterest',
			jobId: job.id,
			pinterestPinId,
		},
	}).catch(() => null);

	await logWorkflowStep({
		ownerId: owner,
		action: 'workflow.pinterest_publish',
		resourceType: 'pinterest_publish_jobs',
		resourceId: job.id,
		metadata: { pinterestPinId, pinterestPinUrl, workflowId: job.workflow_id || '' },
	}).catch(() => null);

	await enqueueAnalyticsRefresh(owner, {
		workspaceKey: job.workspace_key || '',
	}).catch(() => null);
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

async function getDuePublishJobs(now) {
	const { filter, fields } = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-queue:due-jobs',
		parts: [
			{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'scheduled' }) },
			{ field: 'scheduled_at', expression: pocketbaseClient.filter('scheduled_at <= {:now}', { now }) },
		],
	});

	const sort = fields.has('scheduled_at') ? 'scheduled_at' : fields.has('created') ? 'created' : '';
	try {
		const scheduledJobs = await safeGetFullList({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest-queue:due-jobs',
			filter,
			sort,
		});

		const nowMs = new Date(now).getTime();
		return scheduledJobs.filter((job) => isRetryDue(job, nowMs));
	} catch (error) {
		logger.error('Pinterest queue due-jobs query failed', {
			filter,
			now,
			status: error?.status,
			message: error?.message,
			response: error?.response?.data || error?.response || null,
		});
		throw error;
	}
}

async function processDueJobs() {
	if (running) {
		return;
	}

	running = true;
	lastRunAt = new Date().toISOString();
	try {
		await promoteWaitingProviderPinterestJobs({ limit: MAX_JOBS_PER_TICK }).catch((error) => {
			logger.warn(`Pinterest waiting-provider promote failed: ${error.message}`);
		});
		const now = new Date().toISOString();
		const dueJobs = await getDuePublishJobs(now);

		for (const job of dueJobs.slice(0, MAX_JOBS_PER_TICK)) {
			const locked = await claimScheduledJob(job.id);
			if (!locked) {
				continue;
			}

			await markPinStatus(locked.ai_pin, {
				status: 'publishing',
				publish_error: '',
			});

			const claimedPin = await pocketbaseClient.collection('ai_pins').getOne(locked.ai_pin).catch(() => null);
			if (claimedPin?.articleId) {
				await safeTransitionArticleLifecycle(claimedPin.articleId, 'SCHEDULED', {
					ownerId: locked.owner,
					source: 'pinterest_publish_queue',
					message: 'Publish job claimed / in progress',
					force: true,
					allowSame: true,
				});
			}

			await appendPublishEvent({
				owner: locked.owner,
				jobId: locked.id,
				eventType: 'publishing',
				message: 'Publishing job started',
			});

			try {
				await processJob(locked);
				processedTotal += 1;
				lastSuccessAt = new Date().toISOString();
			} catch (error) {
				const normalized = normalizePinterestError(error);
				failedTotal += 1;
				const storedError = normalized.message;
				lastErrorMessage = storedError;
				logger.warn(`Pinterest publish failed for job ${locked.id}`, {
					errorCode: normalized.errorCode || null,
					retryable: normalized.retryable !== false,
					pinterestDiagnostics: normalized.pinterestDiagnostics || null,
					message: storedError,
				});
				const nextAttempts = (locked.attempt_count || 0) + 1;
				const maxAttempts = locked.max_attempts || 3;
				const exhausted = nextAttempts >= maxAttempts;
				const shouldRetry = !exhausted && normalized.retryable !== false;
				const nextRetryAt = shouldRetry
					? nextRetryDate({ retryAfter: normalized.retryAfter || 0, attemptCount: nextAttempts })
					: null;

				const retryPayload = await sanitizeCollectionPayload({
					collection: 'pinterest_publish_jobs',
					context: 'pinterest-queue:retry-update',
					payload: {
						status: shouldRetry ? 'scheduled' : 'failed',
						attempt_count: nextAttempts,
						last_error: storedError,
						next_retry_at: nextRetryAt,
					},
				});

				await pocketbaseClient.collection('pinterest_publish_jobs').update(locked.id, retryPayload);

				if (!shouldRetry) {
					await writePinterestPublishQueueAudit({
						...locked,
						status: 'failed',
						attempt_count: nextAttempts,
						last_error: storedError,
						next_retry_at: nextRetryAt,
					}, 'Pinterest publish failed');
				}

				await markPinStatus(locked.ai_pin, {
					status: shouldRetry ? 'scheduled' : 'failed',
					publish_error: storedError,
				});

				await appendPublishEvent({
					owner: locked.owner,
					jobId: locked.id,
					eventType: shouldRetry ? 'retry_scheduled' : 'failed',
					message: storedError,
					payload: {
						attempt: nextAttempts,
						maxAttempts,
						nextRetryAt,
						errorCode: normalized.errorCode || null,
						retryable: normalized.retryable !== false,
						pinterestDiagnostics: normalized.pinterestDiagnostics || null,
						rawResponseBody: normalized.rawResponseBody || null,
					},
				});

				await notifyWorkspaceUser({
					ownerId: locked.owner,
					title: shouldRetry ? 'Pinterest publish retrying' : 'Pinterest publish failed',
					body: normalized.message,
					priority: shouldRetry ? 'low' : 'high',
					meta: {
						type: 'publishing_failed',
						event: 'publishing_failed',
						provider: 'pinterest',
						jobId: locked.id,
						retrying: shouldRetry,
					},
				}).catch(() => null);

				if (!shouldRetry) {
					await writePinterestPublishHistory({
						owner: locked.owner,
						accountId: locked.account,
						jobId: locked.id,
						workspaceId: locked.workspace || '',
						title: '',
						boardId: locked.board_id,
						boardName: locked.board_name,
						result: 'failed',
						error: normalized.message,
						attemptCount: nextAttempts,
						publishedAt: new Date().toISOString(),
						meta: {
							maxAttempts,
							pinterestDiagnostics: normalized.pinterestDiagnostics || null,
							rawResponseBody: normalized.rawResponseBody || null,
						},
					});
					const failedPin = await pocketbaseClient.collection('ai_pins').getOne(locked.ai_pin).catch(() => null);
					if (failedPin?.articleId) {
						await safeTransitionArticleLifecycle(failedPin.articleId, 'FAILED', {
							ownerId: locked.owner,
							source: 'pinterest_publish_queue',
							message: storedError,
							failureReason: storedError,
							failedStage: 'SCHEDULED',
							force: true,
						});
					}
					await enqueueAnalyticsRefresh(locked.owner, {
						workspaceKey: locked.workspace_key || '',
					}).catch(() => null);
				}
			}
		}
	} catch (error) {
		lastErrorMessage = error?.message || 'Queue processing failed';
		logger.error('Pinterest queue processing failed:', error);
	} finally {
		running = false;
	}
}

async function recoverStuckPublishingJobs() {
	const { filter } = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-queue:recover-stuck',
		parts: [{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'publishing' }) }],
	});
	const stuck = await safeGetFullList({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest-queue:recover-stuck',
		filter,
		sort: '',
	});

	if (stuck.length === 0) {
		return;
	}

	const nowMs = Date.now();
	const now = new Date(nowMs).toISOString();
	let recovered = 0;

	await Promise.all(stuck.map(async (job) => {
		// Only recover jobs stuck longer than the threshold to avoid interrupting an active publish.
		const updatedAt = new Date(job.updated || job.created || 0).getTime();
		const ageMs = Number.isFinite(updatedAt) ? nowMs - updatedAt : STUCK_PUBLISHING_MS + 1;
		if (ageMs < STUCK_PUBLISHING_MS) {
			return;
		}

		// Already published remotely — finalize instead of republishing.
		if (String(job.pinterest_pin_id || '').trim()) {
			const publishPayload = await sanitizeCollectionPayload({
				collection: 'pinterest_publish_jobs',
				context: 'pinterest-queue:recover-published',
				payload: {
					status: 'published',
					published_at: job.published_at || now,
					last_error: '',
					next_retry_at: null,
				},
			});
			await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, publishPayload).catch(() => null);
			await markPinStatus(job.ai_pin, {
				status: 'published',
				publish_error: '',
				pinterest_pin_id: job.pinterest_pin_id,
				pinterest_pin_url: job.pinterest_pin_url || '',
			}).catch(() => null);
			recovered += 1;
			return;
		}

		const recoveryPayload = await sanitizeCollectionPayload({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest-queue:recover-update',
			payload: {
				status: 'scheduled',
				next_retry_at: now,
				last_error: 'Recovered after stuck publishing state',
			},
		});

		await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, recoveryPayload).catch(() => null);

		await markPinStatus(job.ai_pin, {
			status: 'scheduled',
			publish_error: '',
		}).catch(() => null);
		recovered += 1;
	}));

	if (recovered > 0) {
		logger.info(`Recovered ${recovered} stuck publishing jobs`);
	}
}

export function getPinterestQueueStatus() {
	const enabled = isPinterestQueueEnabled();
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

export function startPinterestPublishQueue() {
	if (workerTimer) {
		return;
	}

	if (!isPinterestQueueEnabled()) {
		if (!envDisabledLogged) {
			logger.info('Pinterest publish queue disabled by PINTEREST_QUEUE_ENABLED');
			envDisabledLogged = true;
		}
		return;
	}

	workerTimer = setInterval(() => {
		processDueJobs();
	}, POLL_INTERVAL_MS);

	verifyCollectionFields({
		collection: 'pinterest_publish_jobs',
		requiredFields: ['status', 'scheduled_at', 'next_retry_at', 'attempt_count', 'max_attempts', 'last_error'],
		context: 'pinterest-queue:start-schema-check',
	}).catch(() => null);

	verifyCollectionFields({
		collection: 'websites',
		requiredFields: ['owner', 'url', 'domain', 'discovery_status', 'status'],
		context: 'websites-schema-check',
	}).catch(() => null);

	recoverStuckPublishingJobs().finally(() => {
		processDueJobs();
	});
	logger.info(`Pinterest publish queue started (interval ${POLL_INTERVAL_MS}ms)`);
}

export function stopPinterestPublishQueue() {
	if (!workerTimer) {
		return;
	}

	clearInterval(workerTimer);
	workerTimer = null;
	logger.info('Pinterest publish queue stopped');
}
