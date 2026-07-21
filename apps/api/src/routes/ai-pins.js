import { Router } from 'express';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { ensureWebsiteArticlesSchema } from '../utils/ensure-website-articles-schema.js';
import { listWebsiteArticles } from '../services/website-article-discovery.js';
import { sanitizeCollectionPayload } from '../utils/pocketbase-safe-query.js';

const router = Router();

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

export default router;
