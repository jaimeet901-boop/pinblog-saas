import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { getDecryptedOpenAIKey } from './user-settings.js';

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
	const response = await fetch('https://api.openai.com/v1/images/generations', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: process.env.OPENAI_IMAGES_MODEL || 'gpt-image-1',
			prompt,
			size: process.env.OPENAI_IMAGES_SIZE || '1024x1536',
		}),
	});

	if (!response.ok) {
		const details = await response.text().catch(() => 'OpenAI image generation failed');
		const error = new Error(details || 'OpenAI image generation failed');
		error.status = response.status;
		throw error;
	}

	const payload = await response.json();
	const item = payload?.data?.[0];
	if (!item) {
		throw new Error('OpenAI image generation returned empty output');
	}

	if (item.b64_json) {
		return {
			bytes: Buffer.from(item.b64_json, 'base64'),
			contentType: 'image/png',
		};
	}

	if (item.url) {
		const imageResponse = await fetch(item.url);
		if (!imageResponse.ok) {
			throw new Error('Failed to download generated image from OpenAI');
		}
		const arrayBuffer = await imageResponse.arrayBuffer();
		return {
			bytes: Buffer.from(arrayBuffer),
			contentType: imageResponse.headers.get('content-type') || 'image/png',
		};
	}

	throw new Error('OpenAI image generation output format is not supported');
}

async function setJobTerminalState({ job, status, imageUrl = '', lastError = '' }) {
	const completedAt = new Date().toISOString();
	await pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, {
		status,
		image_url: imageUrl,
		last_error: lastError,
		completed_at: completedAt,
		next_retry_at: '',
	});

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

	const apiKey = await getDecryptedOpenAIKey(job.owner);
	if (!apiKey) {
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

	const prompt = normalizeText(job.prompt, 5000) || buildPinterestImagePrompt(job);
	const generated = await generateOpenAIImage({ apiKey, prompt });
	const imageUrl = await uploadGeneratedImage({ owner: job.owner, ...generated });

	await setJobTerminalState({
		job,
		status: 'completed',
		imageUrl,
		lastError: '',
	});
}

function nextRetryDate(attemptCount) {
	const capped = Math.max(1, Math.min(5, attemptCount));
	const ms = capped * 60 * 1000;
	return new Date(Date.now() + ms).toISOString();
}

async function processDueJobs() {
	if (running) {
		return;
	}

	running = true;
	lastRunAt = new Date().toISOString();

	try {
		const now = new Date().toISOString();
		const dueJobs = await pocketbaseClient.collection('ai_pin_image_jobs').getFullList({
			sort: 'created',
			filter: [
				'status = "queued"',
				`(next_retry_at = '' || next_retry_at <= "${now}")`,
			].join(' && '),
		});

		for (const job of dueJobs.slice(0, MAX_JOBS_PER_TICK)) {
			const locked = await pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, {
				status: 'processing',
			}).catch(() => null);

			if (!locked || locked.status !== 'processing') {
				continue;
			}

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
				await pocketbaseClient.collection('ai_pin_image_jobs').update(locked.id, {
					status: shouldRetry ? 'queued' : 'failed',
					attempt_count: nextAttempts,
					last_error: error?.message || 'Image generation failed',
					next_retry_at: shouldRetry ? nextRetryDate(nextAttempts) : '',
				}).catch(() => null);

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
	const stuck = await pocketbaseClient.collection('ai_pin_image_jobs').getFullList({
		filter: 'status = "processing"',
	});

	if (stuck.length === 0) {
		return;
	}

	const now = new Date().toISOString();
	await Promise.all(stuck.map((job) => pocketbaseClient.collection('ai_pin_image_jobs').update(job.id, {
		status: 'queued',
		next_retry_at: now,
		last_error: 'Recovered after worker restart',
	}).catch(() => null)));

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
