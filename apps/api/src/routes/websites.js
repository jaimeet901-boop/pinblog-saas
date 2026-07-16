import { Router } from 'express';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { encryptSecret, isEncryptedSecret } from '../utils/secretCrypto.js';
import logger from '../utils/logger.js';
import { scanWebsiteArticles } from '../services/website-article-discovery.js';
import { getCache, setCache } from '../utils/cache.js';

const router = Router();
const WEBSITE_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 10;
const WEBSITE_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function normalizeUrl(value) {
	if (value == null || value === '') {
		return '';
	}

	if (typeof value !== 'string') {
		throw httpError(422, 'url must be a string');
	}

	let parsed;
	try {
		parsed = new URL(value.trim());
	} catch {
		throw httpError(422, 'Invalid website URL');
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw httpError(422, 'Please enter a valid website URL starting with http:// or https://');
	}

	return parsed.origin;
}

function safeNormalizeUrl(value) {
	try {
		return normalizeUrl(value);
	} catch {
		return '';
	}
}

function deriveDomain(url) {
	const hostname = new URL(url).hostname.toLowerCase();
	return hostname.replace(/^www\./, '');
}

function normalizeDomainToUrl(domain) {
	if (typeof domain !== 'string' || !domain.trim()) {
		return '';
	}

	const trimmed = domain.trim();
	const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	return safeNormalizeUrl(withProtocol);
}

function toAbsoluteUrl(baseUrl, maybeRelative) {
	if (!maybeRelative || typeof maybeRelative !== 'string') {
		return '';
	}

	try {
		return new URL(maybeRelative, baseUrl).toString();
	} catch {
		return '';
	}
}

function extractTitleFromHtml(html) {
	if (typeof html !== 'string' || !html) {
		return '';
	}

	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match?.[1]) {
		return '';
	}

	return match[1].replace(/\s+/g, ' ').trim();
}

function extractFaviconFromHtml({ html, baseUrl }) {
	if (typeof html !== 'string' || !html) {
		return `${baseUrl}/favicon.ico`;
	}

	const iconRegex = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi;
	const hrefRegex = /href=["']([^"']+)["']/i;
	const iconTag = html.match(iconRegex)?.[0];
	const href = iconTag?.match(hrefRegex)?.[1];

	return toAbsoluteUrl(baseUrl, href) || `${baseUrl}/favicon.ico`;
}

async function fetchWebsiteMetadata({ url }) {
	const cacheKey = `website-metadata:${url}`;
	const cached = getCache(cacheKey);
	if (cached) {
		return cached;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), WEBSITE_FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Accept': 'text/html,application/xhtml+xml',
				'User-Agent': 'ChefIA Website Scanner/1.0',
			},
			signal: controller.signal,
			redirect: 'follow',
		});

		if (!response.ok) {
			throw httpError(422, `Unable to access website (${response.status} ${response.statusText})`);
		}

		const finalUrl = normalizeUrl(response.url || url);
		const html = await response.text();
		const domain = deriveDomain(finalUrl);
		const name = extractTitleFromHtml(html) || domain;
		const favicon = extractFaviconFromHtml({ html, baseUrl: finalUrl });

		const payload = {
			name,
			url: finalUrl,
			domain,
			favicon,
		};

		setCache(cacheKey, payload, WEBSITE_METADATA_CACHE_TTL_MS);

		return payload;
	} catch (error) {
		if (error?.name === 'AbortError') {
			throw httpError(504, 'Website metadata request timed out. Please try again.');
		}

		if (error?.status) {
			throw error;
		}

		throw httpError(422, 'Unable to fetch website metadata. Please check the URL and try again.');
	} finally {
		clearTimeout(timeout);
	}
}

function normalizeOptionalString(value, fieldName, max = 0) {
	if (value == null) {
		return '';
	}

	if (typeof value !== 'string') {
		throw httpError(422, `${fieldName} must be a string`);
	}

	const normalized = value.trim();

	if (max > 0 && normalized.length > max) {
		throw httpError(422, `${fieldName} must be ${max} characters or less`);
	}

	return normalized;
}

function normalizePositiveInt(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}

	return parsed;
}

function escapeFilterValue(value) {
	return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildArticleFilters({ websiteId, owner, search, status, category, dateFrom, dateTo }) {
	const filters = [
		`websiteId = "${escapeFilterValue(websiteId)}"`,
		`owner = "${escapeFilterValue(owner)}"`,
	];

	if (search) {
		const safeSearch = escapeFilterValue(search);
		filters.push(`(title ~ "${safeSearch}" || slug ~ "${safeSearch}" || url ~ "${safeSearch}")`);
	}

	if (status) {
		filters.push(`status = "${escapeFilterValue(status)}"`);
	}

	if (category) {
		filters.push(`category = "${escapeFilterValue(category)}"`);
	}

	if (dateFrom) {
		filters.push(`publish_date >= "${escapeFilterValue(dateFrom)}"`);
	}

	if (dateTo) {
		filters.push(`publish_date <= "${escapeFilterValue(dateTo)}"`);
	}

	return filters.join(' && ');
}

function mapArticle(record) {
	return {
		id: record.id,
		websiteId: record.websiteId,
		url: record.url,
		slug: record.slug,
		title: record.title,
		metaDescription: record.meta_description,
		featuredImage: record.featured_image,
		publishDate: record.publish_date,
		lastModifiedDate: record.last_modified_date,
		category: record.category,
		author: record.author,
		language: record.language,
		status: record.status,
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

function mapWebsite(site) {
	const hasPassword = typeof site.wp_app_password === 'string' && site.wp_app_password.length > 0;

	return {
		id: site.id,
		name: site.name,
		url: site.url,
		domain: site.domain,
		favicon: site.favicon,
		wp_username: site.wp_username,
		status: site.status,
		discovery_status: site.discovery_status || 'pending',
		last_scan_at: site.last_scan_at || '',
		next_scan_at: site.next_scan_at || '',
		last_scan_summary: site.last_scan_summary || null,
		created: site.created,
		updated: site.updated,
		has_wp_app_password: hasPassword,
		is_password_encrypted: isEncryptedSecret(site.wp_app_password),
	};
}

function getOwnerId(site) {
	if (!site?.owner) {
		return '';
	}

	if (typeof site.owner === 'string') {
		return site.owner;
	}

	if (Array.isArray(site.owner)) {
		return typeof site.owner[0] === 'string' ? site.owner[0] : site.owner[0]?.id || '';
	}

	if (typeof site.owner === 'object') {
		return site.owner.id || site.owner.value || '';
	}

	return String(site.owner);
}

async function ensureWebsiteUrlRecord(site) {
	if (!site?.id) {
		return site;
	}

	const normalizedStoredUrl = safeNormalizeUrl(site.url);
	if (normalizedStoredUrl) {
		if (site.url !== normalizedStoredUrl) {
			const normalizedRecord = await pocketbaseClient.collection('websites').update(site.id, {
				url: normalizedStoredUrl,
			}).catch(() => null);

			if (normalizedRecord) {
				logger.info('Website URL normalized from stored value', {
					websiteId: site.id,
					previousUrl: site.url || '',
					normalizedUrl: normalizedStoredUrl,
				});
				return normalizedRecord;
			}
		}

		return {
			...site,
			url: normalizedStoredUrl,
		};
	}

	const repairedUrl = normalizeDomainToUrl(site.domain);
	if (!repairedUrl) {
		return site;
	}

	const repairedRecord = await pocketbaseClient.collection('websites').update(site.id, {
		url: repairedUrl,
	}).catch(() => null);

	if (!repairedRecord) {
		return site;
	}

	logger.warn('Website URL auto-repaired from domain', {
		websiteId: site.id,
		domain: site.domain || '',
		repairedUrl,
	});

	return repairedRecord;
}

async function getOwnedWebsite({ websiteId, userId }) {
	const ownershipFilter = pocketbaseClient.filter('id = {:websiteId} && owner = {:owner}', {
		websiteId,
		owner: userId,
	});

	logger.info('Website access check started', {
		websiteId,
		authenticatedUserId: userId,
		finalQuery: ownershipFilter,
	});

	const ownedSite = await pocketbaseClient
		.collection('websites')
		.getFirstListItem(ownershipFilter)
		.catch(() => null);

	if (ownedSite) {
		const repairedOwnedSite = await ensureWebsiteUrlRecord(ownedSite);
		logger.info('Website access granted', {
			websiteId,
			authenticatedUserId: userId,
			storedOwnerId: getOwnerId(repairedOwnedSite),
		});
		return repairedOwnedSite;
	}

	const siteById = await pocketbaseClient.collection('websites').getOne(websiteId).catch(() => null);
	if (!siteById) {
		logger.warn('Website access denied - record not found', {
			websiteId,
			authenticatedUserId: userId,
			finalQuery: ownershipFilter,
		});
		throw httpError(404, 'Website not found');
	}

	const storedOwnerId = getOwnerId(siteById);
	logger.warn('Website access fallback check', {
		websiteId,
		authenticatedUserId: userId,
		storedOwnerId,
		finalQuery: ownershipFilter,
	});

	if (storedOwnerId === userId) {
		const repairedSiteById = await ensureWebsiteUrlRecord(siteById);
		logger.info('Website access granted via fallback owner comparison', {
			websiteId,
			authenticatedUserId: userId,
			storedOwnerId,
			finalQuery: ownershipFilter,
		});
		return repairedSiteById;
	}

	if (!storedOwnerId && userId) {
		const repaired = await pocketbaseClient
			.collection('websites')
			.update(siteById.id, { owner: userId })
			.catch(() => null);

		if (repaired) {
			const repairedWithUrl = await ensureWebsiteUrlRecord(repaired);
			logger.warn('Website owner auto-assigned during access fallback', {
				websiteId,
				authenticatedUserId: userId,
				storedOwnerId: getOwnerId(repairedWithUrl),
				finalQuery: ownershipFilter,
			});
			return repairedWithUrl;
		}
	}

	throw httpError(403, 'You do not have access to this website');
}

async function getWebsiteStats(site) {
	const collectionName = 'website_articles';
	const pbBaseUrl = process.env.PB_BASE_URL || 'http://localhost:8090';

	const totalFilter = pocketbaseClient.filter('websiteId = {:websiteId}', { websiteId: site.id });
	const newFilter = [
		totalFilter,
		pocketbaseClient.filter('status = {:status}', { status: 'new' }),
	].join(' && ');

	const queryStatsList = async ({ filter, sort = '', expand = '' }) => {
		const query = new URLSearchParams({
			page: '1',
			perPage: '1',
			filter,
			...(sort ? { sort } : {}),
			...(expand ? { expand } : {}),
		});
		const requestUrl = `${pbBaseUrl}/api/collections/${collectionName}/records?${query.toString()}`;

		try {
			return await pocketbaseClient.collection(collectionName).getList(1, 1, {
				filter,
				...(sort ? { sort } : {}),
				...(expand ? { expand } : {}),
			});
		} catch (error) {
			logger.error('Website stats query failed', {
				collection: collectionName,
				filter,
				expand,
				sort,
				requestUrl,
				pocketbaseErrorMessage: error?.message,
				pocketbaseErrorStatus: error?.status,
				pocketbaseErrorResponse: error?.response?.data || error?.response || null,
			});
			return null;
		}
	};

	const totalArticles = await queryStatsList({ filter: totalFilter });
	const newArticles = await queryStatsList({ filter: newFilter });

	return {
		totalArticles: totalArticles?.totalItems || 0,
		newArticles: newArticles?.totalItems || 0,
		lastScan: site.last_scan_at || '',
		nextScheduledScan: site.next_scan_at || '',
	};
}

router.get('/', async (req, res) => {
	const websites = await pocketbaseClient.collection('websites').getFullList({
		sort: '-created',
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: req.pocketbaseUserId }),
	});

	const repairedWebsites = [];
	for (const site of websites) {
		repairedWebsites.push(await ensureWebsiteUrlRecord(site));
	}

	res.json(repairedWebsites.map(mapWebsite));
});

router.get('/:websiteId', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	const stats = await getWebsiteStats(site);
	res.json({ ...mapWebsite(site), stats });
});

router.get('/:websiteId/stats', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	res.json(await getWebsiteStats(site));
});

router.get('/:websiteId/articles', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	const page = normalizePositiveInt(req.query.page, DEFAULT_PAGE);
	const perPage = Math.min(normalizePositiveInt(req.query.perPage, DEFAULT_PER_PAGE), 100);
	const search = normalizeOptionalString(req.query.search, 'search', 200);
	const status = normalizeOptionalString(req.query.status, 'status', 32).toLowerCase();
	const category = normalizeOptionalString(req.query.category, 'category', 255);
	const dateFrom = normalizeOptionalString(req.query.dateFrom, 'dateFrom', 64);
	const dateTo = normalizeOptionalString(req.query.dateTo, 'dateTo', 64);
	const filter = buildArticleFilters({ websiteId: site.id, owner: req.pocketbaseUserId, search, status, category, dateFrom, dateTo });

	const result = await pocketbaseClient.collection('website_articles').getList(page, perPage, {
		filter,
		sort: '-publish_date,-updated',
	});

	const allArticles = await pocketbaseClient.collection('website_articles').getFullList({
		filter: pocketbaseClient.filter('websiteId = {:websiteId} && owner = {:owner}', { websiteId: site.id, owner: req.pocketbaseUserId }),
		fields: 'id,category',
	});
	const categories = [...new Set(allArticles.map((article) => article.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));

	res.json({
		items: result.items.map(mapArticle),
		page: result.page,
		perPage: result.perPage,
		totalPages: result.totalPages,
		totalItems: result.totalItems,
		categories,
		totalArticles: allArticles.length,
	});
});

router.post('/metadata', async (req, res) => {
	const url = normalizeUrl(req.body?.url);

	if (!url) {
		throw httpError(422, 'Website URL is required');
	}

	const metadata = await fetchWebsiteMetadata({ url });

	res.json(metadata);
});

router.post('/', async (req, res) => {
	const requestedUrl = normalizeUrl(req.body?.url);
	if (!requestedUrl) {
		throw httpError(422, 'Website URL is required');
	}

	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in to add a website');
	}

	logger.info('Website create requested', {
		websiteId: '',
		authenticatedUserId: req.pocketbaseUserId,
		storedOwnerId: '',
		finalQuery: '',
	});

	const metadata = await fetchWebsiteMetadata({ url: requestedUrl });
	const normalizedWebsiteUrl = safeNormalizeUrl(metadata?.url) || requestedUrl;
	if (!normalizedWebsiteUrl) {
		throw httpError(422, 'Website URL is missing or invalid');
	}

	const name = normalizeOptionalString(req.body?.name, 'name', 120) || metadata.name;
	const favicon = normalizeOptionalString(req.body?.favicon, 'favicon', 500) || metadata.favicon;
	const domain = normalizeOptionalString(req.body?.domain, 'domain', 255) || metadata.domain || deriveDomain(normalizedWebsiteUrl);
	const username = normalizeOptionalString(req.body?.wp_username, 'wp_username', 120);
	const password = normalizeOptionalString(req.body?.wp_app_password, 'wp_app_password', 500);

	logger.info('Website create normalized fields', {
		authenticatedUserId: req.pocketbaseUserId,
		requestedUrl,
		metadataUrl: metadata?.url || '',
		normalizedWebsiteUrl,
		domain,
	});

	const record = await pocketbaseClient.collection('websites').create({
		owner: req.pocketbaseUserId,
		name,
		url: normalizedWebsiteUrl,
		domain,
		favicon,
		wp_username: username,
		...(password ? { wp_app_password: encryptSecret(password) } : {}),
		status: 'active',
		discovery_status: 'pending',
	});

	const savedRecord = getOwnerId(record) === req.pocketbaseUserId
		? record
		: await pocketbaseClient.collection('websites').update(record.id, { owner: req.pocketbaseUserId }).catch(() => record);
	const persistedRecord = await pocketbaseClient.collection('websites').getOne(savedRecord.id).catch(() => savedRecord);
	const repairedPersistedRecord = await ensureWebsiteUrlRecord(persistedRecord);

	logger.info('Website create completed', {
		websiteId: repairedPersistedRecord.id,
		authenticatedUserId: req.pocketbaseUserId,
		storedOwnerId: getOwnerId(repairedPersistedRecord),
		storedUrl: repairedPersistedRecord.url || '',
		storedDomain: repairedPersistedRecord.domain || '',
		finalQuery: '',
	});

	res.status(201).json(mapWebsite(repairedPersistedRecord));
});

router.post('/:websiteId/scan', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });

	logger.info('Scan website record loaded from PocketBase', {
		websiteId: site?.id || req.params.websiteId,
		owner: getOwnerId(site),
		name: site?.name || '',
		url: site?.url || '',
		domain: site?.domain || '',
		discovery_status: site?.discovery_status || '',
	});

	logger.info('Scan website URL field value', {
		websiteId: site?.id || req.params.websiteId,
		websiteUrlField: site?.url,
		websiteUrlFieldType: typeof site?.url,
	});

	const computedBaseUrl = normalizeUrl(site?.url);
	logger.info('Scan computed base URL', {
		websiteId: site?.id || req.params.websiteId,
		computedBaseUrl,
	});

	if (!computedBaseUrl) {
		logger.warn('Scan aborted because website URL is missing or invalid', {
			websiteId: site?.id || req.params.websiteId,
			websiteUrlField: site?.url,
		});
		throw httpError(422, 'Website URL is missing or invalid for this record. Please update the website URL and try again.');
	}

	const siteForScan = {
		...site,
		url: computedBaseUrl,
	};

	const runId = `${site.id}-${Date.now()}`;

	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');

	const pushEvent = (event) => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	};

	await pocketbaseClient.collection('websites').update(site.id, { discovery_status: 'running' }).catch(() => {});
	pushEvent({ type: 'progress', stage: 'init', message: 'Website scan started' });

	try {
		const summary = await scanWebsiteArticles({
			pocketbaseClient,
			website: siteForScan,
			runId,
			onProgress: pushEvent,
			logger,
		});

		pushEvent({ type: 'completed', summary });
	} catch (error) {
		await pocketbaseClient.collection('websites').update(site.id, {
			discovery_status: 'failed',
			last_scan_summary: {
				found: 0,
				newArticles: 0,
				updatedArticles: 0,
				errors: [error.message],
				lastScanAt: new Date().toISOString(),
			},
		}).catch(() => {});

		pushEvent({ type: 'error', message: error.message || 'Website scan failed' });
	} finally {
		res.end();
	}
});

router.patch('/:websiteId', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });

	const updates = {};

	if ('name' in (req.body ?? {})) {
		const name = normalizeOptionalString(req.body?.name, 'name', 120);
		if (!name) {
			throw httpError(422, 'name is required');
		}
		updates.name = name;
	}

	if ('url' in (req.body ?? {})) {
		const normalized = normalizeUrl(req.body?.url);
		if (!normalized) {
			throw httpError(422, 'Website URL is required');
		}

		const metadata = await fetchWebsiteMetadata({ url: normalized });
		updates.url = metadata.url;
		updates.domain = metadata.domain;
		updates.favicon = metadata.favicon;

		if (!('name' in (req.body ?? {}))) {
			updates.name = metadata.name;
		}
	}

	if ('domain' in (req.body ?? {})) {
		updates.domain = normalizeOptionalString(req.body?.domain, 'domain', 255);
	}

	if ('favicon' in (req.body ?? {})) {
		updates.favicon = normalizeOptionalString(req.body?.favicon, 'favicon', 500);
	}

	if ('wp_username' in (req.body ?? {})) {
		updates.wp_username = normalizeOptionalString(req.body?.wp_username, 'wp_username', 120);
	}

	if ('wp_app_password' in (req.body ?? {})) {
		const password = normalizeOptionalString(req.body?.wp_app_password, 'wp_app_password', 500);
		updates.wp_app_password = password ? encryptSecret(password) : '';
	}

	if (Object.keys(updates).length === 0) {
		return res.json(mapWebsite(site));
	}

	if ('status' in (req.body ?? {})) {
		const status = normalizeOptionalString(req.body?.status, 'status', 32).toLowerCase();
		updates.status = status || 'active';
	}

	if ('discovery_status' in (req.body ?? {})) {
		const discoveryStatus = normalizeOptionalString(req.body?.discovery_status, 'discovery_status', 32).toLowerCase();
		updates.discovery_status = discoveryStatus || 'pending';
	}

	const updated = await pocketbaseClient.collection('websites').update(site.id, updates);

	res.json(mapWebsite(updated));
});

router.delete('/:websiteId', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	await pocketbaseClient.collection('websites').delete(site.id);
	res.status(204).send();
});

export default router;
