import { Router } from 'express';
import { integratedAiRateLimit } from '../middleware/integrated-ai-rate-limit.js';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import { uploadFiles } from '../middleware/file-upload.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getPublicFileUrl } from '../utils/public-file-url.js';
import logger from '../utils/logger.js';
import {
	safeGetFullList,
	sanitizeCollectionPayload,
	verifyCollectionFields,
} from '../utils/pocketbase-safe-query.js';
import { assertSafePublicHttpUrl } from '../utils/ssrf-guard.js';
import {
	diagnoseFeaturedImageUrl,
	sendFeaturedImageProxyError,
	streamFeaturedImageToResponse,
} from '../services/featured-image-proxy.js';
import {
	getWorkspaceActor,
	stampCreateOwnership,
	assertWorkspaceOwnedRecord,
	recordBelongsToWorkspace,
	andWorkspaceScope,
} from '../services/workspace-ownership.js';
import { buildBackgroundImagePrompt } from '../services/ai-pin-background-prompt.js';
import {
	resolveImageGenerationTarget,
	serializeImageGenerationTarget,
} from '../services/image-generation-target.js';
import { userSafeImageError } from '../services/ai-user-safe-errors.js';
import { parseGenerationHistoryChannel } from '../services/ai-pin-generation-history-query.js';
import { assertImageJobPinChannel } from '../services/ai-pin-channel.js';
import { assertFeatureAccess } from '../services/plan-access-guard.js';

const router = Router();

const uploadComposedImage = uploadFiles({
	maxCount: 1,
	maxSizeMB: 12,
	allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
	fieldName: 'image',
});

const IMAGE_PROVIDER_MARKER_RE = /\[pinblog_image_provider:([a-z0-9_-]+)\]/i;

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function dumpProviderTrace(label, data) {
	const payload = {
		label,
		at: new Date().toISOString(),
		...data,
	};
	// Single-line JSON so Docker/journald never hide nested fields as [Object]
	console.log(`[INFO] ${label} ${JSON.stringify(payload)}`);
	logger.info(label, payload);
}

function appendProviderMarker(prompt, provider) {
	const code = String(provider || '').trim().toLowerCase();
	const base = String(prompt || '').replace(IMAGE_PROVIDER_MARKER_RE, '').trim();
	if (!code) return base;
	return `${base}\n[pinblog_image_provider:${code}]`;
}

async function resolveAdminImageProviderForUserRequest() {
	try {
		const { resolveAdminConfiguredImageProvider } = await import('../services/ai-providers.js');
		return await resolveAdminConfiguredImageProvider();
	} catch (error) {
		logger.error('Admin image provider resolution failed', {
			message: error?.message,
			errorCode: error?.errorCode,
		});
		throw httpError(503, userSafeImageError({ hasError: true }));
	}
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

async function ensureOwnedArticle({ req, articleId }) {
	const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!article) {
		throw httpError(404, 'Article not found');
	}
	const websiteId = typeof article.websiteId === 'string'
		? article.websiteId
		: (article.websiteId?.id || article.website || article.website_id || '');
	if (websiteId) {
		const site = await pocketbaseClient.collection('websites').getOne(websiteId).catch(() => null);
		if (site && recordBelongsToWorkspace(site, req)) {
			return article;
		}
	}
	assertWorkspaceOwnedRecord(article, req, { notFoundMessage: 'Article not found' });
	return article;
}

async function ensureOwnedPin({ req, pinId }) {
	if (!pinId) {
		return null;
	}
	const pin = await pocketbaseClient.collection('ai_pins').getOne(pinId).catch(() => null);
	if (!pin) {
		throw httpError(404, 'Pin not found');
	}
	assertWorkspaceOwnedRecord(pin, req, { notFoundMessage: 'Pin not found' });
	return pin;
}

async function prefetchOwnedArticles(req, articleIds) {
	const uniqueIds = [...new Set(articleIds.filter(Boolean))];
	const cache = new Map();
	await Promise.all(uniqueIds.map(async (articleId) => {
		const article = await ensureOwnedArticle({ req, articleId });
		cache.set(articleId, article);
	}));
	return cache;
}

async function prefetchOwnedPins(req, pinIds) {
	const uniqueIds = [...new Set(pinIds.filter(Boolean))];
	const cache = new Map();
	await Promise.all(uniqueIds.map(async (pinId) => {
		const pin = await ensureOwnedPin({ req, pinId });
		cache.set(pinId, pin);
	}));
	return cache;
}

async function prefetchActiveJobsByPinId(req, pinIds) {
	const uniquePinIds = [...new Set(pinIds.filter(Boolean))];
	if (uniquePinIds.length === 0) {
		return new Map();
	}

	const pinIdFilter = uniquePinIds
		.map((pinId) => pocketbaseClient.filter('ai_pin = {:pinId}', { pinId }))
		.join(' || ');
	const filter = andWorkspaceScope(
		req,
		`(${pinIdFilter}) && (status = "queued" || status = "processing")`,
	);

	const jobs = await safeGetFullList({
		collection: 'ai_pin_image_jobs',
		context: 'ai-pin-images:create:prefetch-active-jobs',
		filter,
	});

	const cache = new Map();
	for (const job of jobs) {
		const pinId = job.ai_pin || '';
		if (pinId && !cache.has(pinId)) {
			cache.set(pinId, job);
		}
	}
	return cache;
}

async function createImageJobRecord({
	req,
	owner,
	article,
	pin,
	rawItem,
	articleId,
	clientToken,
	imageMode,
	title,
	description,
	overlayText,
	category,
	keywords,
	imagePrompt,
	featuredImageUrl,
	provider,
	generationRunId,
}) {
	dumpProviderTrace('[ai-pin-images] Provider flow (create job)', {
		resolvedProvider: provider || null,
		imageMode,
		articleId,
		clientToken,
		channel: rawItem?.channel ?? null,
		exportProfileId: rawItem?.exportProfileId ?? rawItem?.export_profile_id ?? null,
	});

	const channel = normalizeString(rawItem?.channel, 'channel', { max: 40 });
	const exportProfileId = normalizeString(
		rawItem?.exportProfileId || rawItem?.export_profile_id,
		'exportProfileId',
		{ max: 80 },
	);
	const generationTarget = resolveImageGenerationTarget({ channel, exportProfileId });

	const prompt = appendProviderMarker(
		buildBackgroundImagePrompt({
			category,
			keywords,
			imagePrompt,
			recipeContext: article.meta_description || '',
			channel,
			exportProfileId,
			generationTarget,
		}),
		provider,
	);

	const promptPayload = {
		articleTitle: article.title || '',
		metaDescription: article.meta_description || '',
		category,
		keywords,
		overlayText,
		pinTitle: title,
		pinDescription: description,
		imagePrompt,
		provider,
		...(channel ? { channel } : {}),
		...(exportProfileId ? { exportProfileId } : {}),
		generationTarget: serializeImageGenerationTarget(generationTarget),
		...(generationRunId ? { generationRunId } : {}),
	};

	const createPayload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'ai-pin-images:create-job',
		payload: stampCreateOwnership(req, {
			owner,
			ai_pin: pin?.id || '',
			websiteId: article.websiteId || '',
			articleId: article.id,
			client_token: clientToken,
			source_type: pin ? 'pin' : 'preview',
			image_mode: imageMode,
			prompt,
			prompt_payload: promptPayload,
			image_provider: provider,
			featured_image_url: featuredImageUrl,
			status: 'queued',
			attempt_count: 0,
			max_attempts: 3,
			next_retry_at: '',
			last_error: '',
		}),
	});

	dumpProviderTrace('[ai-pin-images] createPayload before PocketBase create', {
		image_provider: createPayload.image_provider ?? null,
		prompt_payload: createPayload.prompt_payload ?? null,
		promptMarker: String(createPayload.prompt || '').match(IMAGE_PROVIDER_MARKER_RE)?.[1] || null,
		droppedImageProvider: !Object.prototype.hasOwnProperty.call(createPayload, 'image_provider'),
	});

	const job = await pocketbaseClient.collection('ai_pin_image_jobs').create(createPayload);

	let storedPayload = job.prompt_payload;
	if (typeof storedPayload === 'string') {
		try { storedPayload = JSON.parse(storedPayload); } catch { storedPayload = null; }
	}

	dumpProviderTrace('[ai-pin-images] Provider stored on ai_pin_image_jobs', {
		jobId: job.id,
		resolvedProvider: provider || null,
		'job.image_provider': job.image_provider ?? null,
		'job.provider': job.provider ?? null,
		'prompt_payload.provider': storedPayload?.provider ?? null,
		prompt_payload_raw_type: typeof job.prompt_payload,
		prompt_payload_full: storedPayload,
		promptMarker: String(job.prompt || '').match(IMAGE_PROVIDER_MARKER_RE)?.[1] || null,
	});

	const persistedProvider = job.image_provider || storedPayload?.provider || null;
	if (provider && persistedProvider !== provider) {
		logger.error('[ai-pin-images] provider did not persist on job record', {
			jobId: job.id,
			expected: provider,
			persistedProvider,
			image_provider: job.image_provider ?? null,
			prompt_payload_provider: storedPayload?.provider ?? null,
		});
	}

	if (pin) {
		await pocketbaseClient.collection('ai_pins').update(pin.id, {
			image_generation_status: 'queued',
			image_generation_error: '',
			image_job_id: job.id,
		});
	}

	return job;
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
		ready: ['completed', 'fallback'].includes(String(job.status || '').toLowerCase()),
		failed: String(job.status || '').toLowerCase() === 'failed',
		usingArticleImage: String(job.status || '').toLowerCase() === 'fallback',
		lastError: userSafeImageError({
			status: job.status,
			hasError: Boolean(job.last_error),
		}),
		attemptCount: job.attempt_count || 0,
		maxAttempts: job.max_attempts || 3,
		createdAt: job.created,
		updatedAt: job.updated,
	};
}

router.use(pocketbaseAuth);

router.get('/providers', async (req, res) => {
	res.json({ available: true });
});

/**
 * Same-origin image proxy for Featured Image canvas compose (avoids tainted canvas).
 * No AI providers. No credits.
 *
 * Production-grade: browser-like headers, SSRF-safe redirects, DNS/private IP checks,
 * streaming with size limits, MIME/magic validation, structured error diagnostics.
 */
router.get('/proxy', async (req, res) => {
	const rawUrl = normalizeString(req.query.url, 'url', { required: true, max: 2000 });
	try {
		// Validate early so contract stays the same for invalid URLs.
		assertSafePublicHttpUrl(rawUrl, { fieldName: 'url' });
		await streamFeaturedImageToResponse(req, res, rawUrl);
	} catch (error) {
		if (res.headersSent) {
			logger.error('Featured image proxy failed after response started', {
				message: error?.message,
				url: rawUrl,
			});
			return undefined;
		}
		return sendFeaturedImageProxyError(res, error);
	}
});

/**
 * Diagnostic mode for featured-image proxy troubleshooting.
 * Reports DNS / connection / redirect / MIME / bytes / latency without compose.
 */
router.get('/proxy/diagnose', async (req, res) => {
	const rawUrl = normalizeString(req.query.url, 'url', { required: true, max: 2000 });
	try {
		assertSafePublicHttpUrl(rawUrl, { fieldName: 'url' });
	} catch (error) {
		return res.status(error.status || 422).json({
			ok: false,
			dnsOk: false,
			connectionOk: false,
			redirectOk: false,
			imageDownloaded: false,
			mimeDetected: null,
			bytesReceived: 0,
			totalLatencyMs: 0,
			errorCode: error.errorCode || 'INVALID_URL',
			message: error.message || 'Invalid URL',
			originalUrl: rawUrl,
		});
	}

	const report = await diagnoseFeaturedImageUrl(rawUrl);
	return res.status(report.ok ? 200 : 502).json(report);
});

/**
 * Upload a locally composed Featured pin image (canvas/template renderer).
 * Does not call Gemini/Fal and does not consume AI credits.
 */
router.post('/composed', (req, res, next) => {
	uploadComposedImage(req, res, (error) => {
		if (error) {
			if (error.code === 'LIMIT_FILE_SIZE') {
				return next(httpError(413, 'Image is too large (max 12MB). Re-generate or compress and try again.'));
			}
			return next(httpError(422, error.message || 'Invalid composed image upload'));
		}
		return next();
	});
}, async (req, res) => {
	const owner = req.pocketbaseUserId;
	const file = Array.isArray(req.files) ? req.files[0] : null;
	if (!file?.buffer?.length) {
		throw httpError(422, 'image file is required');
	}

	const fileName = `featured-pin-${owner}-${Date.now()}.png`;
	const formData = new FormData();
	const blob = new Blob([file.buffer], { type: file.mimetype || 'image/png' });
	formData.append('file', blob, fileName);

	const record = await pocketbaseClient.collection('_integratedAiImages').create(formData).catch((error) => {
		logger.error('Failed to store composed featured pin image', { error: error?.message, owner });
		throw httpError(500, 'Failed to store composed pin image');
	});
	const imageUrl = getPublicFileUrl(record, record.file);

	logger.info('[ai-pin-images] composed featured pin uploaded', {
		owner,
		articleId: normalizeString(req.body?.articleId, 'articleId', { max: 80 }) || null,
		bytes: file.buffer.length,
	});

	res.status(201).json({
		imageUrl,
		imageSource: 'featured_composed',
		creditsCharged: 0,
	});
});

router.post('/jobs', integratedAiRateLimit, async (req, res) => {
	const actor = getWorkspaceActor(req);
	const owner = actor.workspaceOwnerId || req.pocketbaseUserId;
	const items = Array.isArray(req.body?.items) ? req.body.items : [];
	if (items.length === 0) {
		throw httpError(422, 'items must be a non-empty array');
	}

	const needsAiImages = items.some((rawItem) => {
		const imageMode = String(rawItem?.imageMode || 'generate_ai').trim();
		return imageMode === 'generate_ai';
	});
	if (needsAiImages) {
		await assertFeatureAccess(req, 'aiImages', {
			message: 'AI Images require a plan upgrade. Open Subscription to unlock image generation.',
		});
	}

	const slice = items.slice(0, 100);
	const parsedItems = slice.map((rawItem) => {
		const articleId = normalizeString(rawItem?.articleId, 'articleId', { required: true, max: 80 });
		const pinId = normalizeString(rawItem?.pinId, 'pinId', { max: 80 });
		const clientToken = normalizeString(rawItem?.clientToken, 'clientToken', { max: 120 });
		const imageMode = normalizeString(rawItem?.imageMode, 'imageMode', { max: 30 }) || 'generate_ai';
		if (!['generate_ai', 'use_featured'].includes(imageMode)) {
			throw httpError(422, 'imageMode must be generate_ai or use_featured');
		}
		return { rawItem, articleId, pinId, clientToken, imageMode };
	});

	const seenPinIds = new Set();
	for (const item of parsedItems) {
		if (!item.pinId) {
			continue;
		}
		if (seenPinIds.has(item.pinId)) {
			throw httpError(422, 'Duplicate pinId in request');
		}
		seenPinIds.add(item.pinId);
	}

	const [articleCache, pinCache, activeJobCache] = await Promise.all([
		prefetchOwnedArticles(req, parsedItems.map((item) => item.articleId)),
		prefetchOwnedPins(req, parsedItems.map((item) => item.pinId)),
		prefetchActiveJobsByPinId(req, parsedItems.map((item) => item.pinId)),
	]);

	const createPlans = [];
	for (const item of parsedItems) {
		const { rawItem, articleId, pinId, clientToken, imageMode } = item;
		const article = articleCache.get(articleId);
		const pin = pinId ? pinCache.get(pinId) : null;
		const requestedChannel = parseGenerationHistoryChannel(rawItem?.channel);
		if (pin) {
			assertImageJobPinChannel(pin, requestedChannel);
		}

		const existingActiveJob = pin ? activeJobCache.get(pin.id) : null;
		if (existingActiveJob) {
			createPlans.push({ type: 'existing', job: existingActiveJob });
			continue;
		}

		const title = normalizeString(rawItem?.title || pin?.title || article.title || '', 'title', { max: 220 });
		const description = normalizeString(rawItem?.description || pin?.description || article.meta_description || '', 'description', { max: 1000 });
		const overlayText = normalizeString(rawItem?.overlayText || pin?.overlay_text || '', 'overlayText', { max: 140 });
		const category = normalizeString(rawItem?.category || article.category || '', 'category', { max: 120 });
		const keywords = normalizeKeywords(rawItem?.keywords || pin?.suggested_keywords || []);
		const imagePrompt = normalizeString(rawItem?.imagePrompt || pin?.image_prompt || '', 'imagePrompt', { max: 1200 });
		const featuredImageUrl = normalizeString(rawItem?.featuredImageUrl || article.featured_image || '', 'featuredImageUrl', { max: 1000 });
		let provider = '';
		if (imageMode === 'generate_ai') {
			const ready = await resolveAdminImageProviderForUserRequest();
			provider = ready.code;
		}

		const generationRunId = normalizeString(rawItem?.generationRunId || rawItem?.generation_run_id || '', 'generationRunId', { max: 80 });

		createPlans.push({
			type: 'create',
			rawItem,
			article,
			pin,
			articleId,
			clientToken,
			imageMode,
			title,
			description,
			overlayText,
			category,
			keywords,
			imagePrompt,
			featuredImageUrl,
			provider,
			generationRunId,
		});
	}

	const jobs = await Promise.all(createPlans.map(async (plan) => {
		if (plan.type === 'existing') {
			return plan.job;
		}
		return createImageJobRecord({
			req,
			owner,
			article: plan.article,
			pin: plan.pin,
			rawItem: plan.rawItem,
			articleId: plan.articleId,
			clientToken: plan.clientToken,
			imageMode: plan.imageMode,
			title: plan.title,
			description: plan.description,
			overlayText: plan.overlayText,
			category: plan.category,
			keywords: plan.keywords,
			imagePrompt: plan.imagePrompt,
			featuredImageUrl: plan.featuredImageUrl,
			provider: plan.provider,
			generationRunId: plan.generationRunId,
		});
	}));

	res.status(201).json({ items: jobs.map(mapJob) });
});

router.get('/jobs', async (req, res) => {
	const ids = normalizeString(req.query.ids, 'ids', { max: 4000 })
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, 200);

	if (ids.length === 0) {
		return res.json({ items: [] });
	}

	const idFilter = ids.map((id) => pocketbaseClient.filter('id = {:id}', { id })).join(' || ');
	const filter = andWorkspaceScope(req, `(${idFilter})`);
	const listed = await pocketbaseClient.collection('ai_pin_image_jobs').getList(1, ids.length, {
		filter,
		requestKey: null,
	}).catch(() => ({ items: [] }));

	const ownedById = new Map();
	for (const job of listed.items || []) {
		if (job && recordBelongsToWorkspace(job, req)) {
			ownedById.set(job.id, job);
		}
	}

	const owned = ids.map((id) => ownedById.get(id)).filter(Boolean);
	res.json({ items: owned.map(mapJob) });
});

router.post('/jobs/:jobId/regenerate', integratedAiRateLimit, async (req, res) => {
	await assertFeatureAccess(req, 'aiImages', {
		message: 'AI Images require a plan upgrade. Open Subscription to unlock image generation.',
	});

	const actor = getWorkspaceActor(req);
	const owner = actor.workspaceOwnerId || req.pocketbaseUserId;
	const sourceJob = await pocketbaseClient.collection('ai_pin_image_jobs').getOne(req.params.jobId).catch(() => null);
	if (!sourceJob || !recordBelongsToWorkspace(sourceJob, req)) {
		throw httpError(404, 'Job not found');
	}

	const sourcePinId = typeof sourceJob.ai_pin === 'string'
		? sourceJob.ai_pin.trim()
		: String(sourceJob.ai_pin?.id || '').trim();
	if (sourcePinId) {
		const pin = await pocketbaseClient.collection('ai_pins').getOne(sourcePinId).catch(() => null);
		if (pin) {
			assertWorkspaceOwnedRecord(pin, req, { notFoundMessage: 'Pin not found' });
			assertImageJobPinChannel(
				pin,
				parseGenerationHistoryChannel(req.body?.channel ?? req.query?.channel),
			);
		}
	}

	const readyProvider = await resolveAdminImageProviderForUserRequest();
	const originalPrompt = normalizeString(req.body?.prompt, 'prompt', { max: 5000 }) || sourceJob.prompt;
	const clonePayload = await sanitizeCollectionPayload({
		collection: 'ai_pin_image_jobs',
		context: 'ai-pin-images:regenerate-job',
		payload: stampCreateOwnership(req, {
		owner,
		ai_pin: sourceJob.ai_pin || '',
		websiteId: sourceJob.websiteId || '',
		articleId: sourceJob.articleId || '',
		client_token: normalizeString(req.body?.clientToken, 'clientToken', { max: 120 }) || sourceJob.client_token || '',
		source_type: sourceJob.source_type,
		image_mode: 'generate_ai',
		prompt: appendProviderMarker(originalPrompt, readyProvider.code),
		prompt_payload: {
			...(typeof sourceJob.prompt_payload === 'object' ? sourceJob.prompt_payload : {}),
			provider: readyProvider.code,
		},
		image_provider: readyProvider.code,
		featured_image_url: sourceJob.featured_image_url || '',
		status: 'queued',
		attempt_count: 0,
		max_attempts: sourceJob.max_attempts || 3,
		next_retry_at: '',
		last_error: '',
		}),
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
