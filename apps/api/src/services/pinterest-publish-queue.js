import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import {
	createPinterestPin,
	ensureValidPinterestAccessToken,
	getOwnedPinterestAccountById,
	getPinterestPinPublicUrl,
	markPinterestAccountStatus,
	normalizePinterestError,
	refreshPinterestAccessToken,
} from './pinterest-api.js';
import { decryptSecret } from '../utils/secretCrypto.js';

const POLL_INTERVAL_MS = Number.parseInt(process.env.PINTEREST_QUEUE_POLL_MS || '15000', 10);
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.PINTEREST_QUEUE_BATCH || '10', 10);

let workerTimer = null;
let running = false;
let processedTotal = 0;
let failedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';

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

async function processJob(job) {
	const owner = job.owner;

	const pin = await pocketbaseClient.collection('ai_pins').getOne(job.ai_pin).catch(() => null);
	if (!pin || pin.owner !== owner) {
		throw httpError(404, 'Associated AI pin was not found');
	}

	const account = await getOwnedPinterestAccountById({ owner, accountId: job.account });
	if (!account?.connected) {
		throw httpError(401, 'Pinterest account is not connected');
	}

	const imageUrl = extractPinImageUrl(pin);
	if (!imageUrl) {
		throw httpError(422, 'Pin image URL is required before publishing to Pinterest');
	}

	const article = pin.articleId
		? await pocketbaseClient.collection('website_articles').getOne(pin.articleId).catch(() => null)
		: null;
	const targetLink = article?.url || '';

	let tokenState;
	try {
		tokenState = await ensureValidPinterestAccessToken({ account });
	} catch (error) {
		throw normalizePinterestError(error);
	}

	let pinterestPin;
	try {
		pinterestPin = await createPinterestPin({
			accessToken: tokenState.accessToken,
			boardId: job.board_id,
			title: pin.title || 'Untitled pin',
			description: pin.description || '',
			imageUrl,
			link: targetLink,
		});
	} catch (error) {
		if (error?.status === 401 || error?.pinterestStatus === 401) {
			await markPinterestAccountStatus({ accountId: account.id, status: 'expired', statusError: 'Access token expired' });
			const refreshed = await refreshPinterestAccessToken({ account: tokenState.account });
			const refreshedToken = decryptSecret(refreshed.access_token || '');
			if (!refreshedToken) {
				throw httpError(401, 'Pinterest access token refresh failed');
			}
			const retried = await createPinterestPin({
				accessToken: refreshedToken,
				boardId: job.board_id,
				title: pin.title || 'Untitled pin',
				description: pin.description || '',
				imageUrl,
				link: targetLink,
			});
			pinterestPin = retried;
		} else {
			throw normalizePinterestError(error);
		}
	}

	const pinterestPinId = String(pinterestPin?.id || '').trim();
	const pinterestPinUrl = getPinterestPinPublicUrl(pinterestPinId);
	const publishedAt = new Date().toISOString();

	await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, {
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
	});

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
}

function buildDuePublishJobsFilter(now) {
	return [
		pocketbaseClient.filter('status = {:status}', { status: 'scheduled' }),
		pocketbaseClient.filter('scheduled_at <= {:now}', { now }),
	].join(' && ');
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
	const filter = buildDuePublishJobsFilter(now);
	try {
		const scheduledJobs = await pocketbaseClient.collection('pinterest_publish_jobs').getFullList({
			sort: 'scheduled_at',
			filter,
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
		const now = new Date().toISOString();
		const dueJobs = await getDuePublishJobs(now);

		for (const job of dueJobs.slice(0, MAX_JOBS_PER_TICK)) {
			const locked = await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, {
				status: 'publishing',
			}).catch(() => null);

			if (!locked || locked.status !== 'publishing') {
				continue;
			}

			await markPinStatus(locked.ai_pin, {
				status: 'publishing',
				publish_error: '',
			});

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
				lastErrorMessage = normalized.message;
				logger.warn(`Pinterest publish failed for job ${locked.id}: ${normalized.message}`);
				const nextAttempts = (locked.attempt_count || 0) + 1;
				const maxAttempts = locked.max_attempts || 3;
				const exhausted = nextAttempts >= maxAttempts;
				const shouldRetry = !exhausted;
				const nextRetryAt = shouldRetry
					? nextRetryDate({ retryAfter: normalized.retryAfter || 0, attemptCount: nextAttempts })
					: null;

				await pocketbaseClient.collection('pinterest_publish_jobs').update(locked.id, {
					status: shouldRetry ? 'scheduled' : 'failed',
					attempt_count: nextAttempts,
					last_error: normalized.message,
					next_retry_at: nextRetryAt,
				});

				await markPinStatus(locked.ai_pin, {
					status: shouldRetry ? 'scheduled' : 'failed',
					publish_error: normalized.message,
				});

				await appendPublishEvent({
					owner: locked.owner,
					jobId: locked.id,
					eventType: shouldRetry ? 'retry_scheduled' : 'failed',
					message: normalized.message,
					payload: {
						attempt: nextAttempts,
						maxAttempts,
						nextRetryAt,
					},
				});
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
	const stuck = await pocketbaseClient.collection('pinterest_publish_jobs').getFullList({
		filter: 'status = "publishing"',
	});

	if (stuck.length === 0) {
		return;
	}

	const now = new Date().toISOString();
	await Promise.all(stuck.map(async (job) => {
		await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, {
			status: 'scheduled',
			next_retry_at: now,
			last_error: 'Recovered after worker restart',
		}).catch(() => null);

		await markPinStatus(job.ai_pin, {
			status: 'scheduled',
			publish_error: '',
		}).catch(() => null);
	}));

	logger.info(`Recovered ${stuck.length} publishing jobs after restart`);
}

export function getPinterestQueueStatus() {
	return {
		running,
		active: Boolean(workerTimer),
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

	workerTimer = setInterval(() => {
		processDueJobs();
	}, POLL_INTERVAL_MS);

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
