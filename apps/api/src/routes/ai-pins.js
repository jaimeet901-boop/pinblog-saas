import { Router } from 'express';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getPublicFileUrl } from '../utils/public-file-url.js';
import logger from '../utils/logger.js';
import { ensureWebsiteArticlesSchema } from '../utils/ensure-website-articles-schema.js';
import { ensureAiPinsPublishFields } from '../utils/ensure-ai-pins-publish-fields.js';
import { listWebsiteArticles } from '../services/website-article-discovery.js';
import { sanitizeCollectionPayload } from '../utils/pocketbase-safe-query.js';
import { analyzeArticleForPin, generateImagePromptForPin, PIN_STYLES } from '../services/ai-pin-analysis.js';
import { consumeCredits, getUserCreditUsage, recordGenerationHistory } from '../services/ai-pin-credits.js';
import { integratedAiRateLimit } from '../middleware/integrated-ai-rate-limit.js';
import { uploadFiles } from '../middleware/file-upload.js';
import { normalizeDestinationUrl } from '../utils/pin-publish-destination.js';
import { safeTransitionArticleLifecycle } from '../services/article-lifecycle.js';

const router = Router();
const MAX_REFERENCE_IMAGES = 6;

const uploadReferenceImages = uploadFiles({
	allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
	fieldName: 'images',
	maxCount: MAX_REFERENCE_IMAGES,
	maxSizeMB: 20,
});

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function normalizePositiveInt(value, fallback) {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallback;
	}
	return parsed;
}

function normalizeOptionalString(value, fieldName, max = 0) {
	if (value == null || value === '') {
		return '';
	}
	if (typeof value !== 'string') {
		throw httpError(422, `${fieldName} must be a string`);
	}
	const trimmed = value.trim();
	if (max > 0 && trimmed.length > max) {
		throw httpError(422, `${fieldName} must be ${max} characters or less`);
	}
	return trimmed;
}

function escapeFilterValue(value) {
	return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getOwnerId(record) {
	const raw = record?.owner;
	if (!raw) {
		return '';
	}
	if (typeof raw === 'string') {
		return raw.trim();
	}
	if (typeof raw === 'object') {
		return raw.id || '';
	}
	return String(raw).trim();
}

async function getOwnedWebsite({ websiteId, userId }) {
	const site = await pocketbaseClient.collection('websites').getOne(websiteId).catch(() => null);
	if (!site) {
		throw httpError(404, 'Website not found');
	}

	const storedOwnerId = getOwnerId(site);
	if (storedOwnerId === userId) {
		return site;
	}

	if (!storedOwnerId && userId) {
		const repaired = await pocketbaseClient
			.collection('websites')
			.update(site.id, { owner: userId })
			.catch(() => null);
		if (repaired) {
			return repaired;
		}
	}

	throw httpError(403, 'You do not have access to this website');
}

function mapArticle(record) {
	return {
		id: record.id,
		websiteId: record.websiteId || record.website_id || record.website || '',
		url: record.url || '',
		slug: record.slug || '',
		title: record.title || '',
		metaDescription: record.meta_description || '',
		featuredImage: record.featured_image || '',
		publishDate: record.publish_date || '',
		lastModifiedDate: record.last_modified_date || '',
		category: record.category || '',
		author: record.author || '',
		language: record.language || '',
		status: record.status || '',
		source: record.source || '',
		created: record.created || '',
		updated: record.updated || '',
	};
}

function mapReferenceImage(record) {
	const fileName = typeof record.file === 'string' ? record.file : '';
	return {
		id: record.id,
		name: record.name || record.original_name || fileName || 'reference',
		originalName: record.original_name || record.name || '',
		mimeType: record.mime_type || '',
		sizeBytes: Number(record.size_bytes) || 0,
		url: fileName ? getPublicFileUrl(record, fileName) : '',
		created: record.created || '',
		updated: record.updated || '',
	};
}

function deriveSlug(url, title) {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split('/').filter(Boolean);
		if (segments.length > 0) {
			return segments.at(-1).slice(0, 255);
		}
	} catch {
		// ignore
	}

	return String(title || 'manual-article')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 255) || 'manual-article';
}

/**
 * GET /ai-pins/articles
 * List selectable website articles for AI Pin generation.
 */
router.get('/articles', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const websiteId = normalizeOptionalString(req.query.websiteId, 'websiteId', 64);
	if (!websiteId) {
		throw httpError(422, 'websiteId is required');
	}

	await getOwnedWebsite({ websiteId, userId: req.pocketbaseUserId });
	const schema = await ensureWebsiteArticlesSchema(pocketbaseClient);

	const page = normalizePositiveInt(req.query.page, 1);
	const perPage = Math.min(normalizePositiveInt(req.query.perPage, 20), 100);
	const search = normalizeOptionalString(req.query.search, 'search', 200);
	const status = normalizeOptionalString(req.query.status, 'status', 32).toLowerCase();
	const category = normalizeOptionalString(req.query.category, 'category', 255);

	const filterExtraParts = [];
	if (search) {
		const safeSearch = escapeFilterValue(search);
		filterExtraParts.push(`(title ~ "${safeSearch}" || slug ~ "${safeSearch}" || url ~ "${safeSearch}" || meta_description ~ "${safeSearch}")`);
	}
	if (status) {
		filterExtraParts.push(`${schema.statusField} = "${escapeFilterValue(status)}"`);
	}
	if (category) {
		filterExtraParts.push(`category = "${escapeFilterValue(category)}"`);
	}

	const result = await listWebsiteArticles({
		pocketbaseClient,
		websiteId,
		websiteField: schema.websiteField,
		owner: req.pocketbaseUserId,
		page,
		perPage,
		filterExtra: filterExtraParts.join(' && '),
		sort: '-created',
	});

	const categories = [...new Set((result.items || []).map((item) => item.category).filter(Boolean))]
		.sort((a, b) => a.localeCompare(b));

	res.json({
		items: (result.items || []).map(mapArticle),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalPages: result.totalPages || 0,
		totalItems: result.totalItems || 0,
		categories,
	});
});

/**
 * GET /ai-pins/articles/:articleId
 * Preview a single article owned by the current user.
 */
router.get('/articles/:articleId', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const article = await pocketbaseClient.collection('website_articles').getOne(req.params.articleId).catch(() => null);
	if (!article || getOwnerId(article) !== req.pocketbaseUserId) {
		throw httpError(404, 'Article not found');
	}

	res.json(mapArticle(article));
});

/**
 * POST /ai-pins/manual-articles
 * Create a lightweight imported article for manual pin generation.
 */
router.post('/manual-articles', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const websiteId = normalizeOptionalString(req.body?.websiteId, 'websiteId', 64);
	if (!websiteId) {
		throw httpError(422, 'websiteId is required');
	}

	const site = await getOwnedWebsite({ websiteId, userId: req.pocketbaseUserId });
	const schema = await ensureWebsiteArticlesSchema(pocketbaseClient);

	const title = normalizeOptionalString(req.body?.title, 'title', 500);
	const url = normalizeOptionalString(req.body?.url, 'url', 1000);
	const description = normalizeOptionalString(req.body?.description || req.body?.metaDescription, 'description', 2000);
	const excerpt = normalizeOptionalString(req.body?.excerpt || req.body?.body, 'excerpt', 4000);
	const category = normalizeOptionalString(req.body?.category, 'category', 255);
	const author = normalizeOptionalString(req.body?.author, 'author', 255);
	const featuredImage = normalizeOptionalString(req.body?.featuredImage, 'featuredImage', 1000);

	if (!title) {
		throw httpError(422, 'title is required');
	}

	let normalizedUrl = url;
	if (!normalizedUrl) {
		const domain = site.domain || site.url || 'manual.local';
		const host = String(domain).replace(/^https?:\/\//i, '').replace(/\/$/, '');
		normalizedUrl = `https://${host}/manual/${Date.now()}`;
	}

	try {
		// Validate URL shape
		normalizedUrl = new URL(normalizedUrl).toString();
	} catch {
		throw httpError(422, 'url must be a valid URL');
	}

	const payload = await sanitizeCollectionPayload({
		collection: 'website_articles',
		payload: {
			[schema.websiteField]: websiteId,
			owner: req.pocketbaseUserId,
			url: normalizedUrl,
			slug: deriveSlug(normalizedUrl, title),
			title,
			meta_description: description || excerpt.slice(0, 2000),
			featured_image: featuredImage,
			category,
			author,
			[schema.statusField]: 'imported',
			source: 'manual',
			language: normalizeOptionalString(req.body?.language, 'language', 32) || 'en',
		},
		context: 'ai-pins:manual-article',
		requiredKeys: [schema.websiteField, 'owner', 'url', 'title', schema.statusField],
	});

	payload[schema.websiteField] = websiteId;
	payload.owner = req.pocketbaseUserId;
	payload[schema.statusField] = 'imported';

	try {
		const created = await pocketbaseClient.collection('website_articles').create(payload);
		logger.info('Manual AI pin article created', {
			articleId: created.id,
			websiteId,
			owner: req.pocketbaseUserId,
		});
		res.status(201).json(mapArticle(created));
	} catch (error) {
		logger.error('Failed to create manual article for AI pins', {
			message: error?.message || null,
			response: error?.response?.data || null,
		});
		throw httpError(422, error?.response?.data?.message || error?.message || 'Failed to create manual article');
	}
});

/** @deprecated Prefer GET /workspace/v1/config → pinStyles. Kept for API compatibility. */
router.get('/styles', async (req, res) => {
	res.json({ styles: PIN_STYLES });
});

/** @deprecated Prefer GET /workspace/v1/config → credits. Kept for API compatibility. */
router.get('/credits', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	res.json(await getUserCreditUsage(pocketbaseClient, req.pocketbaseUserId));
});

router.post('/analyze', integratedAiRateLimit, async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const articleId = normalizeOptionalString(req.body?.articleId, 'articleId', 64);
	const style = normalizeOptionalString(req.body?.style, 'style', 64) || '';
	if (!articleId) {
		throw httpError(422, 'articleId is required');
	}

	const articleRecord = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!articleRecord || getOwnerId(articleRecord) !== req.pocketbaseUserId) {
		throw httpError(404, 'Article not found');
	}

	await consumeCredits(pocketbaseClient, { userId: req.pocketbaseUserId, workspaceKey: req.workspaceKey, ai: 1, image: 0 });
	const article = mapArticle(articleRecord);
	await safeTransitionArticleLifecycle(articleId, 'AI_GENERATING', {
		ownerId: req.pocketbaseUserId,
		source: 'ai_pins.analyze',
		message: 'AI analysis started',
		force: true,
	});
	let analysis;
	try {
		analysis = await analyzeArticleForPin({
			owner: req.pocketbaseUserId,
			article,
			style,
		});
	} catch (error) {
		await safeTransitionArticleLifecycle(articleId, 'FAILED', {
			ownerId: req.pocketbaseUserId,
			source: 'ai_pins.analyze',
			message: error?.message || 'AI analysis failed',
			failureReason: error?.message || 'AI analysis failed',
			failedStage: 'AI_GENERATING',
			force: true,
		});
		throw error;
	}

	await recordGenerationHistory(pocketbaseClient, {
		owner: req.pocketbaseUserId,
		articleId,
		websiteId: article.websiteId || '',
		event_type: 'analyze',
		analysis,
		metadata: { style },
		ai_credits_used: 1,
		image_credits_used: 0,
	});

	await safeTransitionArticleLifecycle(articleId, 'AI_COMPLETED', {
		ownerId: req.pocketbaseUserId,
		source: 'ai_pins.analyze',
		message: 'AI analysis completed',
		force: true,
	});
	await safeTransitionArticleLifecycle(articleId, 'READY_FOR_PINS', {
		ownerId: req.pocketbaseUserId,
		source: 'ai_pins.analyze',
		message: 'Article ready for pin generation',
		force: true,
	});

	const credits = await getUserCreditUsage(pocketbaseClient, req.pocketbaseUserId);
	res.json({ analysis, credits });
});

router.post('/prompts', integratedAiRateLimit, async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const articleId = normalizeOptionalString(req.body?.articleId, 'articleId', 64);
	const style = normalizeOptionalString(req.body?.style, 'style', 64) || '';
	const analysis = req.body?.analysis && typeof req.body.analysis === 'object' ? req.body.analysis : null;
	if (!articleId) {
		throw httpError(422, 'articleId is required');
	}

	const articleRecord = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!articleRecord || getOwnerId(articleRecord) !== req.pocketbaseUserId) {
		throw httpError(404, 'Article not found');
	}

	await consumeCredits(pocketbaseClient, { userId: req.pocketbaseUserId, workspaceKey: req.workspaceKey, ai: 1, image: 0 });
	const article = mapArticle(articleRecord);
	await safeTransitionArticleLifecycle(articleId, 'AI_GENERATING', {
		ownerId: req.pocketbaseUserId,
		source: 'ai_pins.prompts',
		message: 'AI prompt generation started',
		force: true,
	});
	let resolvedAnalysis;
	let promptResult;
	try {
		resolvedAnalysis = analysis || await analyzeArticleForPin({
			owner: req.pocketbaseUserId,
			article,
			style,
		});
		promptResult = await generateImagePromptForPin({
			owner: req.pocketbaseUserId,
			article,
			analysis: resolvedAnalysis,
			style,
		});
	} catch (error) {
		await safeTransitionArticleLifecycle(articleId, 'FAILED', {
			ownerId: req.pocketbaseUserId,
			source: 'ai_pins.prompts',
			message: error?.message || 'AI prompt generation failed',
			failureReason: error?.message || 'AI prompt generation failed',
			failedStage: 'AI_GENERATING',
			force: true,
		});
		throw error;
	}

	await recordGenerationHistory(pocketbaseClient, {
		owner: req.pocketbaseUserId,
		articleId,
		websiteId: article.websiteId || '',
		event_type: 'prompt',
		prompt: promptResult.imagePrompt,
		analysis: resolvedAnalysis,
		metadata: { style: promptResult.style, source: promptResult.source },
		ai_credits_used: 1,
		image_credits_used: 0,
	});

	await safeTransitionArticleLifecycle(articleId, 'AI_COMPLETED', {
		ownerId: req.pocketbaseUserId,
		source: 'ai_pins.prompts',
		message: 'AI prompt generation completed',
		force: true,
	});
	await safeTransitionArticleLifecycle(articleId, 'READY_FOR_PINS', {
		ownerId: req.pocketbaseUserId,
		source: 'ai_pins.prompts',
		message: 'Article ready for pin generation',
		force: true,
	});

	const credits = await getUserCreditUsage(pocketbaseClient, req.pocketbaseUserId);
	res.json({
		...promptResult,
		analysis: resolvedAnalysis,
		credits,
	});
});

router.get('/history', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const page = normalizePositiveInt(req.query.page, 1);
	const perPage = Math.min(normalizePositiveInt(req.query.perPage, 20), 100);

	try {
		const result = await pocketbaseClient.collection('ai_pin_generation_history').getList(page, perPage, {
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: req.pocketbaseUserId }),
			sort: '-created',
		});
		res.json({
			items: result.items.map((item) => ({
				id: item.id,
				eventType: item.event_type,
				prompt: item.prompt || '',
				imageUrl: item.image_url || '',
				analysis: item.analysis || null,
				metadata: item.metadata || null,
				articleId: item.articleId || '',
				websiteId: item.websiteId || '',
				aiPinId: item.ai_pin || '',
				aiCreditsUsed: item.ai_credits_used || 0,
				imageCreditsUsed: item.image_credits_used || 0,
				created: item.created,
			})),
			page: result.page,
			perPage: result.perPage,
			totalPages: result.totalPages,
			totalItems: result.totalItems,
		});
	} catch (error) {
		logger.warn('AI pin history unavailable', { message: error?.message || null });
		res.json({ items: [], page: 1, perPage, totalPages: 0, totalItems: 0 });
	}
});

function mapBrandKit(record) {
	return {
		id: record.id,
		name: record.name,
		logoUrl: record.logo_url || '',
		primaryColor: record.primary_color || '#111827',
		secondaryColor: record.secondary_color || '#F97316',
		accentColor: record.accent_color || '#0EA5E9',
		fontHeading: record.font_heading || '',
		fontBody: record.font_body || '',
		watermarkText: record.watermark_text || '',
		watermarkUrl: record.watermark_url || '',
		websiteUrl: record.website_url || '',
		isDefault: Boolean(record.is_default),
		created: record.created,
		updated: record.updated,
	};
}

router.get('/brand-kits', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	try {
		const items = await pocketbaseClient.collection('brand_kits').getFullList({
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: req.pocketbaseUserId }),
			sort: '-updated',
		});
		res.json(items
			.sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)))
			.map(mapBrandKit));
	} catch {
		res.json([]);
	}
});

router.post('/brand-kits', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const name = normalizeOptionalString(req.body?.name, 'name', 120) || 'Default brand';
	const payload = {
		owner: req.pocketbaseUserId,
		name,
		logo_url: normalizeOptionalString(req.body?.logoUrl, 'logoUrl', 1000),
		primary_color: normalizeOptionalString(req.body?.primaryColor, 'primaryColor', 32) || '#111827',
		secondary_color: normalizeOptionalString(req.body?.secondaryColor, 'secondaryColor', 32) || '#F97316',
		accent_color: normalizeOptionalString(req.body?.accentColor, 'accentColor', 32) || '#0EA5E9',
		font_heading: normalizeOptionalString(req.body?.fontHeading, 'fontHeading', 120),
		font_body: normalizeOptionalString(req.body?.fontBody, 'fontBody', 120),
		watermark_text: normalizeOptionalString(req.body?.watermarkText, 'watermarkText', 120),
		watermark_url: normalizeOptionalString(req.body?.watermarkUrl, 'watermarkUrl', 1000),
		website_url: normalizeOptionalString(req.body?.websiteUrl, 'websiteUrl', 500),
		is_default: Boolean(req.body?.isDefault),
	};

	if (payload.is_default) {
		const existing = await pocketbaseClient.collection('brand_kits').getFullList({
			filter: pocketbaseClient.filter('owner = {:owner} && is_default = true', { owner: req.pocketbaseUserId }),
		}).catch(() => []);
		await Promise.all(existing.map((item) => pocketbaseClient.collection('brand_kits').update(item.id, { is_default: false }).catch(() => null)));
	}

	const created = await pocketbaseClient.collection('brand_kits').create(payload);
	res.status(201).json(mapBrandKit(created));
});

router.patch('/brand-kits/:id', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	const existing = await pocketbaseClient.collection('brand_kits').getOne(req.params.id).catch(() => null);
	if (!existing || getOwnerId(existing) !== req.pocketbaseUserId) {
		throw httpError(404, 'Brand kit not found');
	}

	const updates = {};
	const fields = [
		['name', 'name', 120],
		['logoUrl', 'logo_url', 1000],
		['primaryColor', 'primary_color', 32],
		['secondaryColor', 'secondary_color', 32],
		['accentColor', 'accent_color', 32],
		['fontHeading', 'font_heading', 120],
		['fontBody', 'font_body', 120],
		['watermarkText', 'watermark_text', 120],
		['watermarkUrl', 'watermark_url', 1000],
		['websiteUrl', 'website_url', 500],
	];
	for (const [input, output, max] of fields) {
		if (req.body?.[input] != null) {
			updates[output] = normalizeOptionalString(req.body[input], input, max);
		}
	}
	if (typeof req.body?.isDefault === 'boolean') {
		updates.is_default = req.body.isDefault;
		if (req.body.isDefault) {
			const others = await pocketbaseClient.collection('brand_kits').getFullList({
				filter: pocketbaseClient.filter('owner = {:owner} && is_default = true', { owner: req.pocketbaseUserId }),
			}).catch(() => []);
			await Promise.all(others.filter((item) => item.id !== existing.id).map((item) => (
				pocketbaseClient.collection('brand_kits').update(item.id, { is_default: false }).catch(() => null)
			)));
		}
	}

	const updated = await pocketbaseClient.collection('brand_kits').update(existing.id, updates);
	res.json(mapBrandKit(updated));
});

router.delete('/brand-kits/:id', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	const existing = await pocketbaseClient.collection('brand_kits').getOne(req.params.id).catch(() => null);
	if (!existing || getOwnerId(existing) !== req.pocketbaseUserId) {
		throw httpError(404, 'Brand kit not found');
	}
	await pocketbaseClient.collection('brand_kits').delete(existing.id);
	res.status(204).end();
});

router.get('/reference-images', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const records = await pocketbaseClient.collection('ai_pin_reference_images').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: req.pocketbaseUserId }),
		sort: '-created',
	}).catch((error) => {
		logger.error('Failed to list AI pin reference images', { error: error?.message });
		throw httpError(500, 'Failed to load reference images');
	});

	res.json({
		items: records.map(mapReferenceImage).slice(0, MAX_REFERENCE_IMAGES),
	});
});

router.post('/reference-images', (req, res, next) => {
	uploadReferenceImages(req, res, (error) => {
		if (!error) return next();
		error.status = Number.isInteger(error.status) ? error.status : 400;
		error.message = error.message || 'Upload failed';
		return next(error);
	});
}, async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const files = Array.isArray(req.files) ? req.files : [];
	if (files.length === 0) {
		throw httpError(422, 'At least one image file is required');
	}

	const existing = await pocketbaseClient.collection('ai_pin_reference_images').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: req.pocketbaseUserId }),
		sort: '-created',
	}).catch(() => []);

	const remaining = Math.max(0, MAX_REFERENCE_IMAGES - existing.length);
	if (remaining <= 0) {
		throw httpError(422, `You can store up to ${MAX_REFERENCE_IMAGES} reference images`);
	}

	const toUpload = files.slice(0, remaining);
	const created = [];

	for (const file of toUpload) {
		const originalName = String(file.originalname || 'reference').slice(0, 255);
		const formData = new FormData();
		formData.append('owner', req.pocketbaseUserId);
		formData.append('name', originalName);
		formData.append('original_name', originalName);
		formData.append('mime_type', String(file.mimetype || '').slice(0, 120));
		formData.append('size_bytes', String(file.size || 0));
		formData.append('file', new Blob([file.buffer], { type: file.mimetype }), originalName);

		const record = await pocketbaseClient.collection('ai_pin_reference_images').create(formData);
		created.push(mapReferenceImage(record));
	}

	res.status(201).json({ items: created });
});

router.delete('/reference-images/:id', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const existing = await pocketbaseClient.collection('ai_pin_reference_images').getOne(req.params.id).catch(() => null);
	if (!existing || getOwnerId(existing) !== req.pocketbaseUserId) {
		throw httpError(404, 'Reference image not found');
	}

	await pocketbaseClient.collection('ai_pin_reference_images').delete(existing.id);
	res.status(204).end();
});

/**
 * POST /ai-pins/drafts
 * Persist Studio preview pins. Ensures source_url schema exists, then creates via superuser.
 */
router.post('/drafts', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	await ensureAiPinsPublishFields(pocketbaseClient);

	const items = Array.isArray(req.body?.items) ? req.body.items : [];
	if (items.length === 0) {
		throw httpError(422, 'items must be a non-empty array');
	}

	const created = [];
	for (const item of items) {
		const label = String(item?.title || item?.tempId || 'pin').slice(0, 80);
		const sourceUrl = normalizeDestinationUrl(item?.source_url || item?.sourceUrl || '');
		if (!sourceUrl) {
			throw httpError(422, `Cannot save "${label}": source_url (original article URL) is required`);
		}

		const payload = await sanitizeCollectionPayload({
			collection: 'ai_pins',
			context: 'ai-pins:create-draft',
			requiredKeys: ['owner', 'articleId', 'websiteId', 'title', 'image_url', 'source_url'],
			payload: {
				...item,
				owner: req.pocketbaseUserId,
				source_url: sourceUrl.slice(0, 2000),
				image_origin: String(item?.image_origin || item?.imageOrigin || '').trim().slice(0, 32),
				status: 'draft',
			},
		});

		if (!payload.source_url) {
			throw httpError(500, `source_url was dropped from draft payload for "${label}" — schema ensure failed`);
		}

		let record;
		try {
			record = await pocketbaseClient.collection('ai_pins').create(payload);
		} catch (error) {
			const detail = error?.response?.message || error?.message || 'Failed to create draft';
			const fieldData = error?.response?.data || error?.data || {};
			if (fieldData.image_source && payload.image_source === 'featured_composed') {
				record = await pocketbaseClient.collection('ai_pins').create({
					...payload,
					image_source: 'featured',
				});
			} else if (fieldData.image_generation_status && payload.image_generation_status === 'rendering') {
				record = await pocketbaseClient.collection('ai_pins').create({
					...payload,
					image_generation_status: 'processing',
				});
			} else {
				logger.error('ai-pins draft create failed', { label, detail, fieldData });
				throw httpError(422, `Save failed for "${label}": ${detail}`);
			}
		}

		if (!normalizeDestinationUrl(record.source_url || '')) {
			await pocketbaseClient.collection('ai_pins').delete(record.id).catch(() => null);
			throw httpError(
				500,
				`Draft "${label}" was created without source_url. Check ai_pins schema / migration 1783986000.`,
			);
		}

		logger.info('[source-url] 3_database_save_record', {
			pinId: record.id,
			source_url: record.source_url,
			articleId: record.articleId || null,
		});

		created.push(record);
	}

	res.status(201).json({ items: created });
});

/**
 * POST /ai-pins/pins/ensure-source-url
 * Backfill source_url on existing drafts from their linked website_articles.url.
 */
router.post('/pins/ensure-source-url', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	await ensureAiPinsPublishFields(pocketbaseClient);

	const pinIds = Array.isArray(req.body?.pinIds)
		? req.body.pinIds.map((id) => String(id || '').trim()).filter(Boolean)
		: [];
	if (pinIds.length === 0) {
		throw httpError(422, 'pinIds must be a non-empty array');
	}

	const items = [];
	for (const pinId of pinIds) {
		const pin = await pocketbaseClient.collection('ai_pins').getOne(pinId).catch(() => null);
		if (!pin || getOwnerId(pin) !== req.pocketbaseUserId) {
			throw httpError(404, `Pin ${pinId} not found`);
		}

		const existing = normalizeDestinationUrl(pin.source_url || '');
		if (existing) {
			items.push(pin);
			continue;
		}

		const article = pin.articleId
			? await pocketbaseClient.collection('website_articles').getOne(pin.articleId).catch(() => null)
			: null;
		const articleUrl = normalizeDestinationUrl(article?.url || '');
		if (!articleUrl) {
			throw httpError(
				422,
				`Pin "${pin.title || pin.id}" has no source_url and its article has no valid URL`,
			);
		}

		const updated = await pocketbaseClient.collection('ai_pins').update(pin.id, {
			source_url: articleUrl.slice(0, 2000),
		});
		logger.info('[source-url] repaired_from_article', {
			pinId: pin.id,
			source_url: updated.source_url,
			articleId: pin.articleId,
		});
		items.push(updated);
	}

	res.json({ items });
});

router.patch('/pins/:pinId/editor', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	await ensureAiPinsPublishFields(pocketbaseClient);
	const pin = await pocketbaseClient.collection('ai_pins').getOne(req.params.pinId).catch(() => null);
	if (!pin || getOwnerId(pin) !== req.pocketbaseUserId) {
		throw httpError(404, 'Pin not found');
	}

	const updates = {};
	if (typeof req.body?.title === 'string') updates.title = req.body.title.trim().slice(0, 300);
	if (typeof req.body?.description === 'string') updates.description = req.body.description.trim().slice(0, 2000);
	if (typeof req.body?.overlayText === 'string') updates.overlay_text = req.body.overlayText.trim().slice(0, 600);
	if (typeof req.body?.imageUrl === 'string') updates.image_url = req.body.imageUrl.trim().slice(0, 1000);
	if (typeof req.body?.imagePrompt === 'string') updates.image_prompt = req.body.imagePrompt.trim().slice(0, 4000);
	if (typeof req.body?.cta === 'string') updates.cta = req.body.cta.trim().slice(0, 300);
	if (typeof req.body?.style === 'string') updates.style = req.body.style.trim().slice(0, 64);
	if (typeof req.body?.sourceUrl === 'string') updates.source_url = req.body.sourceUrl.trim().slice(0, 2000);
	if (typeof req.body?.imageOrigin === 'string') updates.image_origin = req.body.imageOrigin.trim().slice(0, 32);
	if (req.body?.editorState && typeof req.body.editorState === 'object') updates.editor_state = req.body.editorState;
	if (req.body?.analysis && typeof req.body.analysis === 'object') updates.analysis = req.body.analysis;
	if (Array.isArray(req.body?.suggestedKeywords)) updates.suggested_keywords = req.body.suggestedKeywords;
	if (Array.isArray(req.body?.suggestedHashtags)) updates.suggested_hashtags = req.body.suggestedHashtags;

	// Template snapshot: omit = leave unchanged. clearTemplate = explicit user removal only.
	if (req.body?.clearTemplate === true) {
		updates.template_id = '';
		updates.template_name = '';
		updates.template_version = '';
		updates.template_configuration = null;
		updates.template_thumbnail = '';
		updates.template_snapshot_at = '';
	} else {
		if (typeof req.body?.templateId === 'string') {
			updates.template_id = req.body.templateId.trim().slice(0, 80);
		}
		if (typeof req.body?.templateName === 'string') {
			updates.template_name = req.body.templateName.trim().slice(0, 180);
		}
		if (typeof req.body?.templateVersion === 'string') {
			updates.template_version = req.body.templateVersion.trim().slice(0, 120);
		}
		if (req.body?.templateConfiguration && typeof req.body.templateConfiguration === 'object') {
			updates.template_configuration = req.body.templateConfiguration;
		}
		if (typeof req.body?.templateThumbnail === 'string') {
			updates.template_thumbnail = req.body.templateThumbnail.trim().slice(0, 4000);
		}
		if (typeof req.body?.templateSnapshotAt === 'string' && req.body.templateSnapshotAt.trim()) {
			updates.template_snapshot_at = req.body.templateSnapshotAt.trim();
		}
	}

	const updated = await pocketbaseClient.collection('ai_pins').update(pin.id, updates);
	await recordGenerationHistory(pocketbaseClient, {
		owner: req.pocketbaseUserId,
		ai_pin: pin.id,
		articleId: pin.articleId || '',
		websiteId: pin.websiteId || '',
		event_type: 'edit',
		prompt: updated.image_prompt || '',
		image_url: updated.image_url || '',
		analysis: updated.analysis || null,
		metadata: { editor_state: updated.editor_state || null },
		ai_credits_used: 0,
		image_credits_used: 0,
	});

	res.json({
		id: updated.id,
		title: updated.title,
		description: updated.description,
		overlayText: updated.overlay_text,
		imageUrl: updated.image_url,
		imagePrompt: updated.image_prompt,
		cta: updated.cta || '',
		style: updated.style || '',
		analysis: updated.analysis || null,
		editorState: updated.editor_state || null,
		suggestedKeywords: updated.suggested_keywords || [],
		suggestedHashtags: updated.suggested_hashtags || [],
		templateId: updated.template_id || '',
		templateName: updated.template_name || '',
		templateVersion: updated.template_version || '',
		templateConfiguration: updated.template_configuration || null,
		templateThumbnail: updated.template_thumbnail || '',
		templateSnapshotAt: updated.template_snapshot_at || '',
		sourceUrl: updated.source_url || '',
		imageOrigin: updated.image_origin || '',
		imageSource: updated.image_source || '',
	});
});

export default router;
