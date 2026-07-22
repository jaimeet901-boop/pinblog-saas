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

	const openaiKey = await getDecryptedOpenAIKey(job.owner);
	const falKey = await getDecryptedFalKey(job.owner);
	const provider = normalizeText(job.prompt_payload?.provider || 'openai', 40) || 'openai';

	if (provider !== 'openai' && !falKey && !openaiKey) {
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

	await consumeCredits(pocketbaseClient, { userId: job.owner, ai: 0, image: 1 }).catch((error) => {
		if (error?.status === 402) {
			throw error;
		}
	});

	const prompt = normalizeText(job.prompt, 5000) || buildPinterestImagePrompt(job);
	const generatedList = await generateImagesWithProvider({
		provider,
		apiKeys: { openai: openaiKey, fal: falKey },
		prompt,
		count: 1,
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
		metadata: { provider, jobId: job.id },
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

			await mirrorImageJob(locked, 'Image worker claimed job').catch(() => null);

			if (locked.ai_pin) {
				await pocketbaseClient.collection('ai_pins').update(locked.ai_pin, {
					image_generation_status: 'processing',
					image_generation_error: '',
					image_job_id: locked.id,
				}).catch(() => null);
			}

			try {
				await processJob(locked);
				processedTotal += 1;
				lastSuccessAt = new Date().toISOString();
				logger.info(`AI pin image job completed: ${locked.id}`);
			} catch (error) {
				const nextAttempts = (locked.attempt_count || 0) + 1;
				const maxAttempts = locked.max_attempts || 3;
				const fallbackImage = normalizeText(locked.featured_image_url, 1000);
				const exhausted = nextAttempts >= maxAttempts;

				if (exhausted && fallbackImage) {
					await setJobTerminalState({
						job: locked,
						status: 'fallback',
						imageUrl: fallbackImage,
						lastError: error?.message || 'Image generation failed. Fallback image used.',
					});
					processedTotal += 1;
					lastSuccessAt = new Date().toISOString();
					logger.warn(`AI pin image job fallback used: ${locked.id}`);
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

				await pocketbaseClient.collection('ai_pin_image_jobs').update(locked.id, retryPayload).catch(() => null);

				if (locked.ai_pin) {
					await pocketbaseClient.collection('ai_pins').update(locked.ai_pin, {
						image_generation_status: shouldRetry ? 'queued' : 'failed',
						image_generation_error: error?.message || 'Image generation failed',
						image_job_id: locked.id,
					}).catch(() => null);
				}

				failedTotal += 1;
				lastErrorMessage = error?.message || 'Image generation failed';
				logger.error(`AI pin image job failed: ${locked.id}`, error);
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
