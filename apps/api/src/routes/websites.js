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
const SCHEMA_CACHE_TTL_MS = 60 * 1000;

const WEBSITE_URL_FIELD_CANDIDATES = ['url', 'website_url', 'site_url', 'websiteUrl', 'siteUrl'];
const WEBSITE_DOMAIN_FIELD_CANDIDATES = ['domain', 'website_domain', 'site_domain', 'websiteDomain'];
const WEBSITE_DISCOVERY_STATUS_FIELD_CANDIDATES = ['discovery_status', 'discoveryStatus'];
const WEBSITE_STATUS_FIELD_CANDIDATES = ['status'];
const WEBSITE_OWNER_FIELD_CANDIDATES = ['owner'];

const WEBSITE_ARTICLES_WEBSITE_FIELD_CANDIDATES = ['websiteId', 'website_id', 'website', 'siteId'];
const WEBSITE_ARTICLES_STATUS_FIELD_CANDIDATES = ['status', 'article_status', 'state'];

const collectionSchemaCache = new Map();

function sanitizeUrlInput(value) {
	if (typeof value !== 'string') {
		return value;
	}

	// Remove invisible Unicode and replacement chars that can pass app validation
	// but fail PocketBase URL normalization, resulting in empty stored values.
	return value
		.replace(/[\u200B-\u200D\u2060\uFEFF\uFFFD]/g, '')
		.trim();
}

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

	const cleanedValue = sanitizeUrlInput(value);

	let parsed;
	try {
		parsed = new URL(cleanedValue);
	} catch {
		throw httpError(422, 'Invalid website URL');
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw httpError(422, 'Please enter a valid website URL starting with http:// or https://');
	}

	parsed.hash = '';
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

function getFieldValue(record, candidates) {
	for (const field of candidates) {
		if (record?.[field] != null && record?.[field] !== '') {
			return record[field];
		}
	}

	return '';
}

async function getCollectionFieldNames(collectionName) {
	const cached = collectionSchemaCache.get(collectionName);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.fields;
	}

	const model = await pocketbaseClient.collections.getOne(collectionName);
	const fields = new Set((model?.fields || []).map((field) => field?.name).filter(Boolean));

	collectionSchemaCache.set(collectionName, {
		fields,
		expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
	});

	return fields;
}

function resolveSchemaField(fields, candidates, fallback) {
	for (const candidate of candidates) {
		if (fields.has(candidate)) {
			return candidate;
		}
	}

	return fallback;
}

async function resolveWebsitesSchema() {
	const model = await pocketbaseClient.collections.getOne('websites');
	const fields = new Set((model?.fields || []).map((field) => field?.name).filter(Boolean));
	collectionSchemaCache.set('websites', {
		fields,
		expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
	});

	const schema = {
		ownerField: resolveSchemaField(fields, WEBSITE_OWNER_FIELD_CANDIDATES, 'owner'),
		urlField: resolveSchemaField(fields, WEBSITE_URL_FIELD_CANDIDATES, 'url'),
		domainField: resolveSchemaField(fields, WEBSITE_DOMAIN_FIELD_CANDIDATES, 'domain'),
		discoveryStatusField: resolveSchemaField(fields, WEBSITE_DISCOVERY_STATUS_FIELD_CANDIDATES, 'discovery_status'),
		statusField: resolveSchemaField(fields, WEBSITE_STATUS_FIELD_CANDIDATES, 'status'),
	};
	const urlFieldDefinition = (model?.fields || []).find((field) => field?.name === schema.urlField) || null;

	logger.info('Websites schema resolved', {
		collection: 'websites',
		schema,
		urlFieldDefinition,
		createRule: model?.createRule ?? null,
		updateRule: model?.updateRule ?? null,
	});

	return schema;
}

async function createWebsiteRecord({ payload, urlField, context }) {
	logger.info('PocketBase createRecord payload', {
		context,
		collection: 'websites',
		urlField,
		payload,
		payloadUrl: payload?.[urlField],
	});

	const record = await pocketbaseClient.collection('websites').create(payload);

	logger.info('PocketBase createRecord response', {
		context,
		collection: 'websites',
		urlField,
		recordId: record?.id || '',
		responseUrl: record?.[urlField],
		hasUrlField: Object.prototype.hasOwnProperty.call(record || {}, urlField),
		record,
	});

	return record;
}

async function updateWebsiteRecord({ id, payload, urlField, context }) {
	logger.info('PocketBase updateRecord payload', {
		context,
		collection: 'websites',
		recordId: id,
		urlField,
		payload,
		payloadUrl: payload?.[urlField],
	});

	const record = await pocketbaseClient.collection('websites').update(id, payload);

	logger.info('PocketBase updateRecord response', {
		context,
		collection: 'websites',
		recordId: record?.id || id,
		urlField,
		responseUrl: record?.[urlField],
		hasUrlField: Object.prototype.hasOwnProperty.call(record || {}, urlField),
		record,
	});

	return record;
}

async function resolveWebsiteArticlesSchema() {
	const fields = await getCollectionFieldNames('website_articles');
	const schema = {
		websiteField: resolveSchemaField(fields, WEBSITE_ARTICLES_WEBSITE_FIELD_CANDIDATES, 'websiteId'),
		statusField: resolveSchemaField(fields, WEBSITE_ARTICLES_STATUS_FIELD_CANDIDATES, 'status'),
	};

	logger.info('Website articles schema resolved', {
		collection: 'website_articles',
		schema,
	});

	return schema;
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

function buildArticleFilters({ websiteId, owner, search, status, category, dateFrom, dateTo, websiteField, statusField }) {
	const filters = [
		`${websiteField} = "${escapeFilterValue(websiteId)}"`,
		`owner = "${escapeFilterValue(owner)}"`,
	];

	if (search) {
		const safeSearch = escapeFilterValue(search);
		filters.push(`(title ~ "${safeSearch}" || slug ~ "${safeSearch}" || url ~ "${safeSearch}")`);
	}

	if (status) {
		filters.push(`${statusField} = "${escapeFilterValue(status)}"`);
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
		websiteId: getFieldValue(record, WEBSITE_ARTICLES_WEBSITE_FIELD_CANDIDATES),
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
		status: getFieldValue(record, WEBSITE_ARTICLES_STATUS_FIELD_CANDIDATES),
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

function mapWebsite(site) {
	const url = getFieldValue(site, WEBSITE_URL_FIELD_CANDIDATES);
	const domain = getFieldValue(site, WEBSITE_DOMAIN_FIELD_CANDIDATES);
	const status = getFieldValue(site, WEBSITE_STATUS_FIELD_CANDIDATES);
	const discoveryStatus = getFieldValue(site, WEBSITE_DISCOVERY_STATUS_FIELD_CANDIDATES);
	const hasPassword = typeof site.wp_app_password === 'string' && site.wp_app_password.length > 0;

	return {
		id: site.id,
		name: site.name,
		url,
		domain,
		favicon: site.favicon,
		wp_username: site.wp_username,
		status,
		discovery_status: discoveryStatus || 'pending',
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

async function getOwnedWebsite({ websiteId, userId }) {
	const websitesSchema = await resolveWebsitesSchema();
	const ownershipFilter = pocketbaseClient.filter(`id = {:websiteId} && ${websitesSchema.ownerField} = {:owner}`, {
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
		logger.info('Website access granted', {
			websiteId,
			authenticatedUserId: userId,
			storedOwnerId: getOwnerId(ownedSite),
		});
		return ownedSite;
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
		logger.info('Website access granted via fallback owner comparison', {
			websiteId,
			authenticatedUserId: userId,
			storedOwnerId,
			finalQuery: ownershipFilter,
		});
		return siteById;
	}

	if (!storedOwnerId && userId) {
		const repaired = await pocketbaseClient
			.collection('websites')
			.update(siteById.id, { owner: userId })
			.catch(() => null);

		if (repaired) {
			logger.warn('Website owner auto-assigned during access fallback', {
				websiteId,
				authenticatedUserId: userId,
				storedOwnerId: getOwnerId(repaired),
				finalQuery: ownershipFilter,
			});
			return repaired;
		}
	}

	throw httpError(403, 'You do not have access to this website');
}

async function getWebsiteStats(site) {
	const collectionName = 'website_articles';
	const pbBaseUrl = process.env.PB_BASE_URL || 'http://localhost:8090';
	const articleSchema = await resolveWebsiteArticlesSchema();

	const totalFilter = pocketbaseClient.filter(`${articleSchema.websiteField} = {:websiteId}`, { websiteId: site.id });
	const newFilter = [
		totalFilter,
		pocketbaseClient.filter(`${articleSchema.statusField} = {:status}`, { status: 'new' }),
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
	const collectionName = 'websites';
	const pbBaseUrl = process.env.PB_BASE_URL || 'http://localhost:8090';
	const websitesSchema = await resolveWebsitesSchema();
	const listFilter = pocketbaseClient.filter(`${websitesSchema.ownerField} = {:owner}`, { owner: req.pocketbaseUserId });
	const query = new URLSearchParams({
		filter: listFilter,
		sort: '-created',
	});
	const requestUrl = `${pbBaseUrl}/api/collections/${collectionName}/records?${query.toString()}`;

	try {
		const websites = await pocketbaseClient.collection(collectionName).getFullList({
			filter: listFilter,
		});

		res.json(websites.map(mapWebsite));
	} catch (error) {
		logger.error('Websites list query failed', {
			stack: error?.stack || null,
			message: error?.message || null,
			pocketbaseRequestUrl: requestUrl,
			collectionName,
			filter: listFilter,
			httpStatus: error?.status || error?.response?.status || null,
			responseBody: error?.response?.data || error?.response || null,
			validationErrors: error?.response?.data?.data || null,
			requestParameters: {
				method: req.method,
				originalUrl: req.originalUrl,
				params: req.params,
				query: req.query,
				body: req.body,
				pocketbaseUserId: req.pocketbaseUserId || '',
			},
		});

		throw error;
	}
});

router.get('/:websiteId', async (req, res) => {
	const websitesSchema = await resolveWebsitesSchema();
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	const normalizedUrl = getFieldValue(site, [websitesSchema.urlField, ...WEBSITE_URL_FIELD_CANDIDATES]);
	const normalizedSite = {
		...site,
		[websitesSchema.urlField]: normalizedUrl,
	};

	let stats = {
		totalArticles: 0,
		newArticles: 0,
		lastScan: normalizedSite.last_scan_at || '',
		nextScheduledScan: normalizedSite.next_scan_at || '',
	};

	try {
		stats = await getWebsiteStats(normalizedSite);
	} catch (error) {
		logger.error('Website detail stats query failed', {
			websiteId: normalizedSite.id,
			message: error?.message || null,
			stack: error?.stack || null,
		});
	}

	res.json({ ...mapWebsite(normalizedSite), stats });
});

router.get('/:websiteId/stats', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	res.json(await getWebsiteStats(site));
});

router.get('/:websiteId/articles', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	const articleSchema = await resolveWebsiteArticlesSchema();
	const page = normalizePositiveInt(req.query.page, DEFAULT_PAGE);
	const perPage = Math.min(normalizePositiveInt(req.query.perPage, DEFAULT_PER_PAGE), 100);
	const search = normalizeOptionalString(req.query.search, 'search', 200);
	const status = normalizeOptionalString(req.query.status, 'status', 32).toLowerCase();
	const category = normalizeOptionalString(req.query.category, 'category', 255);
	const dateFrom = normalizeOptionalString(req.query.dateFrom, 'dateFrom', 64);
	const dateTo = normalizeOptionalString(req.query.dateTo, 'dateTo', 64);
	const filter = buildArticleFilters({
		websiteId: site.id,
		owner: req.pocketbaseUserId,
		search,
		status,
		category,
		dateFrom,
		dateTo,
		websiteField: articleSchema.websiteField,
		statusField: articleSchema.statusField,
	});

	const result = await pocketbaseClient.collection('website_articles').getList(page, perPage, {
		filter,
		sort: '-publish_date,-updated',
	});

	const allArticles = await pocketbaseClient.collection('website_articles').getFullList({
		filter: [
			pocketbaseClient.filter(`${articleSchema.websiteField} = {:websiteId}`, { websiteId: site.id }),
			pocketbaseClient.filter('owner = {:owner}', { owner: req.pocketbaseUserId }),
		].join(' && '),
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
	const websitesSchema = await resolveWebsitesSchema();
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
	const metadataUrl = safeNormalizeUrl(metadata?.url);
	const normalizedWebsiteUrl = metadataUrl || requestedUrl;
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
		normalizedMetadataUrl: metadataUrl,
		normalizedWebsiteUrl,
		domain,
		urlField: websitesSchema.urlField,
		domainField: websitesSchema.domainField,
	});

	const createPayload = {
		[websitesSchema.ownerField]: req.pocketbaseUserId,
		name,
		[websitesSchema.urlField]: normalizedWebsiteUrl,
		[websitesSchema.domainField]: domain,
		favicon,
		wp_username: username,
		...(password ? { wp_app_password: encryptSecret(password) } : {}),
		[websitesSchema.statusField]: 'active',
		[websitesSchema.discoveryStatusField]: 'pending',
	};

	logger.info('Website create payload to PocketBase', {
		authenticatedUserId: req.pocketbaseUserId,
		collection: 'websites',
		urlField: websitesSchema.urlField,
		domainField: websitesSchema.domainField,
		payload: {
			[websitesSchema.ownerField]: createPayload[websitesSchema.ownerField],
			name: createPayload.name,
			[websitesSchema.urlField]: createPayload[websitesSchema.urlField],
			[websitesSchema.domainField]: createPayload[websitesSchema.domainField],
			[websitesSchema.statusField]: createPayload[websitesSchema.statusField],
			[websitesSchema.discoveryStatusField]: createPayload[websitesSchema.discoveryStatusField],
			favicon: createPayload.favicon || '',
			wp_username: createPayload.wp_username || '',
			has_wp_app_password: Boolean(createPayload.wp_app_password),
		},
	});

	const record = await createWebsiteRecord({
		payload: createPayload,
		urlField: websitesSchema.urlField,
		context: 'websites:post:create',
	});
	const persistedAfterCreate = await pocketbaseClient.collection('websites').getOne(record.id).catch(() => null);

	logger.info('Website create immediate persistence check', {
		websiteId: record.id,
		urlField: websitesSchema.urlField,
		payloadUrl: createPayload[websitesSchema.urlField],
		createResponseUrl: record?.[websitesSchema.urlField],
		createResponseHasUrlField: Object.prototype.hasOwnProperty.call(record || {}, websitesSchema.urlField),
		storedUrlAfterCreate: persistedAfterCreate?.[websitesSchema.urlField],
		storedRecordHasUrlFieldAfterCreate: Object.prototype.hasOwnProperty.call(persistedAfterCreate || {}, websitesSchema.urlField),
	});

	const needsOwnerFix = getOwnerId(record) !== req.pocketbaseUserId;
	const savedRecord = needsOwnerFix
		? await updateWebsiteRecord({
			id: record.id,
			payload: { [websitesSchema.ownerField]: req.pocketbaseUserId },
			urlField: websitesSchema.urlField,
			context: 'websites:post:owner-fix',
		}).catch(() => record)
		: record;

	if (needsOwnerFix) {
		const persistedAfterOwnerFix = await pocketbaseClient.collection('websites').getOne(savedRecord.id).catch(() => null);
		logger.warn('Website owner correction executed after create', {
			websiteId: savedRecord.id,
			urlField: websitesSchema.urlField,
			payloadUrl: createPayload[websitesSchema.urlField],
			storedUrlAfterOwnerFix: persistedAfterOwnerFix?.[websitesSchema.urlField],
			storedRecordHasUrlFieldAfterOwnerFix: Object.prototype.hasOwnProperty.call(persistedAfterOwnerFix || {}, websitesSchema.urlField),
		});
	}

	const persistedRecord = await pocketbaseClient.collection('websites').getOne(savedRecord.id).catch(() => savedRecord);

	const storedUrl = getFieldValue(persistedRecord, [websitesSchema.urlField, ...WEBSITE_URL_FIELD_CANDIDATES]);
	const storedDomain = getFieldValue(persistedRecord, WEBSITE_DOMAIN_FIELD_CANDIDATES);
	const storedStatus = getFieldValue(persistedRecord, WEBSITE_STATUS_FIELD_CANDIDATES);
	const storedDiscoveryStatus = getFieldValue(persistedRecord, WEBSITE_DISCOVERY_STATUS_FIELD_CANDIDATES);

	logger.info('Website create completed', {
		websiteId: persistedRecord.id,
		authenticatedUserId: req.pocketbaseUserId,
		storedOwnerId: getOwnerId(persistedRecord),
		payloadSent: {
			[websitesSchema.urlField]: normalizedWebsiteUrl,
			[websitesSchema.domainField]: domain,
			[websitesSchema.statusField]: 'active',
			[websitesSchema.discoveryStatusField]: 'pending',
		},
		recordStored: {
			[websitesSchema.urlField]: storedUrl,
			[websitesSchema.domainField]: storedDomain,
			[websitesSchema.statusField]: storedStatus,
			[websitesSchema.discoveryStatusField]: storedDiscoveryStatus,
		},
		storedUrl,
		storedDomain,
		finalQuery: '',
	});

	res.status(201).json(mapWebsite(persistedRecord));
});

router.post('/:websiteId/scan', async (req, res) => {
	const websitesSchema = await resolveWebsitesSchema();
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	const fallbackUrlFields = WEBSITE_URL_FIELD_CANDIDATES.filter((field) => field !== websitesSchema.urlField);
	const storedUrlRaw = getFieldValue(site, [websitesSchema.urlField, ...fallbackUrlFields]);
	const fallbackDomainFields = WEBSITE_DOMAIN_FIELD_CANDIDATES.filter((field) => field !== websitesSchema.domainField);
	const storedDomainRaw = getFieldValue(site, [websitesSchema.domainField, ...fallbackDomainFields]);
	const domainUrlCandidate = typeof storedDomainRaw === 'string' && storedDomainRaw.trim()
		? `https://${storedDomainRaw.trim().replace(/^https?:\/\//i, '')}`
		: '';

	logger.info('Scan website record loaded from PocketBase', {
		websiteId: site?.id || req.params.websiteId,
		owner: getOwnerId(site),
		name: site?.name || '',
		url: storedUrlRaw || '',
		domain: getFieldValue(site, WEBSITE_DOMAIN_FIELD_CANDIDATES) || '',
		discovery_status: getFieldValue(site, WEBSITE_DISCOVERY_STATUS_FIELD_CANDIDATES) || '',
		urlField: websitesSchema.urlField,
	});

	logger.info('Scan website URL field value', {
		websiteId: site?.id || req.params.websiteId,
		websiteUrlField: storedUrlRaw,
		websiteUrlFieldType: typeof storedUrlRaw,
		domainFallback: storedDomainRaw || '',
	});

	const normalizedStoredUrl = normalizeUrl(storedUrlRaw);
	const normalizedDomainUrl = domainUrlCandidate ? normalizeUrl(domainUrlCandidate) : '';
	const computedBaseUrl = normalizedStoredUrl || normalizedDomainUrl;
	logger.info('Scan computed base URL', {
		websiteId: site?.id || req.params.websiteId,
		computedBaseUrl,
		usedDomainFallback: !normalizedStoredUrl && Boolean(normalizedDomainUrl),
	});

	if (!computedBaseUrl) {
		logger.warn('Scan aborted because website URL is missing or invalid', {
			websiteId: site?.id || req.params.websiteId,
			websiteUrlField: storedUrlRaw,
			domainFallback: storedDomainRaw || '',
			urlField: websitesSchema.urlField,
		});
		throw httpError(422, 'Website URL is missing or invalid for this record. Please update the website URL and try again.');
	}

	if (!normalizedStoredUrl && computedBaseUrl) {
		await pocketbaseClient.collection('websites').update(site.id, {
			[websitesSchema.urlField]: computedBaseUrl,
		}).catch(() => null);
	}

	const siteForScan = {
		...site,
		[websitesSchema.urlField]: computedBaseUrl,
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

	await pocketbaseClient.collection('websites').update(site.id, { [websitesSchema.discoveryStatusField]: 'running' }).catch(() => {});
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
			[websitesSchema.discoveryStatusField]: 'failed',
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
	const websitesSchema = await resolveWebsitesSchema();
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
		const metadataUrl = safeNormalizeUrl(metadata?.url);
		updates[websitesSchema.urlField] = metadataUrl || normalized;
		updates[websitesSchema.domainField] = metadata.domain;
		updates.favicon = metadata.favicon;

		if (!('name' in (req.body ?? {}))) {
			updates.name = metadata.name;
		}
	}

	if ('domain' in (req.body ?? {})) {
		updates[websitesSchema.domainField] = normalizeOptionalString(req.body?.domain, 'domain', 255);
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
		updates[websitesSchema.statusField] = status || 'active';
	}

	if ('discovery_status' in (req.body ?? {})) {
		const discoveryStatus = normalizeOptionalString(req.body?.discovery_status, 'discovery_status', 32).toLowerCase();
		updates[websitesSchema.discoveryStatusField] = discoveryStatus || 'pending';
	}

	const updated = await updateWebsiteRecord({
		id: site.id,
		payload: updates,
		urlField: websitesSchema.urlField,
		context: 'websites:patch:update',
	});

	res.json(mapWebsite(updated));
});

router.delete('/:websiteId', async (req, res) => {
	const site = await getOwnedWebsite({ websiteId: req.params.websiteId, userId: req.pocketbaseUserId });
	await pocketbaseClient.collection('websites').delete(site.id);
	res.status(204).send();
});

export default router;
