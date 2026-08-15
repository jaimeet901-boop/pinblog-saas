import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getPublicFileUrl } from '../utils/public-file-url.js';
import logger from '../utils/logger.js';
import { generateImagesWithProvider } from './image-providers/index.js';
import { consumeCredits, recordGenerationHistory } from './ai-pin-credits.js';
import { userSafeImageError } from './ai-user-safe-errors.js';
import {
	buildSchemaSafeFilter,
	clearCollectionSchemaCache,
	extractCollectionFieldNames,
	safeGetFullList,
	sanitizeCollectionPayload,
	verifyCollectionFields,
} from '../utils/pocketbase-safe-query.js';
import { claimJobByCas } from './queue/claim.js';
import { assertJobPinOwnership } from './queue/job-ownership.js';
import { isImmediateImageFallbackError } from '../constants/image-source-strategy.js';
import { safeTransitionArticleLifecycle } from './article-lifecycle.js';
import { buildBackgroundImagePrompt } from './ai-pin-background-prompt.js';
import {
	resolveImageGenerationTargetFromPayload,
} from './image-generation-target.js';

function parsePositiveIntMs(raw, fallback) {
	const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvPollValue(name) {
	const raw = process.env[name];
	if (raw === undefined || String(raw).trim() === '') {
		return undefined;
	}
	return raw;
}

/**
 * Active poll interval (when due jobs exist).
 * Resolution order: AI_IMAGE_QUEUE_ACTIVE_POLL_MS -> AI_IMAGE_QUEUE_POLL_MS -> 3000.
 *
 * @deprecated AI_IMAGE_QUEUE_POLL_MS - legacy single-interval knob from pre-adaptive worker.
 * Kept for backward compatibility only; prefer AI_IMAGE_QUEUE_ACTIVE_POLL_MS in new deployments.
 */
function resolveActivePollIntervalMs() {
	const activeRaw = readEnvPollValue('AI_IMAGE_QUEUE_ACTIVE_POLL_MS')
		?? readEnvPollValue('AI_IMAGE_QUEUE_POLL_MS');
	return parsePositiveIntMs(activeRaw, 3000);
}

/** Idle poll interval (no due jobs). Resolution order: AI_IMAGE_QUEUE_IDLE_POLL_MS -> 12000. */
function resolveIdlePollIntervalMs() {
	return parsePositiveIntMs(readEnvPollValue('AI_IMAGE_QUEUE_IDLE_POLL_MS'), 12000);
}

function resolveActivePollIntervalSource() {
	if (readEnvPollValue('AI_IMAGE_QUEUE_ACTIVE_POLL_MS') !== undefined) {
		return 'AI_IMAGE_QUEUE_ACTIVE_POLL_MS';
	}
	if (readEnvPollValue('AI_IMAGE_QUEUE_POLL_MS') !== undefined) {
		return 'AI_IMAGE_QUEUE_POLL_MS';
	}
	return 'default';
}

const ACTIVE_POLL_INTERVAL_MS = resolveActivePollIntervalMs();
const IDLE_POLL_INTERVAL_MS = resolveIdlePollIntervalMs();
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.AI_IMAGE_QUEUE_BATCH || '5', 10);
const JOB_TIMEOUT_MS = Number.parseInt(process.env.AI_IMAGE_JOB_TIMEOUT_MS || '180000', 10);
const STUCK_PROCESSING_MS = Number.parseInt(process.env.AI_IMAGE_QUEUE_STUCK_MS || '900000', 10);

let workerTimer = null;
let currentPollIntervalMs = ACTIVE_POLL_INTERVAL_MS;
let pollLoopActive = false;
let running = false;
let processedTotal = 0;
let failedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';
let envDisabledLogged = false;

/**
 * AI pin image legacy poller gate (Phase 9c). Unset defaults to enabled.
 */
export function isAIPinImageQueueEnabled() {
	const raw = String(process.env.AI_PIN_IMAGE_QUEUE_ENABLED ?? '').trim().toLowerCase();
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

function normalizeText(value, max = 0) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!max || text.length <= max) {
		return text;
	}
	return text.slice(0, max);
}

function buildJobBackgroundImagePrompt(job) {
	const payload = job.prompt_payload || {};
	const generationTarget = resolveImageGenerationTargetFromPayload(payload.generationTarget, {
		channel: payload.channel,
		exportProfileId: payload.exportProfileId,
	});
	return buildBackgroundImagePrompt({
		category: payload.category || '',
		keywords: Array.isArray(payload.keywords) ? payload.keywords : [],
		imagePrompt: payload.imagePrompt || '',
		recipeContext: payload.metaDescription || '',
		channel: payload.channel || '',
		exportProfileId: payload.exportProfileId || '',
		generationTarget,
	});
}

async function uploadGeneratedImage({ owner, bytes, contentType = 'image/png' }) {
	const fileName = `pin-${owner}-${Date.now()}.png`;
	const formData = new FormData();
	const blob = new Blob([bytes], { type: contentType });
	formData.append('file', blob, fileName);

	const record = await pocketbaseClient.collection('_integratedAiImages').create(formData);
	return getPublicFileUrl(record, record.file);
}

async function generateOpenAIImage({ apiKey, prompt }) {
	const images = await generateImagesWithProvider({
		provider: 'openai',
		apiKeys: { openai: apiKey },
		prompt,
		count: 1,
	});
	return images[0];
}

/**
 * Load the job's pin and assert owner + workspace match the executing job.
 * Throws on mismatch so workers never mutate another workspace's pin.
 */
async function assertAndGetJobPin(job) {
	if (!job?.ai_pin) return null;
	const pin = await pocketbaseClient.collection('ai_pins').getOne(job.ai_pin).catch(() => null);
	return assertJobPinOwnership(job, pin);
}

async function setJobTerminalState({
	job,
	status,
	imageUrl = '',
	lastError = '',
	skipPinUpdate = false,
}) {
	const completedAt = new Date().toISOString();
	const payload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'ai-image-queue:set-terminal-state',
		payload: {
			status,
			image_url: imageUrl,
			last_error: lastError,
			completed_at: completedAt,
			next_retry_at: null,
			claim_token: '',
		},
	});

	await pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, payload);

	if (job.ai_pin && !skipPinUpdate) {
		try {
			await assertAndGetJobPin(job);
			await pocketbaseClient.collection('ai_pins').update(job.ai_pin, {
				image_url: imageUrl,
				image_source: status === 'fallback' ? 'featured_fallback' : 'ai_generated',
				image_generation_status: status,
				image_generation_error: lastError,
				image_job_id: job.id,
			}).catch(() => null);
		} catch (error) {
			logger.error(`Refusing pin update for image job ${job.id}: ${error.message}`);
		}
	}

	if (job.articleId) {
		const ownerId = typeof job.owner === 'string' ? job.owner : (job.owner?.id || '');
		if (status === 'failed') {
			await safeTransitionArticleLifecycle(job.articleId, 'FAILED', {
				ownerId,
				source: 'ai_pin_image_queue',
				message: lastError || 'Pin image generation failed',
				failureReason: lastError || 'Pin image generation failed',
				failedStage: 'PINS_GENERATING',
				force: true,
			});
		} else {
			await safeTransitionArticleLifecycle(job.articleId, 'PINS_READY', {
				ownerId,
				source: 'ai_pin_image_queue',
				message: status === 'fallback'
					? 'Pins ready (fallback image)'
					: 'Pins generated',
				force: true,
			});
			await safeTransitionArticleLifecycle(job.articleId, 'READY_FOR_PUBLISH', {
				ownerId,
				source: 'ai_pin_image_queue',
				message: 'Article ready for publish',
				force: true,
			});
		}
	}

	// Module 7: advance linked pin-generation run (templates untouched).
	const promptPayload = readJobPromptPayload(job);
	const generationRunId = promptPayload.generationRunId || promptPayload.generation_run_id || '';
	if (generationRunId) {
		const { onImageJobFinishedForRun } = await import('./pin-generation.js');
		await onImageJobFinishedForRun({
			runId: generationRunId,
			status,
			imageUrl,
			lastError,
		}).catch((err) => {
			logger.warn('[ai-image-queue] generation run notify failed', {
				runId: generationRunId,
				error: err?.message,
			});
		});
	}
}

const IMAGE_PROVIDER_MARKER_RE = /\[pinblog_image_provider:([a-z0-9_-]+)\]/i;

function dumpProviderTrace(label, data) {
	const payload = {
		label,
		at: new Date().toISOString(),
		...data,
	};
	console.log(`[INFO] ${label} ${JSON.stringify(payload)}`);
	logger.info(label, payload);
}

function readJobPromptPayload(job) {
	let raw = job?.prompt_payload;
	if (Buffer.isBuffer(raw)) {
		raw = raw.toString('utf8');
	}
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw);
		} catch {
			raw = {};
		}
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {};
	}
	return raw;
}

function readProviderFromPromptMarker(prompt) {
	const match = String(prompt || '').match(IMAGE_PROVIDER_MARKER_RE);
	return match?.[1] ? String(match[1]).trim().toLowerCase() : '';
}

async function processJob(job) {
	if (job.ai_pin) {
		await assertAndGetJobPin(job);
	}

	const fallbackImage = normalizeText(job.featured_image_url, 1000);

	if (job.image_mode === 'use_featured') {
		if (!fallbackImage) {
			throw new Error('Featured image is not available for fallback mode');
		}
		await setJobTerminalState({
			job,
			status: 'completed',
			imageUrl: fallbackImage,
			lastError: '',
		});
		return;
	}

	const {
		getPlatformProviderApiKey,
		resolveAdminConfiguredImageProvider,
	} = await import('./ai-providers.js');
	const { getPlatformSettings } = await import('./platform-settings.js');

	const promptPayload = readJobPromptPayload(job);
	dumpProviderTrace('[ai-pin-image-queue] before assertImageProviderConfigured', {
		jobId: job.id,
		'job.image_provider': job.image_provider ?? null,
		'job.provider': job.provider ?? null,
		'prompt_payload.provider': promptPayload.provider ?? null,
		promptMarker: readProviderFromPromptMarker(job.prompt) || null,
		prompt_payload_full: promptPayload,
		prompt_payload_raw_type: typeof job.prompt_payload,
	});

	// Legacy job metadata can contain a user-selected provider. It is never trusted:
	// execution always follows the current Admin-controlled platform default.
	const readyProvider = await resolveAdminConfiguredImageProvider();

	const provider = readyProvider.code;

	dumpProviderTrace('[ai-pin-image-queue] after assertImageProviderConfigured', {
		jobId: job.id,
		resolvedProvider: provider,
		providerName: readyProvider.name || null,
		providerCode: readyProvider.code || null,
		'job.image_provider': job.image_provider ?? null,
		'prompt_payload.provider': promptPayload.provider ?? null,
	});

	const openaiKey = await getPlatformProviderApiKey('openai');
	const falKey = await getPlatformProviderApiKey('fal');
	const geminiKey = await getPlatformProviderApiKey('gemini');

	if (provider === 'openai' && !openaiKey) {
		if (fallbackImage) {
			await setJobTerminalState({
				job,
				status: 'fallback',
				imageUrl: fallbackImage,
				lastError: userSafeImageError({ status: 'fallback', hasError: true }),
			});
			return;
		}
		throw new Error('Image generation is unavailable');
	}

	if ((provider === 'fal' || provider === 'flux') && !falKey) {
		if (fallbackImage) {
			await setJobTerminalState({
				job,
				status: 'fallback',
				imageUrl: fallbackImage,
				lastError: userSafeImageError({ status: 'fallback', hasError: true }),
			});
			return;
		}
		throw new Error('Image generation is unavailable');
	}

	if (provider === 'gemini' && !geminiKey) {
		if (fallbackImage) {
			await setJobTerminalState({
				job,
				status: 'fallback',
				imageUrl: fallbackImage,
				lastError: userSafeImageError({ status: 'fallback', hasError: true }),
			});
			return;
		}
		throw new Error('Image generation is unavailable');
	}

	if (!['openai', 'fal', 'flux', 'gemini'].includes(provider)
		&& !falKey && !openaiKey && !geminiKey) {
		if (fallbackImage) {
			await setJobTerminalState({
				job,
				status: 'fallback',
				imageUrl: fallbackImage,
				lastError: userSafeImageError({ status: 'fallback', hasError: true }),
			});
			return;
		}
		throw new Error('Image generation is unavailable');
	}

	const { settings } = await getPlatformSettings().catch(() => ({ settings: null }));
	const preferredModelId = normalizeText(
		settings?.images?.defaultImageModel
		|| '',
		120,
	);

	const prompt = normalizeText(job.prompt, 5000) || buildJobBackgroundImagePrompt({
		...job,
		prompt_payload: promptPayload,
	});

	const generationTarget = resolveImageGenerationTargetFromPayload(promptPayload.generationTarget, {
		channel: promptPayload.channel,
		exportProfileId: promptPayload.exportProfileId,
	});

	dumpProviderTrace('[ai-pin-image-queue] Final provider passed to image-providers registry', {
		jobId: job.id,
		provider,
		providerName: readyProvider.name || null,
		preferredModelId: preferredModelId || null,
		'job.image_provider': job.image_provider ?? null,
		'prompt_payload.provider': promptPayload.provider ?? null,
		channel: promptPayload.channel ?? null,
		exportProfileId: promptPayload.exportProfileId ?? null,
		generationTarget: {
			aspectRatio: generationTarget.aspectRatio,
			openaiSize: generationTarget.openaiSize,
			falImageSize: generationTarget.falImageSize,
			geminiAspectRatio: generationTarget.geminiAspectRatio,
		},
	});

	const generatedList = await generateImagesWithProvider({
		provider,
		apiKeys: { openai: openaiKey, fal: falKey, gemini: geminiKey },
		prompt,
		count: 1,
		preferredModelId,
		baseUrl: readyProvider.config?.baseUrl || readyProvider.endpoint || undefined,
		timeoutMs: readyProvider.timeoutMs || undefined,
		generationTarget,
	});
	const generated = generatedList[0];
	if (!generated) {
		throw new Error('Image provider returned no output');
	}

	await consumeCredits(pocketbaseClient, {
		userId: job.owner,
		workspaceKey: job.workspace_key || job.workspaceKey || '',
		ai: 0,
		image: 1,
	}).catch((error) => {
		if (error?.status === 402) {
			throw error;
		}
	});

	const imageUrl = await uploadGeneratedImage({ owner: job.owner, ...generated });

	await setJobTerminalState({
		job,
		status: 'completed',
		imageUrl,
		lastError: '',
	});

	await recordGenerationHistory(pocketbaseClient, {
		owner: job.owner,
		ai_pin: job.ai_pin || '',
		articleId: job.articleId || '',
		websiteId: job.websiteId || '',
		event_type: 'image',
		prompt,
		image_url: imageUrl,
		metadata: {
			provider,
			jobId: job.id,
			model: generated.model || '',
		},
		ai_credits_used: 0,
		image_credits_used: 1,
	});
}

function nextRetryDate(attemptCount) {
	const capped = Math.max(1, Math.min(5, attemptCount));
	const ms = capped * 60 * 1000;
	return new Date(Date.now() + ms).toISOString();
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

async function getDueImageJobs(now) {
	const { filter, fields } = await buildSchemaSafeFilter({
		collection: 'ai_pin_image_jobs',
		context: 'ai-image-queue:due-jobs',
		parts: [{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'queued' }) }],
	});

	const sort = fields.has('created') ? 'created' : '';
	try {
		const queuedJobs = await safeGetFullList({
			collection: 'ai_pin_image_jobs',
			context: 'ai-image-queue:due-jobs',
			filter,
			sort,
		});

		const nowMs = new Date(now).getTime();
		return queuedJobs.filter((job) => isRetryDue(job, nowMs));
	} catch (error) {
		logger.error('AI image queue due-jobs query failed', {
			filter,
			now,
			status: error?.status,
			message: error?.message,
			response: error?.response?.data || error?.response || null,
		});
		throw error;
	}
}

function withTimeout(promise, ms, label) {
	let timer;
	return Promise.race([
		Promise.resolve(promise).finally(() => {
			if (timer) clearTimeout(timer);
		}),
		new Promise((_, reject) => {
			timer = setTimeout(() => {
				reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
			}, ms);
		}),
	]);
}

async function claimImageJob(jobId) {
	const current = await pocketbaseClient.collection('ai_pin_image_jobs').getOne(jobId).catch(() => null);
	if (!current || current.status !== 'queued') {
		return null;
	}
	if (current.next_retry_at && new Date(current.next_retry_at).getTime() > Date.now()) {
		return null;
	}

	return claimJobByCas({
		collection: 'ai_pin_image_jobs',
		jobId,
		claimableStatuses: ['queued'],
		claimedStatus: 'processing',
		sanitize: async (payload) => sanitizeCollectionPayload({
			collection: 'ai_pin_image_jobs',
			context: 'ai-image-queue:lock-job',
			payload,
		}),
	});
}

async function processDueJobs() {
	if (running) {
		return false;
	}

	running = true;
	lastRunAt = new Date().toISOString();
	let hasQueueWork = false;

	try {
		await recoverStuckProcessingJobs({ onlyOlderThanMs: STUCK_PROCESSING_MS }).catch((error) => {
			logger.warn('AI image stuck-job recovery failed', { message: error?.message });
		});

		const now = new Date().toISOString();
		const dueJobs = await getDueImageJobs(now);
		hasQueueWork = dueJobs.length > 0;

		for (const job of dueJobs.slice(0, MAX_JOBS_PER_TICK)) {
			const claimed = await claimImageJob(job.id);
			if (!claimed) {
				continue;
			}

			// Re-fetch full record so prompt_payload.provider is never dropped by a partial update response.
			const fullJob = await pocketbaseClient.collection('ai_pin_image_jobs').getOne(claimed.id).catch(() => claimed);

			// Re-confirm CAS ownership before side effects (another instance may have overwritten the claim).
			if (String(fullJob.claim_token || '') !== String(claimed.claim_token || '')) {
				continue;
			}

			if (fullJob.ai_pin) {
				try {
					await assertAndGetJobPin(fullJob);
				} catch (ownershipError) {
					await setJobTerminalState({
						job: fullJob,
						status: 'failed',
						lastError: ownershipError?.message || 'Pin ownership does not match job workspace',
						skipPinUpdate: true,
					});
					failedTotal += 1;
					lastErrorMessage = ownershipError?.message || 'Pin ownership mismatch';
					logger.error(`AI pin image job ownership rejected: ${fullJob.id}`, ownershipError);
					continue;
				}
			}

			if (fullJob.articleId) {
				const ownerId = typeof fullJob.owner === 'string' ? fullJob.owner : (fullJob.owner?.id || '');
				await safeTransitionArticleLifecycle(fullJob.articleId, 'PINS_GENERATING', {
					ownerId,
					source: 'ai_pin_image_queue',
					message: 'Pin image generation started',
					force: true,
				});
			}

			if (fullJob.ai_pin) {
				await pocketbaseClient.collection('ai_pins').update(fullJob.ai_pin, {
					image_generation_status: 'processing',
					image_generation_error: '',
					image_job_id: fullJob.id,
				}).catch(() => null);
			}

			try {
				await withTimeout(processJob(fullJob), JOB_TIMEOUT_MS, `AI image job ${fullJob.id}`);
				processedTotal += 1;
				lastSuccessAt = new Date().toISOString();
				logger.info(`AI pin image job completed: ${fullJob.id}`);
			} catch (error) {
				const ownershipCode = error?.errorCode || '';
				if (
					ownershipCode === 'PIN_OWNERSHIP_MISMATCH'
					|| ownershipCode === 'PIN_WORKSPACE_MISMATCH'
					|| ownershipCode === 'JOB_WORKSPACE_MISSING'
					|| ownershipCode === 'PIN_NOT_FOUND'
				) {
					await setJobTerminalState({
						job: fullJob,
						status: 'failed',
						lastError: error.message || 'Pin ownership does not match job workspace',
						skipPinUpdate: true,
					});
					failedTotal += 1;
					lastErrorMessage = error.message || 'Pin ownership mismatch';
					logger.error(`AI pin image job ownership rejected: ${fullJob.id}`, error);
					continue;
				}

				const nextAttempts = (fullJob.attempt_count || 0) + 1;
				const maxAttempts = fullJob.max_attempts || 3;
				const fallbackImage = normalizeText(fullJob.featured_image_url, 1000);
				const exhausted = nextAttempts >= maxAttempts;
				const immediateFallback = Boolean(fallbackImage) && isImmediateImageFallbackError(error);

				// Never fail the workflow for quota/timeout/provider issues when an article image exists.
				if ((exhausted || immediateFallback) && fallbackImage) {
					await setJobTerminalState({
						job: fullJob,
						status: 'fallback',
						imageUrl: fallbackImage,
						lastError: userSafeImageError({ status: 'fallback', hasError: true }),
					});
					processedTotal += 1;
					lastSuccessAt = new Date().toISOString();
					logger.warn(`AI pin image job fallback used: ${fullJob.id}`);
					continue;
				}

				const shouldRetry = !exhausted;
				if (!shouldRetry && fallbackImage) {
					await setJobTerminalState({
						job: fullJob,
						status: 'fallback',
						imageUrl: fallbackImage,
						lastError: userSafeImageError({ status: 'fallback', hasError: true }),
					});
					processedTotal += 1;
					lastSuccessAt = new Date().toISOString();
					logger.warn(`AI pin image job fallback used (terminal guard): ${fullJob.id}`);
					continue;
				}

				const retryPayload = await sanitizeCollectionPayload({
					collection: 'ai_pin_image_jobs',
					context: 'ai-image-queue:retry-update',
					payload: {
						status: shouldRetry ? 'queued' : 'failed',
						attempt_count: nextAttempts,
						last_error: userSafeImageError({ hasError: true }),
						next_retry_at: shouldRetry ? nextRetryDate(nextAttempts) : null,
						claim_token: '',
					},
				});

				await pocketbaseClient.collection('ai_pin_image_jobs').update(fullJob.id, retryPayload).catch(() => null);

				if (fullJob.ai_pin) {
					try {
						await assertAndGetJobPin(fullJob);
						await pocketbaseClient.collection('ai_pins').update(fullJob.ai_pin, {
							image_generation_status: shouldRetry ? 'queued' : 'failed',
							image_generation_error: userSafeImageError({ hasError: true }),
							image_job_id: fullJob.id,
						}).catch(() => null);
					} catch (ownershipError) {
						logger.error(`Refusing pin status update for image job ${fullJob.id}: ${ownershipError.message}`);
					}
				}

				if (!shouldRetry && fullJob.articleId) {
					const ownerId = typeof fullJob.owner === 'string' ? fullJob.owner : (fullJob.owner?.id || '');
					await safeTransitionArticleLifecycle(fullJob.articleId, 'FAILED', {
						ownerId,
						source: 'ai_pin_image_queue',
						message: error?.message || 'Pin image generation failed',
						failureReason: error?.message || 'Pin image generation failed',
						failedStage: 'PINS_GENERATING',
						force: true,
					});
				}

				failedTotal += 1;
				lastErrorMessage = error?.message || 'Image generation failed';
				logger.error(`AI pin image job failed: ${fullJob.id}`, error);
			}
		}
	} catch (error) {
		lastErrorMessage = error?.message || 'AI image queue processing failed';
		logger.error('AI image queue processing failed:', error);
	} finally {
		running = false;
	}

	return hasQueueWork;
}

async function recoverStuckProcessingJobs({ onlyOlderThanMs = 0 } = {}) {
	const { filter } = await buildSchemaSafeFilter({
		collection: 'ai_pin_image_jobs',
		context: 'ai-image-queue:recover-stuck',
		parts: [{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'processing' }) }],
	});
	const stuck = await safeGetFullList({
		collection: 'ai_pin_image_jobs',
		context: 'ai-image-queue:recover-stuck',
		filter,
		sort: '',
	});

	const nowMs = Date.now();
	const eligible = stuck.filter((job) => {
		if (!onlyOlderThanMs || onlyOlderThanMs <= 0) return true;
		const updatedMs = new Date(job.updated || job.created || 0).getTime();
		if (!Number.isFinite(updatedMs)) return true;
		return (nowMs - updatedMs) >= onlyOlderThanMs;
	});

	if (eligible.length === 0) {
		return;
	}

	const now = new Date().toISOString();
	await Promise.all(eligible.map(async (job) => {
		const recoveryPayload = await sanitizeCollectionPayload({
			collection: 'ai_pin_image_jobs',
			context: 'ai-image-queue:recover-update',
			payload: {
				status: 'queued',
				next_retry_at: now,
				claim_token: '',
				last_error: onlyOlderThanMs > 0
					? `Recovered stuck processing job (>${Math.round(onlyOlderThanMs / 60000)}m)`
					: 'Recovered after worker restart',
			},
		});

		return pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, recoveryPayload).catch(() => null);
	}));

	logger.info(`Recovered ${eligible.length} AI image jobs${onlyOlderThanMs > 0 ? ' (stuck processing)' : ' after restart'}`);
}

export function getAIPinImageQueueStatus() {
	const enabled = isAIPinImageQueueEnabled();
	return {
		running,
		active: Boolean(workerTimer),
		enabled,
		disabledByEnv: !enabled,
		pollIntervalMs: currentPollIntervalMs,
		activePollIntervalMs: ACTIVE_POLL_INTERVAL_MS,
		idlePollIntervalMs: IDLE_POLL_INTERVAL_MS,
		activePollIntervalSource: resolveActivePollIntervalSource(),
		batchSize: MAX_JOBS_PER_TICK,
		processedTotal,
		failedTotal,
		lastRunAt,
		lastSuccessAt,
		lastErrorMessage,
	};
}

async function ensureImageJobClaimFields() {
	try {
		const collection = await pocketbaseClient.collections.getOne('ai_pin_image_jobs');
		const names = extractCollectionFieldNames(collection);
		const missing = [];
		if (!names.has('claim_token')) {
			missing.push({ name: 'claim_token', type: 'text', max: 120 });
		}
		if (!names.has('claim_version')) {
			missing.push({ name: 'claim_version', type: 'number', min: 0 });
		}
		if (missing.length === 0) return;
		const fields = Array.isArray(collection.fields)
			? collection.fields
			: (Array.isArray(collection.schema) ? collection.schema : []);
		await pocketbaseClient.collections.update(collection.id, {
			fields: [...fields, ...missing],
		});
		clearCollectionSchemaCache('ai_pin_image_jobs');
		logger.info('[ai-image-queue] ensured claim_token/claim_version fields');
	} catch (error) {
		logger.warn('[ai-image-queue] claim field ensure skipped', { message: error?.message });
	}
}

export function startAIPinImageQueue() {
	if (workerTimer || pollLoopActive) {
		return;
	}

	if (!isAIPinImageQueueEnabled()) {
		if (!envDisabledLogged) {
			logger.info('AI pin image queue disabled by AI_PIN_IMAGE_QUEUE_ENABLED');
			envDisabledLogged = true;
		}
		return;
	}

	pollLoopActive = true;

	const scheduleNextPoll = (delayMs) => {
		if (!pollLoopActive) {
			return;
		}
		currentPollIntervalMs = delayMs;
		workerTimer = setTimeout(async () => {
			workerTimer = null;
			let hasWork = false;
			try {
				hasWork = await processDueJobs();
			} catch (error) {
				logger.error('AI image queue poll cycle failed', { message: error?.message });
			}
			if (pollLoopActive) {
				scheduleNextPoll(hasWork ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
			}
		}, delayMs);
	};

	ensureImageJobClaimFields()
		.then(() => verifyCollectionFields({
			collection: 'ai_pin_image_jobs',
			requiredFields: ['status', 'created', 'next_retry_at', 'attempt_count', 'max_attempts', 'last_error'],
			context: 'ai-image-queue:start-schema-check',
		}))
		.catch(() => null);

	verifyCollectionFields({
		collection: 'websites',
		requiredFields: ['owner', 'url', 'domain', 'discovery_status', 'status'],
		context: 'websites-schema-check',
	}).catch(() => null);

	recoverStuckProcessingJobs().finally(async () => {
		let hasWork = false;
		try {
			hasWork = await processDueJobs();
		} catch (error) {
			logger.error('AI image queue initial poll failed', { message: error?.message });
		}
		scheduleNextPoll(hasWork ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
	});
	logger.info(`AI pin image queue started (active ${ACTIVE_POLL_INTERVAL_MS}ms, idle ${IDLE_POLL_INTERVAL_MS}ms)`);
}

export function stopAIPinImageQueue() {
	pollLoopActive = false;
	if (!workerTimer) {
		return;
	}

	clearTimeout(workerTimer);
	workerTimer = null;
	logger.info('AI pin image queue stopped');
}
