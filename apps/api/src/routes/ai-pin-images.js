import { Router } from 'express';
import { integratedAiRateLimit } from '../middleware/integrated-ai-rate-limit.js';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import {
	buildSchemaSafeFilter,
	safeGetFirstListItem,
	sanitizeCollectionPayload,
	verifyCollectionFields,
} from '../utils/pocketbase-safe-query.js';

const router = Router();

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function normalizeString(value, fieldName, { required = false, max = 0 } = {}) {
	if (value == null) {
		if (required) {
			throw httpError(422, `${fieldName} is required`);
		}
		return '';
	}
	if (typeof value !== 'string') {
		throw httpError(422, `${fieldName} must be a string`);
	}
	const normalized = value.trim();
	if (required && !normalized) {
		throw httpError(422, `${fieldName} is required`);
	}
	if (max > 0 && normalized.length > max) {
		throw httpError(422, `${fieldName} must be ${max} characters or less`);
	}
	return normalized;
}

function normalizeKeywords(value) {
	if (!value) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw httpError(422, 'keywords must be an array of strings');
	}
	return value.map((item) => normalizeString(item, 'keywords', { max: 40 })).filter(Boolean).slice(0, 12);
}

async function ensureOwnedArticle({ owner, articleId }) {
	const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!article || article.owner !== owner) {
		throw httpError(404, 'Article not found');
	}
	return article;
}

async function ensureOwnedPin({ owner, pinId }) {
	if (!pinId) {
		return null;
	}
	const pin = await pocketbaseClient.collection('ai_pins').getOne(pinId).catch(() => null);
	if (!pin || pin.owner !== owner) {
		throw httpError(404, 'Pin not found');
	}
	return pin;
}

function mapJob(job) {
	return {
		id: job.id,
		aiPinId: job.ai_pin || '',
		articleId: job.articleId || '',
		websiteId: job.websiteId || '',
		clientToken: job.client_token || '',
		status: job.status,
		imageMode: job.image_mode,
		imageUrl: job.image_url || '',
		featuredImageUrl: job.featured_image_url || '',
		lastError: job.last_error || '',
		attemptCount: job.attempt_count || 0,
		maxAttempts: job.max_attempts || 3,
		createdAt: job.created,
		updatedAt: job.updated,
	};
}

router.use(pocketbaseAuth);

router.get('/providers', async (req, res) => {
	const { listImageProviders } = await import('../services/image-providers/index.js');
	res.json({ providers: listImageProviders(), counts: [1, 3, 5], size: '1000x1500' });
});

router.post('/jobs', integratedAiRateLimit, async (req, res) => {
	const owner = req.pocketbaseUserId;
	const items = Array.isArray(req.body?.items) ? req.body.items : [];
	if (items.length === 0) {
		throw httpError(422, 'items must be a non-empty array');
	}

	const jobs = [];
	for (const rawItem of items.slice(0, 100)) {
		const articleId = normalizeString(rawItem?.articleId, 'articleId', { required: true, max: 80 });
		const pinId = normalizeString(rawItem?.pinId, 'pinId', { max: 80 });
		const clientToken = normalizeString(rawItem?.clientToken, 'clientToken', { max: 120 });
		const imageMode = normalizeString(rawItem?.imageMode, 'imageMode', { max: 30 }) || 'generate_ai';
		if (!['generate_ai', 'use_featured'].includes(imageMode)) {
			throw httpError(422, 'imageMode must be generate_ai or use_featured');
		}

		const article = await ensureOwnedArticle({ owner, articleId });
		const pin = await ensureOwnedPin({ owner, pinId });

		const existingActiveJob = pin
			? await (async () => {
				const { filter } = await buildSchemaSafeFilter({
					collection: 'ai_pin_image_jobs',
					context: 'ai-pin-images:create:existing-active-job',
					parts: [
						{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
						{ field: 'ai_pin', expression: pocketbaseClient.filter('ai_pin = {:pinId}', { pinId: pin.id }) },
						{ field: 'status', expression: '(status = "queued" || status = "processing")' },
					],
				});

				return safeGetFirstListItem({
					collection: 'ai_pin_image_jobs',
					context: 'ai-pin-images:create:existing-active-job',
					filter,
				});
			})()
			: null;
		if (existingActiveJob) {
			jobs.push(existingActiveJob);
			continue;
		}

		const title = normalizeString(rawItem?.title || pin?.title || article.title || '', 'title', { max: 220 });
		const description = normalizeString(rawItem?.description || pin?.description || article.meta_description || '', 'description', { max: 1000 });
		const overlayText = normalizeString(rawItem?.overlayText || pin?.overlay_text || '', 'overlayText', { max: 140 });
		const category = normalizeString(rawItem?.category || article.category || '', 'category', { max: 120 });
		const keywords = normalizeKeywords(rawItem?.keywords || pin?.suggested_keywords || []);
		const imagePrompt = normalizeString(rawItem?.imagePrompt || pin?.image_prompt || '', 'imagePrompt', { max: 1200 });
		const featuredImageUrl = normalizeString(rawItem?.featuredImageUrl || article.featured_image || '', 'featuredImageUrl', { max: 1000 });
		const provider = normalizeString(rawItem?.provider || 'openai', 'provider', { max: 40 }) || 'openai';
		if (!['openai', 'fal', 'flux'].includes(provider)) {
			throw httpError(422, 'provider must be openai, fal, or flux');
		}

		const prompt = [
			'Professional Pinterest marketing visual, vertical 2:3.',
			'Target size 1000x1500.',
			`Article title: ${title}`,
			description ? `Meta description: ${description}` : '',
			category ? `Category: ${category}` : '',
			keywords.length ? `Keywords: ${keywords.join(', ')}` : '',
			overlayText ? `Overlay text: ${overlayText}` : '',
			imagePrompt ? `Creative direction: ${imagePrompt}` : '',
		].filter(Boolean).join('\n');

		const createPayload = await sanitizeCollectionPayload({
			collection: 'ai_pin_image_jobs',
			context: 'ai-pin-images:create-job',
			payload: {
			owner,
			ai_pin: pin?.id || '',
			websiteId: article.websiteId || '',
			articleId: article.id,
			client_token: clientToken,
			source_type: pin ? 'pin' : 'preview',
			image_mode: imageMode,
			prompt,
			prompt_payload: {
				articleTitle: article.title || '',
				metaDescription: article.meta_description || '',
				category,
				keywords,
				overlayText,
				pinTitle: title,
				pinDescription: description,
				imagePrompt,
				provider,
			},
			featured_image_url: featuredImageUrl,
			status: 'queued',
			attempt_count: 0,
			max_attempts: 3,
			next_retry_at: '',
			last_error: '',
			},
		});

		const job = await pocketbaseClient.collection('ai_pin_image_jobs').create(createPayload);

		if (pin) {
			await pocketbaseClient.collection('ai_pins').update(pin.id, {
				image_generation_status: 'queued',
				image_generation_error: '',
				image_job_id: job.id,
			});
		}

		jobs.push(job);
	}

	res.status(201).json({ items: jobs.map(mapJob) });
});

router.get('/jobs', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const ids = normalizeString(req.query.ids, 'ids', { max: 4000 })
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, 200);

	if (ids.length === 0) {
		return res.json({ items: [] });
	}

	const jobs = await Promise.all(ids.map((id) => pocketbaseClient.collection('ai_pin_image_jobs').getOne(id).catch(() => null)));
	const owned = jobs.filter((job) => job && job.owner === owner);
	res.json({ items: owned.map(mapJob) });
});

router.post('/jobs/:jobId/regenerate', integratedAiRateLimit, async (req, res) => {
	const owner = req.pocketbaseUserId;
	const sourceJob = await pocketbaseClient.collection('ai_pin_image_jobs').getOne(req.params.jobId).catch(() => null);
	if (!sourceJob || sourceJob.owner !== owner) {
		throw httpError(404, 'Job not found');
	}

	const clonePayload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'ai-pin-images:regenerate-job',
		payload: {
		owner,
		ai_pin: sourceJob.ai_pin || '',
		websiteId: sourceJob.websiteId || '',
		articleId: sourceJob.articleId || '',
		client_token: normalizeString(req.body?.clientToken, 'clientToken', { max: 120 }) || sourceJob.client_token || '',
		source_type: sourceJob.source_type,
		image_mode: 'generate_ai',
		prompt: normalizeString(req.body?.prompt, 'prompt', { max: 5000 }) || sourceJob.prompt,
		prompt_payload: sourceJob.prompt_payload || null,
		featured_image_url: sourceJob.featured_image_url || '',
		status: 'queued',
		attempt_count: 0,
		max_attempts: sourceJob.max_attempts || 3,
		next_retry_at: '',
		last_error: '',
		},
	});

	const cloned = await pocketbaseClient.collection('ai_pin_image_jobs').create(clonePayload);

	res.status(201).json(mapJob(cloned));
});

export default router;

verifyCollectionFields({
	collection: 'ai_pin_image_jobs',
	requiredFields: ['owner', 'ai_pin', 'status', 'created', 'next_retry_at'],
	context: 'ai-pin-images:module-schema-check',
}).catch(() => null);
