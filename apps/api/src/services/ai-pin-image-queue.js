import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { getDecryptedOpenAIKey, getDecryptedFalKey } from './user-settings.js';
import { generateImagesWithProvider } from './image-providers/index.js';
import { consumeCredits, recordGenerationHistory } from './ai-pin-credits.js';
import {
	buildSchemaSafeFilter,
	safeGetFullList,
	sanitizeCollectionPayload,
	verifyCollectionFields,
} from '../utils/pocketbase-safe-query.js';
import { mirrorImageJob } from './queue/mirrors.js';

const POLL_INTERVAL_MS = Number.parseInt(process.env.AI_IMAGE_QUEUE_POLL_MS || '12000', 10);
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.AI_IMAGE_QUEUE_BATCH || '5', 10);

let workerTimer = null;
let running = false;
let processedTotal = 0;
let failedTotal = 0;
let lastRunAt = '';
let lastSuccessAt = '';
let lastErrorMessage = '';

function normalizeText(value, max = 0) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!max || text.length <= max) {
		return text;
	}
	return text.slice(0, max);
}

function buildPinterestImagePrompt(job) {
	const payload = job.prompt_payload || {};
	const title = normalizeText(payload.articleTitle || payload.pinTitle || 'Pinterest pin', 220);
	const description = normalizeText(payload.metaDescription || payload.pinDescription || '', 500);
	const category = normalizeText(payload.category || '', 120);
	const keywords = Array.isArray(payload.keywords) ? payload.keywords.map((item) => normalizeText(String(item), 40)).filter(Boolean).slice(0, 12) : [];
	const overlayText = normalizeText(payload.overlayText || '', 120);
	const imagePromptSeed = normalizeText(payload.imagePrompt || '', 800);

	return [
		'Create a professional Pinterest marketing image in vertical 2:3 composition.',
		'Target dimensions: 1000x1500 pixels (portrait).',
		'Use modern, premium branding style with clean typography and strong visual hierarchy.',
		`Article title: ${title}`,
		description ? `Meta description: ${description}` : '',
		category ? `Category: ${category}` : '',
		keywords.length > 0 ? `SEO keywords: ${keywords.join(', ')}` : '',
		overlayText ? `Overlay text to include: ${overlayText}` : '',
		imagePromptSeed ? `Creative direction: ${imagePromptSeed}` : '',
		'Avoid watermarks, avoid logos of known brands, and keep text readable for mobile.',
	].filter(Boolean).join('\n');
}

async function uploadGeneratedImage({ owner, bytes, contentType = 'image/png' }) {
	const fileName = `pin-${owner}-${Date.now()}.png`;
	const formData = new FormData();
	const blob = new Blob([bytes], { type: contentType });
	formData.append('file', blob, fileName);

	const record = await pocketbaseClient.collection('_integratedAiImages').create(formData);
	return pocketbaseClient.files.getURL(record, record.file);
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

async function setJobTerminalState({ job, status, imageUrl = '', lastError = '' }) {
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
		},
	});

	await pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, payload);

	await mirrorImageJob({
		...job,
		status,
		image_url: imageUrl,
		last_error: lastError,
		completed_at: completedAt,
	}, status === 'failed' ? 'Image generation failed' : 'Image generation completed').catch(() => null);

	if (job.ai_pin) {
		await pocketbaseClient.collection('ai_pins').update(job.ai_pin, {
			image_url: imageUrl,
			image_source: status === 'fallback' ? 'featured_fallback' : 'ai_generated',
			image_generation_status: status,
			image_generation_error: lastError,
			image_job_id: job.id,
		}).catch(() => null);
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

function readJobImageProvider(job) {
	const payload = readJobPromptPayload(job);
	const candidates = [
		job?.image_provider,
		payload.provider,
		payload.requestedProvider,
		job?.provider,
		readProviderFromPromptMarker(job?.prompt),
	];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.trim()) {
			return candidate.trim();
		}
	}
	return '';
}

async function processJob(job) {
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
		assertImageProviderConfigured,
		getPlatformProviderApiKey,
		normalizeImageProviderAlias,
		resolveConfiguredImageProvider,
	} = await import('./ai-providers.js');
	const { getPlatformSettings } = await import('./platform-settings.js');

	const promptPayload = readJobPromptPayload(job);
	const storedProvider = readJobImageProvider(job);
	const hasExplicitProvider = Boolean(storedProvider);

	dumpProviderTrace('[ai-pin-image-queue] before assertImageProviderConfigured', {
		jobId: job.id,
		requestedProvider: promptPayload.requestedProvider ?? null,
		storedProvider: storedProvider || null,
		'job.image_provider': job.image_provider ?? null,
		'job.provider': job.provider ?? null,
		'prompt_payload.provider': promptPayload.provider ?? null,
		'prompt_payload.requestedProvider': promptPayload.requestedProvider ?? null,
		promptMarker: readProviderFromPromptMarker(job.prompt) || null,
		prompt_payload_full: promptPayload,
		prompt_payload_raw_type: typeof job.prompt_payload,
		hasExplicitProvider,
	});

	// Job-specified provider must win. Never allow workspace default to replace it.
	const readyProvider = hasExplicitProvider
		? await resolveConfiguredImageProvider(storedProvider, { allowWorkspaceDefault: false })
		: await assertImageProviderConfigured('');

	const provider = readyProvider.code;

	dumpProviderTrace('[ai-pin-image-queue] after assertImageProviderConfigured', {
		jobId: job.id,
		requestedProvider: promptPayload.requestedProvider ?? null,
		storedProvider: storedProvider || null,
		resolvedProvider: provider,
		providerName: readyProvider.name || null,
		providerCode: readyProvider.code || null,
		'job.image_provider': job.image_provider ?? null,
		'prompt_payload.provider': promptPayload.provider ?? null,
	});

	if (hasExplicitProvider) {
		const expected = normalizeImageProviderAlias(storedProvider);
		if (provider !== expected) {
			const error = new Error(
				`Image provider mutated in worker: job had "${storedProvider}" but resolved "${provider}".`,
			);
			error.status = 500;
			error.errorCode = 'AI_IMAGE_PROVIDER_MUTATED';
			throw error;
		}
	}

	const openaiKey = await getDecryptedOpenAIKey(job.owner)
		|| await getPlatformProviderApiKey('openai');
	const falKey = await getDecryptedFalKey(job.owner)
		|| await getPlatformProviderApiKey('fal');
	const geminiKey = await getPlatformProviderApiKey('gemini');

	if (provider === 'openai' && !openaiKey) {
		if (fallbackImage) {
			await setJobTerminalState({
				job,
				status: 'fallback',
				imageUrl: fallbackImage,
				lastError: 'OpenAI API key is not configured',
			});
			return;
		}
		throw new Error('OpenAI API key is not configured');
	}

	if ((provider === 'fal' || provider === 'flux') && !falKey) {
		if (fallbackImage) {
			await setJobTerminalState({
				job,
				status: 'fallback',
				imageUrl: fallbackImage,
				lastError: 'Fal.ai API key is not configured',
			});
			return;
		}
		throw new Error('Fal.ai API key is not configured');
	}

	if (provider === 'gemini' && !geminiKey) {
		if (fallbackImage) {
			await setJobTerminalState({
				job,
				status: 'fallback',
				imageUrl: fallbackImage,
				lastError: 'Google Gemini API key is not configured',
			});
			return;
		}
		throw new Error('Google Gemini API key is not configured');
	}

	if (!['openai', 'fal', 'flux', 'gemini'].includes(provider)
		&& !falKey && !openaiKey && !geminiKey) {
		if (fallbackImage) {
			await setJobTerminalState({
				job,
				status: 'fallback',
				imageUrl: fallbackImage,
				lastError: 'Image provider API key is not configured',
			});
			return;
		}
		throw new Error('Image provider API key is not configured');
	}

	await consumeCredits(pocketbaseClient, { userId: job.owner, ai: 0, image: 1 }).catch((error) => {
		if (error?.status === 402) {
			throw error;
		}
	});

	const { settings } = await getPlatformSettings().catch(() => ({ settings: null }));
	const preferredModelId = normalizeText(
		promptPayload.model
		|| promptPayload.imageModel
		|| settings?.images?.defaultImageModel
		|| '',
		120,
	);

	const prompt = normalizeText(job.prompt, 5000) || buildPinterestImagePrompt({
		...job,
		prompt_payload: promptPayload,
	});

	dumpProviderTrace('[ai-pin-image-queue] Final provider passed to image-providers registry', {
		jobId: job.id,
		provider,
		providerName: readyProvider.name || null,
		preferredModelId: preferredModelId || null,
		requestedProvider: promptPayload.requestedProvider ?? null,
		storedProvider: storedProvider || null,
		'job.image_provider': job.image_provider ?? null,
		'prompt_payload.provider': promptPayload.provider ?? null,
	});

	const generatedList = await generateImagesWithProvider({
		provider,
		apiKeys: { openai: openaiKey, fal: falKey, gemini: geminiKey },
		prompt,
		count: 1,
		preferredModelId,
		baseUrl: readyProvider.config?.baseUrl || readyProvider.endpoint || undefined,
		timeoutMs: readyProvider.timeoutMs || undefined,
	});
	const generated = generatedList[0];
	if (!generated) {
		throw new Error('Image provider returned no output');
	}
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

async function processDueJobs() {
	if (running) {
		return;
	}

	running = true;
	lastRunAt = new Date().toISOString();

	try {
		const now = new Date().toISOString();
		const dueJobs = await getDueImageJobs(now);

		for (const job of dueJobs.slice(0, MAX_JOBS_PER_TICK)) {
			const lockPayload = await sanitizeCollectionPayload({
				collection: 'ai_pin_image_jobs',
				context: 'ai-image-queue:lock-job',
				payload: {
					status: 'processing',
				},
			});

			const locked = await pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, lockPayload).catch(() => null);

			if (!locked || locked.status !== 'processing') {
				continue;
			}

			// Re-fetch full record so prompt_payload.provider is never dropped by a partial update response.
			const fullJob = await pocketbaseClient.collection('ai_pin_image_jobs').getOne(locked.id).catch(() => locked);

			await mirrorImageJob(fullJob, 'Image worker claimed job').catch(() => null);

			if (fullJob.ai_pin) {
				await pocketbaseClient.collection('ai_pins').update(fullJob.ai_pin, {
					image_generation_status: 'processing',
					image_generation_error: '',
					image_job_id: fullJob.id,
				}).catch(() => null);
			}

			try {
				await processJob(fullJob);
				processedTotal += 1;
				lastSuccessAt = new Date().toISOString();
				logger.info(`AI pin image job completed: ${fullJob.id}`);
			} catch (error) {
				const nextAttempts = (fullJob.attempt_count || 0) + 1;
				const maxAttempts = fullJob.max_attempts || 3;
				const fallbackImage = normalizeText(fullJob.featured_image_url, 1000);
				const exhausted = nextAttempts >= maxAttempts;

				if (exhausted && fallbackImage) {
					await setJobTerminalState({
						job: fullJob,
						status: 'fallback',
						imageUrl: fallbackImage,
						lastError: error?.message || 'Image generation failed. Fallback image used.',
					});
					processedTotal += 1;
					lastSuccessAt = new Date().toISOString();
					logger.warn(`AI pin image job fallback used: ${fullJob.id}`);
					continue;
				}

				const shouldRetry = !exhausted;
				const retryPayload = await sanitizeCollectionPayload({
					collection: 'ai_pin_image_jobs',
					context: 'ai-image-queue:retry-update',
					payload: {
						status: shouldRetry ? 'queued' : 'failed',
						attempt_count: nextAttempts,
						last_error: error?.message || 'Image generation failed',
						next_retry_at: shouldRetry ? nextRetryDate(nextAttempts) : null,
					},
				});

				await pocketbaseClient.collection('ai_pin_image_jobs').update(fullJob.id, retryPayload).catch(() => null);

				if (fullJob.ai_pin) {
					await pocketbaseClient.collection('ai_pins').update(fullJob.ai_pin, {
						image_generation_status: shouldRetry ? 'queued' : 'failed',
						image_generation_error: error?.message || 'Image generation failed',
						image_job_id: fullJob.id,
					}).catch(() => null);
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
}

async function recoverStuckProcessingJobs() {
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

	if (stuck.length === 0) {
		return;
	}

	const now = new Date().toISOString();
	await Promise.all(stuck.map(async (job) => {
		const recoveryPayload = await sanitizeCollectionPayload({
			collection: 'ai_pin_image_jobs',
			context: 'ai-image-queue:recover-update',
			payload: {
				status: 'queued',
				next_retry_at: now,
				last_error: 'Recovered after worker restart',
			},
		});

		return pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, recoveryPayload).catch(() => null);
	}));

	logger.info(`Recovered ${stuck.length} AI image jobs after restart`);
}

export function getAIPinImageQueueStatus() {
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

export function startAIPinImageQueue() {
	if (workerTimer) {
		return;
	}

	workerTimer = setInterval(() => {
		processDueJobs();
	}, POLL_INTERVAL_MS);

	verifyCollectionFields({
		collection: 'ai_pin_image_jobs',
		requiredFields: ['status', 'created', 'next_retry_at', 'attempt_count', 'max_attempts', 'last_error'],
		context: 'ai-image-queue:start-schema-check',
	}).catch(() => null);

	verifyCollectionFields({
		collection: 'websites',
		requiredFields: ['owner', 'url', 'domain', 'discovery_status', 'status'],
		context: 'websites-schema-check',
	}).catch(() => null);

	recoverStuckProcessingJobs().finally(() => {
		processDueJobs();
	});
	logger.info(`AI pin image queue started (interval ${POLL_INTERVAL_MS}ms)`);
}

export function stopAIPinImageQueue() {
	if (!workerTimer) {
		return;
	}

	clearInterval(workerTimer);
	workerTimer = null;
	logger.info('AI pin image queue stopped');
}
