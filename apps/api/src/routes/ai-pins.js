import { Router } from 'express';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getPublicFileUrl } from '../utils/public-file-url.js';
import logger from '../utils/logger.js';
import { ensureWebsiteArticlesSchema } from '../utils/ensure-website-articles-schema.js';
import { ensureAiPinsPublishFields } from '../utils/ensure-ai-pins-publish-fields.js';
import { listWebsiteArticles } from '../services/website-article-discovery.js';
import { sanitizeCollectionPayload } from '../utils/pocketbase-safe-query.js';
import { analyzeArticleForPin, generateImagePromptForPin, PIN_STYLES } from '../services/ai-pin-analysis.js';
import { normalizeStudioPromptChannel, resolvePromptPackForRequest } from '../services/studio/prompt-packs.js';
import { getUserCreditUsage, recordGenerationHistory } from '../services/ai-pin-credits.js';
import { isBillableAiResultSource } from '../services/ai-billing-policy.js';
import {
	ANALYZE_CREDIT_FEATURE,
	PROMPT_CREDIT_FEATURE,
	withAnalyzeAndPromptCredits,
	withPinTextFeatureCredits,
} from '../services/ai-pin-text-credits.js';
import { userSafeTextError } from '../services/ai-user-safe-errors.js';
import { integratedAiRateLimit } from '../middleware/integrated-ai-rate-limit.js';
import { uploadFiles } from '../middleware/file-upload.js';
import { normalizeDestinationUrl } from '../utils/pin-publish-destination.js';
import { safeTransitionArticleLifecycle } from '../services/article-lifecycle.js';
import {
	getWorkspaceActor,
	stampCreateOwnership,
	stampUpdateOwnership,
	andWorkspaceScope,
	listWorkspaceResources,
	listWorkspaceResourcesFull,
	getWorkspaceOwnedRecord,
	assertWorkspaceOwnedRecord,
} from '../services/workspace-ownership.js';

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

function stripUserUnsafeAiMetadata(metadata) {
	if (Array.isArray(metadata)) {
		return metadata.map(stripUserUnsafeAiMetadata);
	}
	if (!metadata || typeof metadata !== 'object') {
		return metadata;
	}
	const unsafe = /provider|model|endpoint|credential|secret|health|priority|adapter|source/i;
	return Object.fromEntries(
		Object.entries(metadata)
			.filter(([key]) => !unsafe.test(key))
			.map(([key, value]) => [key, stripUserUnsafeAiMetadata(value)]),
	);
}

function mapUserHistoryAnalysis(analysis) {
	return stripUserUnsafeAiMetadata(analysis) || null;
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

async function getOwnedWebsite({ websiteId, req }) {
	const site = await pocketbaseClient.collection('websites').getOne(websiteId).catch(() => null);
	if (!site) {
		throw httpError(404, 'Website not found');
	}
	const storedOwnerId = getOwnerId(site);
	// Never claim orphan websites by ID — ownership is assigned only by admin/onboarding.
	if (!storedOwnerId) {
		throw httpError(403, 'Website has no owner and cannot be claimed via this endpoint');
	}
	return assertWorkspaceOwnedRecord(site, req, { notFoundMessage: 'Website not found' });
}

function workspaceOwnerId(req) {
	return getWorkspaceActor(req).workspaceOwnerId || req.pocketbaseUserId;
}

async function getOwnedAiPin({ pinId, req }) {
	return getWorkspaceOwnedRecord('ai_pins', pinId, req, { notFoundMessage: 'Pin not found' });
}

async function getOwnedWebsiteArticle({ articleId, req }) {
	const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!article) {
		throw httpError(404, 'Article not found');
	}
	const websiteId = typeof article.websiteId === 'string'
		? article.websiteId
		: (article.websiteId?.id || article.website || article.website_id || '');
	if (!websiteId) {
		throw httpError(404, 'Article not found');
	}
	await getOwnedWebsite({ websiteId, req });
	return article;
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

	await getOwnedWebsite({ websiteId, req });
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
		owner: workspaceOwnerId(req),
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

	const article = await getOwnedWebsiteArticle({ articleId: req.params.articleId, req });
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

	const site = await getOwnedWebsite({ websiteId, req });
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
		payload: stampCreateOwnership(req, {
			[schema.websiteField]: websiteId,
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
		}),
		context: 'ai-pins:manual-article',
		requiredKeys: [schema.websiteField, 'owner', 'url', 'title', schema.statusField],
	});

	payload[schema.websiteField] = websiteId;
	payload.owner = workspaceOwnerId(req);
	payload[schema.statusField] = 'imported';

	try {
		const created = await pocketbaseClient.collection('website_articles').create(payload);
		logger.info('Manual AI pin article created', {
			articleId: created.id,
			websiteId,
			owner: workspaceOwnerId(req),
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
	res.json(await getUserCreditUsage(
		pocketbaseClient,
		workspaceOwnerId(req),
		req.workspaceKey,
	));
});

router.post('/analyze', integratedAiRateLimit, async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const articleId = normalizeOptionalString(req.body?.articleId, 'articleId', 64);
	const style = normalizeOptionalString(req.body?.style, 'style', 64) || '';
	const channel = normalizeStudioPromptChannel(req.body?.channel);
	if (!articleId) {
		throw httpError(422, 'articleId is required');
	}

	const articleRecord = await getOwnedWebsiteArticle({ articleId, req });
	const ownerId = workspaceOwnerId(req);

	const article = mapArticle(articleRecord);
	const promptPack = await resolvePromptPackForRequest({ channel });
	let analysis;
	try {
		analysis = await withPinTextFeatureCredits({
			workspaceKey: req.workspaceKey,
			feature: ANALYZE_CREDIT_FEATURE,
			actorUserId: req.pocketbaseUserId,
			referenceId: articleId,
			idempotencyKey: typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : '',
			reason: 'AI pin analysis',
			metadata: { route: 'ai-pins/analyze', style, channel },
			wallet: {
				workspaceName: req.workspace?.name || String(req.workspaceKey ?? '').trim(),
				ownerEmail: req.workspaceUser?.email || req.pocketbaseUser?.email || '',
				planSlug: req.workspaceSubscription?.expand?.plan?.slug
					|| req.workspace?.plan_slug
					|| req.workspaceUser?.plan
					|| 'free',
			},
		}, async () => {
			await safeTransitionArticleLifecycle(articleId, 'AI_GENERATING', {
				ownerId,
				source: 'ai_pins.analyze',
				message: 'AI analysis started',
				force: true,
			});
			return analyzeArticleForPin({
				owner: ownerId,
				article,
				style,
				channel,
				promptPack,
			});
		});
	} catch (error) {
		if (error?.status === 402 || error?.status === 422 || error?.status === 409) {
			throw error;
		}
		logger.error('AI pin analysis failed', { message: error?.message });
		await safeTransitionArticleLifecycle(articleId, 'FAILED', {
			ownerId,
			source: 'ai_pins.analyze',
			message: userSafeTextError(),
			failureReason: userSafeTextError(),
			failedStage: 'AI_GENERATING',
			force: true,
		});
		throw httpError(503, userSafeTextError());
	}

	const charged = isBillableAiResultSource(analysis?.source);

	await recordGenerationHistory(pocketbaseClient, stampCreateOwnership(req, {
		owner: ownerId,
		articleId,
		websiteId: article.websiteId || '',
		event_type: 'analyze',
		analysis,
		metadata: { style, channel, billed: Boolean(charged), resultSource: analysis?.source || null },
		ai_credits_used: charged ? 1 : 0,
		image_credits_used: 0,
	}));

	await safeTransitionArticleLifecycle(articleId, 'AI_COMPLETED', {
		ownerId,
		source: 'ai_pins.analyze',
		message: 'AI analysis completed',
		force: true,
	});
	await safeTransitionArticleLifecycle(articleId, 'READY_FOR_PINS', {
		ownerId,
		source: 'ai_pins.analyze',
		message: 'Article ready for pin generation',
		force: true,
	});

	const credits = await getUserCreditUsage(pocketbaseClient, ownerId, req.workspaceKey);
	res.json({ analysis: mapUserHistoryAnalysis(analysis), credits });
});

router.post('/prompts', integratedAiRateLimit, async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const articleId = normalizeOptionalString(req.body?.articleId, 'articleId', 64);
	const style = normalizeOptionalString(req.body?.style, 'style', 64) || '';
	const channel = normalizeStudioPromptChannel(req.body?.channel);
	const analysis = req.body?.analysis && typeof req.body.analysis === 'object' ? req.body.analysis : null;
	if (!articleId) {
		throw httpError(422, 'articleId is required');
	}

	const articleRecord = await getOwnedWebsiteArticle({ articleId, req });
	const ownerId = workspaceOwnerId(req);

	const article = mapArticle(articleRecord);
	const promptPack = await resolvePromptPackForRequest({ channel });
	const analysisProvided = Boolean(analysis);
	let resolvedAnalysis;
	let promptResult;
	try {
		let lifecycleStarted = false;
		const startPromptLifecycle = async () => {
			if (lifecycleStarted) return;
			lifecycleStarted = true;
			await safeTransitionArticleLifecycle(articleId, 'AI_GENERATING', {
				ownerId,
				source: 'ai_pins.prompts',
				message: 'AI prompt generation started',
				force: true,
			});
		};
		const creditWallet = {
			workspaceName: req.workspace?.name || String(req.workspaceKey ?? '').trim(),
			ownerEmail: req.workspaceUser?.email || req.pocketbaseUser?.email || '',
			planSlug: req.workspaceSubscription?.expand?.plan?.slug
				|| req.workspace?.plan_slug
				|| req.workspaceUser?.plan
				|| 'free',
		};
		const rawIdempotency = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
		const out = await withAnalyzeAndPromptCredits({
			analysisProvided,
			workspaceKey: req.workspaceKey,
			actorUserId: req.pocketbaseUserId,
			referenceId: articleId,
			analyzeIdempotencyKey: rawIdempotency ? `${rawIdempotency}:analyze` : '',
			promptIdempotencyKey: rawIdempotency ? `${rawIdempotency}:prompt` : '',
			analyzeMetadata: { route: 'ai-pins/prompts', style, channel },
			promptMetadata: { route: 'ai-pins/prompts', style, channel },
			wallet: creditWallet,
			runAnalyze: async () => {
				await startPromptLifecycle();
				return analyzeArticleForPin({
					owner: ownerId,
					article,
					style,
					channel,
					promptPack,
				});
			},
			runPrompt: async (resolved) => {
				await startPromptLifecycle();
				return generateImagePromptForPin({
					owner: ownerId,
					article,
					analysis: resolved || analysis,
					style,
					channel,
					promptPack,
				});
			},
		});
		resolvedAnalysis = analysisProvided ? analysis : out.resolvedAnalysis;
		promptResult = out.promptResult;
	} catch (error) {
		if (error?.status === 402 || error?.status === 422 || error?.status === 409) {
			throw error;
		}
		logger.error('AI pin prompt generation failed', { message: error?.message });
		await safeTransitionArticleLifecycle(articleId, 'FAILED', {
			ownerId,
			source: 'ai_pins.prompts',
			message: userSafeTextError(),
			failureReason: userSafeTextError(),
			failedStage: 'AI_GENERATING',
			force: true,
		});
		throw httpError(503, userSafeTextError());
	}

	const analyzeCharged = !analysisProvided && isBillableAiResultSource(resolvedAnalysis?.source);
	const promptCharged = isBillableAiResultSource(promptResult?.source);
	const aiCreditsUsed = (analyzeCharged ? 1 : 0) + (promptCharged ? 1 : 0);

	await recordGenerationHistory(pocketbaseClient, stampCreateOwnership(req, {
		owner: ownerId,
		articleId,
		websiteId: article.websiteId || '',
		event_type: 'prompt',
		prompt: promptResult.imagePrompt,
		analysis: resolvedAnalysis,
		metadata: {
			style: promptResult.style,
			channel,
			source: promptResult.source,
			analysisSource: resolvedAnalysis?.source || null,
			billedAnalyze: Boolean(analyzeCharged),
			billedPrompt: Boolean(promptCharged),
		},
		ai_credits_used: aiCreditsUsed,
		image_credits_used: 0,
	}));

	await safeTransitionArticleLifecycle(articleId, 'AI_COMPLETED', {
		ownerId,
		source: 'ai_pins.prompts',
		message: 'AI prompt generation completed',
		force: true,
	});
	await safeTransitionArticleLifecycle(articleId, 'READY_FOR_PINS', {
		ownerId,
		source: 'ai_pins.prompts',
		message: 'Article ready for pin generation',
		force: true,
	});

	const credits = await getUserCreditUsage(pocketbaseClient, ownerId, req.workspaceKey);
	res.json({
		...stripUserUnsafeAiMetadata(promptResult || {}),
		analysis: mapUserHistoryAnalysis(resolvedAnalysis),
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
		const result = await listWorkspaceResources('ai_pin_generation_history', req, {
			page,
			perPage,
			sort: '-created',
		});
		res.json({
			items: result.items.map((item) => ({
				id: item.id,
				eventType: item.event_type,
				prompt: item.prompt || '',
				imageUrl: item.image_url || '',
				analysis: mapUserHistoryAnalysis(item.analysis),
				metadata: item.metadata && typeof item.metadata === 'object'
					? stripUserUnsafeAiMetadata(item.metadata)
					: null,
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

/**
 * DELETE /ai-pins/history/:id
 * Remove a generation history row only — does not delete pins, images, articles, or credits.
 */
router.delete('/history/:id', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const existing = await getWorkspaceOwnedRecord('ai_pin_generation_history', req.params.id, req, {
		notFoundMessage: 'History record not found',
	}).catch(() => null);
	if (!existing) {
		throw httpError(404, 'History record not found');
	}

	await pocketbaseClient.collection('ai_pin_generation_history').delete(existing.id);
	res.status(204).end();
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
		const items = await listWorkspaceResourcesFull('brand_kits', req, { sort: '-updated' });
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
	const payload = stampCreateOwnership(req, {
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
	});

	if (payload.is_default) {
		const existing = await listWorkspaceResourcesFull('brand_kits', req, {
			extraFilter: 'is_default = true',
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
	const existing = await getWorkspaceOwnedRecord('brand_kits', req.params.id, req, {
		notFoundMessage: 'Brand kit not found',
	}).catch(() => null);
	if (!existing) {
		throw httpError(404, 'Brand kit not found');
	}

	const updates = stampUpdateOwnership(req, {});
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
			const others = await listWorkspaceResourcesFull('brand_kits', req, {
				extraFilter: 'is_default = true',
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
	const existing = await getWorkspaceOwnedRecord('brand_kits', req.params.id, req, {
		notFoundMessage: 'Brand kit not found',
	}).catch(() => null);
	if (!existing) {
		throw httpError(404, 'Brand kit not found');
	}
	await pocketbaseClient.collection('brand_kits').delete(existing.id);
	res.status(204).end();
});

router.get('/reference-images', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}

	const records = await listWorkspaceResourcesFull('ai_pin_reference_images', req, {
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

	const existing = await listWorkspaceResourcesFull('ai_pin_reference_images', req, {
		sort: '-created',
	}).catch(() => []);

	const remaining = Math.max(0, MAX_REFERENCE_IMAGES - existing.length);
	if (remaining <= 0) {
		throw httpError(422, `You can store up to ${MAX_REFERENCE_IMAGES} reference images`);
	}

	const toUpload = files.slice(0, remaining);
	const created = [];
	const actor = getWorkspaceActor(req);

	for (const file of toUpload) {
		const originalName = String(file.originalname || 'reference').slice(0, 255);
		const formData = new FormData();
		formData.append('owner', actor.workspaceOwnerId || actor.creatorId);
		if (actor.workspaceId) formData.append('workspace', actor.workspaceId);
		if (actor.creatorId) formData.append('created_by', actor.creatorId);
		if (actor.editorId) formData.append('last_edited_by', actor.editorId);
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

	const existing = await getWorkspaceOwnedRecord('ai_pin_reference_images', req.params.id, req, {
		notFoundMessage: 'Reference image not found',
	}).catch(() => null);
	if (!existing) {
		throw httpError(404, 'Reference image not found');
	}

	await pocketbaseClient.collection('ai_pin_reference_images').delete(existing.id);
	res.status(204).end();
});

/**
 * GET /ai-pins/pins?websiteId=
 * List AI pins for a website (API-gated; replaces direct PB SDK list).
 */
router.get('/pins', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	const websiteId = String(req.query.websiteId || '').trim();
	if (!websiteId) {
		throw httpError(422, 'websiteId is required');
	}
	await getOwnedWebsite({ websiteId, req });

	const pins = await listWorkspaceResourcesFull('ai_pins', req, {
		extraFilter: pocketbaseClient.filter('websiteId = {:websiteId}', { websiteId }),
		sort: '-created',
	}).catch(() => []);

	res.json({ items: pins });
});

/**
 * GET /ai-pins/pins/:pinId
 */
router.get('/pins/:pinId', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	const pin = await getOwnedAiPin({ pinId: req.params.pinId, req });
	res.json(pin);
});

/**
 * PATCH /ai-pins/pins/:pinId
 * General owned-pin field update (regenerate / scheduling targets).
 */
router.patch('/pins/:pinId', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	await ensureAiPinsPublishFields(pocketbaseClient);
	const pin = await getOwnedAiPin({ pinId: req.params.pinId, req });

	const updates = {};
	const body = req.body && typeof req.body === 'object' ? req.body : {};
	const stringFields = [
		['title', 'title', 300],
		['description', 'description', 2000],
		['overlay_text', 'overlay_text', 600],
		['overlayText', 'overlay_text', 600],
		['image_prompt', 'image_prompt', 4000],
		['imagePrompt', 'image_prompt', 4000],
		['image_url', 'image_url', 1000],
		['imageUrl', 'image_url', 1000],
		['source_url', 'source_url', 2000],
		['sourceUrl', 'source_url', 2000],
		['cta', 'cta', 300],
		['style', 'style', 64],
		['target_audience', 'target_audience', 200],
		['targetAudience', 'target_audience', 200],
		['tone_of_voice', 'tone_of_voice', 100],
		['toneOfVoice', 'tone_of_voice', 100],
		['language', 'language', 60],
		['pinterest_account_id', 'pinterest_account_id', 80],
		['pinterest_account_label', 'pinterest_account_label', 200],
		['pinterest_board_id', 'pinterest_board_id', 120],
		['pinterest_board_name', 'pinterest_board_name', 200],
		['scheduled_at', 'scheduled_at', 64],
		['scheduled_timezone', 'scheduled_timezone', 64],
		['image_origin', 'image_origin', 32],
	];
	for (const [from, to, max] of stringFields) {
		if (typeof body[from] === 'string') {
			updates[to] = body[from].trim().slice(0, max);
		}
	}
	if (Array.isArray(body.suggested_keywords)) updates.suggested_keywords = body.suggested_keywords;
	if (Array.isArray(body.suggestedKeywords)) updates.suggested_keywords = body.suggestedKeywords;
	if (Array.isArray(body.suggested_hashtags)) updates.suggested_hashtags = body.suggested_hashtags;
	if (Array.isArray(body.suggestedHashtags)) updates.suggested_hashtags = body.suggestedHashtags;
	if (body.analysis && typeof body.analysis === 'object') updates.analysis = body.analysis;
	if (body.editor_state && typeof body.editor_state === 'object') updates.editor_state = body.editor_state;

	if (Object.keys(updates).length === 0) {
		return res.json(pin);
	}

	const updated = await pocketbaseClient.collection('ai_pins').update(pin.id, stampUpdateOwnership(req, updates));
	res.json(updated);
});

/**
 * DELETE /ai-pins/pins/:pinId
 */
router.delete('/pins/:pinId', async (req, res) => {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in');
	}
	const pin = await getOwnedAiPin({ pinId: req.params.pinId, req });
	await pocketbaseClient.collection('ai_pins').delete(pin.id);
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
			payload: stampCreateOwnership(req, {
				...item,
				source_url: sourceUrl.slice(0, 2000),
				image_origin: String(item?.image_origin || item?.imageOrigin || '').trim().slice(0, 32),
				status: 'draft',
			}),
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
		const pin = await getOwnedAiPin({ pinId, req });

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
	const pin = await getOwnedAiPin({ pinId: req.params.pinId, req });

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

	// Pinterest / schedule targets (formerly updated via direct PB SDK).
	if (typeof req.body?.pinterestAccountId === 'string') {
		updates.pinterest_account_id = req.body.pinterestAccountId.trim().slice(0, 80);
	}
	if (typeof req.body?.pinterestAccountLabel === 'string') {
		updates.pinterest_account_label = req.body.pinterestAccountLabel.trim().slice(0, 200);
	}
	if (typeof req.body?.pinterestBoardId === 'string') {
		updates.pinterest_board_id = req.body.pinterestBoardId.trim().slice(0, 120);
	}
	if (typeof req.body?.pinterestBoardName === 'string') {
		updates.pinterest_board_name = req.body.pinterestBoardName.trim().slice(0, 200);
	}
	if (typeof req.body?.scheduledAt === 'string') {
		updates.scheduled_at = req.body.scheduledAt.trim().slice(0, 64);
	}
	if (typeof req.body?.scheduledTimezone === 'string') {
		updates.scheduled_timezone = req.body.scheduledTimezone.trim().slice(0, 64);
	}

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

	const updated = await pocketbaseClient.collection('ai_pins').update(pin.id, stampUpdateOwnership(req, updates));
	await recordGenerationHistory(pocketbaseClient, stampCreateOwnership(req, {
		owner: workspaceOwnerId(req),
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
	}));

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
		pinterest_account_id: updated.pinterest_account_id || '',
		pinterest_account_label: updated.pinterest_account_label || '',
		pinterest_board_id: updated.pinterest_board_id || '',
		pinterest_board_name: updated.pinterest_board_name || '',
		scheduled_at: updated.scheduled_at || '',
		scheduled_timezone: updated.scheduled_timezone || '',
		publish_job_id: updated.publish_job_id || '',
		status: updated.status || '',
		articleId: updated.articleId || '',
		websiteId: updated.websiteId || '',
		created: updated.created,
		updated: updated.updated,
	});
});

export default router;
