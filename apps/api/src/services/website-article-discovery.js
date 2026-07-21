import { sanitizeCollectionPayload, safeGetFullList, safeGetList, extractCollectionFieldNames } from '../utils/pocketbase-safe-query.js';
import { ensureWebsiteArticlesSchema } from '../utils/ensure-website-articles-schema.js';

const MAX_SOURCE_URLS = 250;
const MAX_ARTICLE_FETCHES = 50;
const MAX_CRAWL_PAGES = 40;
const REQUEST_TIMEOUT_MS = 12000;
const NEXT_SCAN_DELAY_MS = 24 * 60 * 60 * 1000;
const SCHEMA_CACHE_TTL_MS = 60 * 1000;

const WEBSITE_ARTICLES_WEBSITE_FIELD_CANDIDATES = ['websiteId', 'website_id', 'website', 'siteId'];
const WEBSITE_ARTICLES_STATUS_FIELD_CANDIDATES = ['status', 'article_status', 'state'];

const collectionSchemaCache = new Map();

function resolveSchemaField(fields, candidates, fallback) {
	for (const candidate of candidates) {
		if (fields.has(candidate)) {
			return candidate;
		}
	}

	return fallback;
}

async function getCollectionFieldNames({ collection, pocketbaseClient }) {
	const cached = collectionSchemaCache.get(collection);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.fields;
	}

	try {
		const model = await pocketbaseClient.collections.getOne(collection);
		const fields = extractCollectionFieldNames(model);

		collectionSchemaCache.set(collection, {
			fields: fields.size > 0 ? fields : new Set([
				'id',
				'websiteId',
				'owner',
				'url',
				'slug',
				'title',
				'meta_description',
				'featured_image',
				'publish_date',
				'last_modified_date',
				'category',
				'author',
				'language',
				'status',
				'source',
				'scan_run_id',
				'created',
				'updated',
			]),
			expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
		});

		return collectionSchemaCache.get(collection).fields;
	} catch {
		const fallback = new Set([
			'id',
			'websiteId',
			'owner',
			'url',
			'slug',
			'title',
			'meta_description',
			'featured_image',
			'publish_date',
			'last_modified_date',
			'category',
			'author',
			'language',
			'status',
			'source',
			'scan_run_id',
			'created',
			'updated',
		]);
		collectionSchemaCache.set(collection, {
			fields: fallback,
			expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
		});
		return fallback;
	}
}

async function resolveWebsiteArticlesSchema({ pocketbaseClient, logger }) {
	const ensured = await ensureWebsiteArticlesSchema(pocketbaseClient);
	collectionSchemaCache.set('website_articles', {
		fields: ensured.fields,
		expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
	});

	const schema = {
		websiteField: ensured.websiteField,
		statusField: ensured.statusField,
	};

	logger?.info?.('Website articles schema resolved for scanner', {
		collection: 'website_articles',
		schema,
		fields: [...ensured.fields],
	});

	return schema;
}

function buildMinimalArticlePayload({ article, websiteId, ownerId, websiteField, statusField, source, runId }) {
	return {
		[websiteField]: websiteId,
		owner: ownerId,
		url: article.url,
		title: (article.title || deriveSlug(article.url) || article.url).slice(0, 500),
		slug: (article.slug || deriveSlug(article.url) || '').slice(0, 255),
		[statusField]: 'new',
		source: (article.source || source || '').slice(0, 64),
		scan_run_id: (runId || '').slice(0, 64),
	};
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(value) {
	if (typeof value !== 'string') {
		return '';
	}

	return value
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeXml(value) {
	if (typeof value !== 'string') {
		return '';
	}

	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

function getTagValue(xml, tagNames) {
	for (const tagName of tagNames) {
		const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>`, 'i');
		const match = xml.match(regex);
		if (match?.[1]) {
			return decodeXml(match[1]);
		}
	}

	return '';
}

function getMetaContent(html, matchers) {
	for (const matcher of matchers) {
		const regex = new RegExp(`<meta[^>]+${matcher}[^>]+content=["']([^"']*)["'][^>]*>`, 'i');
		const reverseRegex = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${matcher}[^>]*>`, 'i');
		const match = html.match(regex) || html.match(reverseRegex);
		if (match?.[1]) {
			return stripHtml(match[1]);
		}
	}

	return '';
}

function getLinkHref(html, matchers) {
	for (const matcher of matchers) {
		const regex = new RegExp(`<link[^>]+${matcher}[^>]+href=["']([^"']*)["'][^>]*>`, 'i');
		const reverseRegex = new RegExp(`<link[^>]+href=["']([^"']*)["'][^>]+${matcher}[^>]*>`, 'i');
		const match = html.match(regex) || html.match(reverseRegex);
		if (match?.[1]) {
			return match[1].trim();
		}
	}

	return '';
}

function absoluteUrl(baseUrl, maybeRelative) {
	if (!maybeRelative) {
		return '';
	}

	try {
		return new URL(maybeRelative, baseUrl).toString();
	} catch {
		return '';
	}
}

function normalizeUrl(value) {
	try {
		const parsed = new URL(value);
		parsed.hash = '';
		return parsed.toString();
	} catch {
		return '';
	}
}

function deriveSlug(url) {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split('/').filter(Boolean);
		return segments.at(-1) || parsed.hostname;
	} catch {
		return '';
	}
}

function normalizeDate(value) {
	if (!value) {
		return '';
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return '';
	}

	return date.toISOString();
}

function sameOrigin(baseUrl, candidateUrl) {
	try {
		return new URL(baseUrl).origin === new URL(candidateUrl).origin;
	} catch {
		return false;
	}
}

function looksLikeArticleUrl(url) {
	try {
		const parsed = new URL(url);
		const path = parsed.pathname.toLowerCase();
		if (!path || path === '/') {
			return false;
		}

		if (/(tag|category|author|search|page|wp-admin|wp-login|feed|comment|cart|checkout|account)/.test(path)) {
			return false;
		}

		return /\d{4}\/\d{2}|article|blog|post|recipe|news|story|guide|tips|how-to|tutorial/.test(path) || path.split('/').filter(Boolean).length >= 2;
	} catch {
		return false;
	}
}

async function fetchText(url) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Accept': 'text/html,application/xhtml+xml,application/xml,text/xml,application/rss+xml,application/atom+xml,text/plain',
				'User-Agent': 'ChefIA Article Discovery/1.0',
			},
			redirect: 'follow',
			signal: controller.signal,
		});

		if (!response.ok) {
			return { ok: false, status: response.status, url: response.url || url, body: '' };
		}

		return {
			ok: true,
			status: response.status,
			url: response.url || url,
			body: await response.text(),
			contentType: response.headers.get('content-type') || '',
		};
	} catch (error) {
		return { ok: false, status: 0, url, body: '', error };
	} finally {
		clearTimeout(timeoutId);
	}
}

function parseSitemapUrls(xml) {
	const sitemapMatches = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi)];
	if (sitemapMatches.length > 0) {
		return sitemapMatches.map((match) => decodeXml(match[1])).filter(Boolean);
	}

	const urlMatches = [...xml.matchAll(/<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>(?:[\s\S]*?<lastmod>([\s\S]*?)<\/lastmod>)?[\s\S]*?<\/url>/gi)];
	return urlMatches.map((match) => ({
		url: decodeXml(match[1]),
		lastModifiedDate: normalizeDate(match[2]),
	})).filter((item) => item.url);
}

function parseRssItems(xml, baseUrl) {
	const itemMatches = [...xml.matchAll(/<(item|entry)>([\s\S]*?)<\/\1>/gi)];
	const language = getTagValue(xml, ['language']);

	return itemMatches.map(([, , itemXml]) => {
		const url = absoluteUrl(baseUrl, getTagValue(itemXml, ['link', 'guid', 'id']));
		const title = stripHtml(getTagValue(itemXml, ['title']));
		const metaDescription = stripHtml(getTagValue(itemXml, ['description', 'summary', 'content:encoded'])).slice(0, 2000);
		const featuredImage = absoluteUrl(
			baseUrl,
			getTagValue(itemXml, ['media:content', 'media:thumbnail']) || getTagValue(itemXml, ['image', 'enclosure']),
		);
		const publishDate = normalizeDate(getTagValue(itemXml, ['pubDate', 'published', 'updated']));
		const author = stripHtml(getTagValue(itemXml, ['dc:creator', 'author', 'name']));
		const category = stripHtml(getTagValue(itemXml, ['category']));

		return {
			url,
			slug: deriveSlug(url),
			title,
			metaDescription,
			featuredImage,
			publishDate,
			lastModifiedDate: publishDate,
			category,
			author,
			language,
			source: 'rss',
		};
	}).filter((item) => item.url);
}

function extractInternalLinks(html, baseUrl) {
	const matches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)];
	const urls = new Set();

	for (const match of matches) {
		const absolute = absoluteUrl(baseUrl, match[1]);
		if (!absolute || !sameOrigin(baseUrl, absolute)) {
			continue;
		}

		const normalized = normalizeUrl(absolute);
		if (!normalized) {
			continue;
		}

		urls.add(normalized);
	}

	return [...urls];
}

function parseArticleHtml(url, html) {
	const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || getMetaContent(html, ["property=[\"']og:title[\"']", "name=[\"']title[\"']"]));
	const metaDescription = getMetaContent(html, ["name=[\"']description[\"']", "property=[\"']og:description[\"']"]).slice(0, 2000);
	const featuredImage = absoluteUrl(url, getMetaContent(html, ["property=[\"']og:image[\"']", "name=[\"']twitter:image[\"']"]));
	const publishDate = normalizeDate(getMetaContent(html, ["property=[\"']article:published_time[\"']", "name=[\"']pubdate[\"']", "name=[\"']publish-date[\"']"]));
	const lastModifiedDate = normalizeDate(getMetaContent(html, ["property=[\"']article:modified_time[\"']", "name=[\"']lastmod[\"']", "name=[\"']last-modified[\"']"]));
	const category = getMetaContent(html, ["property=[\"']article:section[\"']", "name=[\"']category[\"']"]);
	const author = getMetaContent(html, ["name=[\"']author[\"']", "property=[\"']article:author[\"']"]);
	const language = (html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] || '').trim();

	return {
		url,
		slug: deriveSlug(url),
		title: title || deriveSlug(url),
		metaDescription,
		featuredImage,
		publishDate,
		lastModifiedDate,
		category,
		author,
		language,
		source: 'crawl',
	};
}

async function discoverSitemapSources(baseUrl, reportProgress, errors) {
	const candidates = [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`];
	reportProgress(`Generated sitemap URLs: ${candidates.join(', ')}`);
	const urls = [];

	for (const candidate of candidates) {
		reportProgress(`Checking sitemap source: ${candidate}`);
		const result = await fetchText(candidate);
		if (!result.ok || !result.body) {
			continue;
		}

		const parsed = parseSitemapUrls(result.body);
		if (parsed.length === 0) {
			continue;
		}

		if (typeof parsed[0] === 'string') {
			for (const nestedSitemap of parsed.slice(0, 20)) {
				const nestedResult = await fetchText(nestedSitemap);
				if (!nestedResult.ok || !nestedResult.body) {
					continue;
				}

				const nestedUrls = parseSitemapUrls(nestedResult.body);
				for (const item of nestedUrls) {
					if (typeof item === 'object') {
						urls.push({ ...item, source: 'sitemap' });
					}
				}
			}
		} else {
			for (const item of parsed) {
				urls.push({ ...item, source: 'sitemap' });
			}
		}
	}

	if (urls.length === 0) {
		errors.push('No sitemap entries discovered.');
	}

	return urls;
}

async function discoverFromRobots(baseUrl, reportProgress, errors) {
	reportProgress('Checking robots.txt for sitemap hints');
	const result = await fetchText(`${baseUrl}/robots.txt`);
	if (!result.ok || !result.body) {
		errors.push('robots.txt not available.');
		return [];
	}

	const sitemapUrls = [...result.body.matchAll(/^sitemap:\s*(.+)$/gim)].map((match) => normalizeUrl(match[1].trim())).filter(Boolean);
	const urls = [];

	for (const sitemapUrl of sitemapUrls.slice(0, 10)) {
		const sitemapResult = await fetchText(sitemapUrl);
		if (!sitemapResult.ok || !sitemapResult.body) {
			continue;
		}

		const parsed = parseSitemapUrls(sitemapResult.body);
		if (typeof parsed[0] === 'string') {
			for (const nestedSitemap of parsed.slice(0, 20)) {
				const nestedResult = await fetchText(nestedSitemap);
				if (!nestedResult.ok || !nestedResult.body) {
					continue;
				}

				for (const item of parseSitemapUrls(nestedResult.body)) {
					if (typeof item === 'object') {
						urls.push({ ...item, source: 'robots' });
					}
				}
			}
		} else {
			for (const item of parsed) {
				urls.push({ ...item, source: 'robots' });
			}
		}
	}

	if (urls.length === 0) {
		errors.push('robots.txt did not reveal sitemap URLs.');
	}

	return urls;
}

async function discoverRss(baseUrl, reportProgress, errors) {
	reportProgress('Checking RSS/Atom feeds');
	const candidates = [
		`${baseUrl}/feed`,
		`${baseUrl}/rss`,
		`${baseUrl}/rss.xml`,
		`${baseUrl}/feed.xml`,
	];

	for (const candidate of candidates) {
		const result = await fetchText(candidate);
		if (!result.ok || !result.body) {
			continue;
		}

		const items = parseRssItems(result.body, baseUrl);
		if (items.length > 0) {
			return items.map((item) => ({ ...item, source: 'rss' }));
		}
	}

	errors.push('No RSS/Atom feed discovered.');
	return [];
}

async function discoverByCrawl(baseUrl, reportProgress, errors) {
	reportProgress('Falling back to internal crawler');
	const queue = [baseUrl];
	const visited = new Set();
	const articleUrls = [];

	while (queue.length > 0 && visited.size < MAX_CRAWL_PAGES && articleUrls.length < MAX_SOURCE_URLS) {
		const current = queue.shift();
		if (!current || visited.has(current)) {
			continue;
		}

		visited.add(current);
		const result = await fetchText(current);
		if (!result.ok || !result.body) {
			continue;
		}

		const links = extractInternalLinks(result.body, baseUrl);
		for (const link of links) {
			if (looksLikeArticleUrl(link)) {
				articleUrls.push({ url: link, source: 'crawler' });
			}

			if (!visited.has(link) && queue.length < MAX_CRAWL_PAGES) {
				queue.push(link);
			}
		}
	}

	if (articleUrls.length === 0) {
		errors.push('Internal crawler did not find article URLs.');
	}

	return articleUrls;
}

async function discoverArticleCandidates({ website, onProgress, logger }) {
	const rawWebsiteUrl = typeof website?.url === 'string' ? website.url.trim() : '';
	let baseUrl = '';

	if (rawWebsiteUrl) {
		try {
			baseUrl = new URL(rawWebsiteUrl).origin;
		} catch {
			baseUrl = '';
		}
	}

	logger?.info?.('Scan computed base URL', {
		websiteId: website?.id || '',
		websiteUrlField: website?.url,
		computedBaseUrl: baseUrl,
	});

	if (!baseUrl) {
		throw new Error('Website URL is missing or invalid for this record. Please update the website URL and try again.');
	}

	const errors = [];
	const reportProgress = (message) => onProgress?.({ type: 'progress', stage: 'discover', message });

	let candidates = await discoverSitemapSources(baseUrl, reportProgress, errors);
	let source = 'sitemap';

	if (candidates.length === 0) {
		candidates = await discoverSitemapSources(`${baseUrl}/`, reportProgress, errors);
	}

	if (candidates.length === 0) {
		candidates = await discoverRss(baseUrl, reportProgress, errors);
		source = 'rss';
	}

	if (candidates.length === 0) {
		candidates = await discoverFromRobots(baseUrl, reportProgress, errors);
		source = 'robots';
	}

	if (candidates.length === 0) {
		candidates = await discoverByCrawl(baseUrl, reportProgress, errors);
		source = 'crawler';
	}

	logger?.info?.('Generated sitemap URLs for scan', {
		websiteId: website?.id || '',
		baseUrl,
		sitemapUrls: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`],
	});

	const deduped = [];
	const seen = new Set();
	for (const item of candidates) {
		const candidateUrl = normalizeUrl(typeof item === 'string' ? item : item.url);
		if (!candidateUrl || seen.has(candidateUrl) || !sameOrigin(baseUrl, candidateUrl)) {
			continue;
		}

		seen.add(candidateUrl);
		deduped.push(typeof item === 'string' ? { url: candidateUrl, source } : { ...item, url: candidateUrl, source: item.source || source });
		if (deduped.length >= MAX_SOURCE_URLS) {
			break;
		}
	}

	return { candidates: deduped, errors, source };
}

async function enrichCandidates(candidates, onProgress) {
	const enriched = [];
	for (let index = 0; index < Math.min(candidates.length, MAX_ARTICLE_FETCHES); index++) {
		const candidate = candidates[index];
		onProgress?.({ type: 'progress', stage: 'articles', message: `Scanning article ${index + 1} of ${Math.min(candidates.length, MAX_ARTICLE_FETCHES)}` });

		if (candidate.title && candidate.metaDescription) {
			enriched.push(candidate);
			continue;
		}

		const result = await fetchText(candidate.url);
		if (!result.ok || !result.body) {
			enriched.push({
				...candidate,
				slug: candidate.slug || deriveSlug(candidate.url),
				title: candidate.title || deriveSlug(candidate.url),
				metaDescription: candidate.metaDescription || '',
				featuredImage: candidate.featuredImage || '',
				publishDate: candidate.publishDate || '',
				lastModifiedDate: candidate.lastModifiedDate || '',
				category: candidate.category || '',
				author: candidate.author || '',
				language: candidate.language || '',
			});
			continue;
		}

		enriched.push({
			...parseArticleHtml(candidate.url, result.body),
			...candidate,
			url: candidate.url,
			source: candidate.source,
			slug: candidate.slug || deriveSlug(candidate.url),
			publishDate: candidate.publishDate || parseArticleHtml(candidate.url, result.body).publishDate,
			lastModifiedDate: candidate.lastModifiedDate || parseArticleHtml(candidate.url, result.body).lastModifiedDate,
		});

		await sleep(5);
	}

	return enriched;
}

function hasMetadataChanges(existingRecord, incomingRecord) {
	return [
		'title',
		'meta_description',
		'featured_image',
		'publish_date',
		'last_modified_date',
		'category',
		'author',
		'language',
		'slug',
	].some((field) => (existingRecord[field] || '') !== (incomingRecord[field] || ''));
}

function resolveOwnerId(website) {
	const owner = website?.owner;
	if (!owner) {
		return '';
	}
	if (typeof owner === 'string') {
		return owner;
	}
	if (Array.isArray(owner)) {
		return typeof owner[0] === 'string' ? owner[0] : owner[0]?.id || '';
	}
	if (typeof owner === 'object') {
		return owner.id || owner.value || '';
	}
	return String(owner);
}

function formatPocketBaseError(error) {
	const responseData = error?.response?.data || error?.data || null;
	const baseMessage = responseData?.message || error?.message || 'PocketBase request failed';
	const fieldErrors = responseData?.data;

	if (!fieldErrors || typeof fieldErrors !== 'object') {
		return baseMessage;
	}

	const details = Object.entries(fieldErrors)
		.map(([field, value]) => {
			if (!value) {
				return '';
			}
			if (typeof value === 'string') {
				return `${field}: ${value}`;
			}
			if (typeof value?.message === 'string') {
				return `${field}: ${value.message}`;
			}
			return `${field}: ${JSON.stringify(value)}`;
		})
		.filter(Boolean)
		.join('; ');

	return details ? `${baseMessage} (${details})` : baseMessage;
}

function buildArticleWritePayload({ article, websiteId, ownerId, websiteField, statusField, source, runId, existingStatus }) {
	const payload = {
		[websiteField]: websiteId,
		owner: ownerId,
		url: article.url,
		slug: (article.slug || deriveSlug(article.url) || '').slice(0, 255),
		title: (article.title || deriveSlug(article.url) || article.url).slice(0, 500),
		meta_description: (article.metaDescription || '').slice(0, 2000),
		featured_image: (article.featuredImage || '').slice(0, 1000),
		category: (article.category || '').slice(0, 255),
		author: (article.author || '').slice(0, 255),
		language: (article.language || '').slice(0, 32),
		[statusField]: existingStatus || 'new',
		source: (article.source || source || '').slice(0, 64),
		scan_run_id: (runId || '').slice(0, 64),
	};

	// PocketBase date fields reject empty strings — omit when unknown.
	if (article.publishDate) {
		payload.publish_date = article.publishDate;
	}
	if (article.lastModifiedDate || article.publishDate) {
		payload.last_modified_date = article.lastModifiedDate || article.publishDate;
	}

	return payload;
}

function isUniqueConflict(error) {
	const message = String(formatPocketBaseError(error) || '').toLowerCase();
	const responseData = error?.response?.data || error?.data || {};
	const raw = JSON.stringify(responseData).toLowerCase();
	return message.includes('unique')
		|| message.includes('duplicate')
		|| raw.includes('unique')
		|| raw.includes('validation_not_unique');
}

function recordMatchesWebsite(record, websiteId, websiteField) {
	const raw = record?.[websiteField] ?? record?.websiteId ?? record?.website_id ?? record?.website;
	if (!raw) {
		return false;
	}
	if (typeof raw === 'string') {
		return raw === websiteId;
	}
	if (typeof raw === 'object') {
		return raw.id === websiteId;
	}
	return String(raw) === websiteId;
}

function getRecordWebsiteId(record) {
	const raw = record?.websiteId ?? record?.website_id ?? record?.website ?? record?.siteId;
	if (!raw) {
		return '';
	}
	if (typeof raw === 'string') {
		return raw;
	}
	if (typeof raw === 'object') {
		return raw.id || '';
	}
	return String(raw);
}

async function ensureArticleLinkedToWebsite({ pocketbaseClient, record, websiteId, websiteField, ownerId, logger }) {
	if (!record?.id) {
		return record;
	}

	const patch = {};
	if (!recordMatchesWebsite(record, websiteId, websiteField)) {
		patch[websiteField] = websiteId;
	}
	if (ownerId && !record.owner) {
		patch.owner = ownerId;
	}

	if (Object.keys(patch).length === 0) {
		return record;
	}

	try {
		const repaired = await pocketbaseClient.collection('website_articles').update(record.id, patch);
		logger?.warn?.('Repaired website article relation after scan write', {
			articleId: record.id,
			websiteId,
			patch,
		});
		return repaired;
	} catch (error) {
		logger?.error?.('Failed to repair website article relation', {
			articleId: record.id,
			websiteId,
			message: formatPocketBaseError(error),
		});
		return record;
	}
}

async function loadExistingArticlesByWebsite({ pocketbaseClient, websiteId, websiteField, logger }) {
	const filterExpressions = [
		pocketbaseClient.filter(`${websiteField} = {:websiteId}`, { websiteId }),
		`${websiteField}="${String(websiteId).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
	];

	for (const filter of filterExpressions) {
		const records = await safeGetFullList({
			collection: 'website_articles',
			context: 'website-scan:existing-articles',
			filter,
			sort: '-created',
		});

		if (Array.isArray(records) && records.length > 0) {
			return records.filter((record) => recordMatchesWebsite(record, websiteId, websiteField));
		}

		const probe = await safeGetList({
			collection: 'website_articles',
			context: 'website-scan:existing-articles-probe',
			page: 1,
			perPage: 50,
			filter,
			sort: '-created',
		});

		// Only treat probe as authoritative when the filtered query succeeded with items,
		// or when totalItems is explicitly 0 (empty website). Empty items with failed
		// queries also look like { items: [] } — continue to fallbacks in that case.
		if (Array.isArray(probe?.items) && (probe.items.length > 0 || probe.totalItems === 0)) {
			return probe.items.filter((record) => recordMatchesWebsite(record, websiteId, websiteField));
		}
	}

	logger?.warn?.('Falling back to unfiltered website_articles probe for scan dedupe', {
		websiteId,
		websiteField,
	});

	const matched = [];
	for (let page = 1; page <= 20; page += 1) {
		const unfiltered = await safeGetList({
			collection: 'website_articles',
			context: 'website-scan:existing-articles-unfiltered',
			page,
			perPage: 200,
			sort: '-created',
		});

		const pageItems = unfiltered.items || [];
		matched.push(...pageItems.filter((record) => recordMatchesWebsite(record, websiteId, websiteField)));

		if (pageItems.length < 200 || page >= (unfiltered.totalPages || page)) {
			break;
		}
	}

	return matched;
}

async function findArticleByWebsiteUrl({ pocketbaseClient, websiteId, websiteField, url }) {
	const escapedUrl = String(url).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	const filter = [
		pocketbaseClient.filter(`${websiteField} = {:websiteId}`, { websiteId }),
		`url = "${escapedUrl}"`,
	].join(' && ');

	try {
		return await pocketbaseClient.collection('website_articles').getFirstListItem(filter);
	} catch {
		// Fallback: match by URL only then verify website in memory.
		try {
			const byUrl = await pocketbaseClient.collection('website_articles').getFirstListItem(`url = "${escapedUrl}"`);
			if (recordMatchesWebsite(byUrl, websiteId, websiteField) || !getRecordWebsiteId(byUrl)) {
				return byUrl;
			}
		} catch {
			return null;
		}
		return null;
	}
}

export async function repairOrphanWebsiteArticles({ pocketbaseClient, website, websiteField, ownerId, logger }) {
	const websiteId = website?.id;
	if (!websiteId) {
		return 0;
	}

	const domain = String(website.domain || '')
		.replace(/^www\./i, '')
		.trim()
		.toLowerCase();
	const siteUrl = String(website.url || '');
	let hostname = domain;
	try {
		hostname = new URL(siteUrl).hostname.replace(/^www\./i, '').toLowerCase() || domain;
	} catch {
		hostname = domain;
	}

	if (!hostname) {
		return 0;
	}

	let repaired = 0;
	for (let page = 1; page <= 30; page += 1) {
		const result = await safeGetList({
			collection: 'website_articles',
			context: 'website-articles:orphan-repair',
			page,
			perPage: 200,
			sort: '-created',
		});
		const items = result.items || [];

		for (const record of items) {
			if (recordMatchesWebsite(record, websiteId, websiteField)) {
				continue;
			}

			const existingWebsiteId = getRecordWebsiteId(record);
			if (existingWebsiteId && existingWebsiteId !== websiteId) {
				continue;
			}

			const articleUrl = String(record.url || '');
			let articleHost = '';
			try {
				articleHost = new URL(articleUrl).hostname.replace(/^www\./i, '').toLowerCase();
			} catch {
				continue;
			}

			if (!articleHost || (articleHost !== hostname && !articleHost.endsWith(`.${hostname}`))) {
				continue;
			}

			try {
				await pocketbaseClient.collection('website_articles').update(record.id, {
					[websiteField]: websiteId,
					...(ownerId && !record.owner ? { owner: ownerId } : {}),
				});
				repaired += 1;
			} catch (error) {
				logger?.warn?.('Failed to repair orphan website article', {
					articleId: record.id,
					websiteId,
					message: formatPocketBaseError(error),
				});
			}
		}

		if (items.length < 200 || page >= (result.totalPages || page)) {
			break;
		}
	}

	if (repaired > 0) {
		logger?.info?.('Repaired orphan website articles', { websiteId, repaired });
	}

	return repaired;
}

export async function countWebsiteArticles({ pocketbaseClient, websiteId, websiteField, statusField, status } = {}) {
	const filters = [
		pocketbaseClient.filter(`${websiteField} = {:websiteId}`, { websiteId }),
	];

	if (status && statusField) {
		filters.push(pocketbaseClient.filter(`${statusField} = {:status}`, { status }));
	}

	const filter = filters.join(' && ');

	try {
		const result = await pocketbaseClient.collection('website_articles').getList(1, 1, { filter });
		if (typeof result?.totalItems === 'number' && result.totalItems >= 0) {
			return result.totalItems;
		}
	} catch {
		// fall through to in-memory count
	}

	let total = 0;
	for (let page = 1; page <= 50; page += 1) {
		const result = await safeGetList({
			collection: 'website_articles',
			context: 'website-articles:count-fallback',
			page,
			perPage: 200,
			sort: '-created',
		});
		const items = result.items || [];
		total += items.filter((record) => {
			if (!recordMatchesWebsite(record, websiteId, websiteField)) {
				return false;
			}
			if (!status) {
				return true;
			}
			const value = record?.[statusField] || record?.status;
			return value === status;
		}).length;

		if (items.length < 200 || page >= (result.totalPages || page)) {
			break;
		}
	}

	return total;
}

export async function listWebsiteArticles({
	pocketbaseClient,
	websiteId,
	websiteField,
	owner,
	page = 1,
	perPage = 10,
	filterExtra = '',
	sort = '-created',
}) {
	const baseFilters = [
		pocketbaseClient.filter(`${websiteField} = {:websiteId}`, { websiteId }),
	];
	if (filterExtra) {
		baseFilters.push(filterExtra);
	}
	const filter = baseFilters.join(' && ');

	try {
		const result = await pocketbaseClient.collection('website_articles').getList(page, perPage, {
			filter,
			...(sort ? { sort } : {}),
		});

		// Soft preference: if owner was provided and the website-scoped query returned
		// rows, keep them even when owner differs (access already checked via website).
		if (result.totalItems > 0 || !owner) {
			return result;
		}
	} catch {
		// Soft-fail path: page through records and filter in memory.
	}

	const matched = [];
	for (let currentPage = 1; currentPage <= 50; currentPage += 1) {
		const result = await safeGetList({
			collection: 'website_articles',
			context: 'website-articles:list-fallback',
			page: currentPage,
			perPage: 200,
			sort: '-created',
		});
		const items = result.items || [];
		for (const record of items) {
			if (!recordMatchesWebsite(record, websiteId, websiteField)) {
				continue;
			}
			matched.push(record);
		}
		if (items.length < 200 || currentPage >= (result.totalPages || currentPage)) {
			break;
		}
	}

	const totalItems = matched.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / perPage) || 1);
	const start = (page - 1) * perPage;

	return {
		page,
		perPage,
		totalItems,
		totalPages: totalItems === 0 ? 0 : totalPages,
		items: matched.slice(start, start + perPage),
	};
}

export async function scanWebsiteArticles({ pocketbaseClient, website, ownerId: ownerIdOverride, runId, onProgress, logger }) {
	const startedAt = new Date().toISOString();
	const summary = {
		found: 0,
		newArticles: 0,
		updatedArticles: 0,
		errors: [],
		source: '',
		lastScanAt: startedAt,
		nextScheduledScan: new Date(Date.now() + NEXT_SCAN_DELAY_MS).toISOString(),
		persistedArticles: 0,
	};

	onProgress?.({ type: 'progress', stage: 'init', message: 'Preparing website scan' });
	const articlesSchema = await resolveWebsiteArticlesSchema({ pocketbaseClient, logger });
	const ownerId = (typeof ownerIdOverride === 'string' && ownerIdOverride.trim())
		|| resolveOwnerId(website);

	if (!ownerId) {
		throw new Error('Website owner is missing. Re-save the website and try scanning again.');
	}

	try {
		await repairOrphanWebsiteArticles({
			pocketbaseClient,
			website,
			websiteField: articlesSchema.websiteField,
			ownerId,
			logger,
		});
	} catch (error) {
		logger?.warn?.('Pre-scan orphan repair failed', {
			websiteId: website.id,
			message: formatPocketBaseError(error),
		});
	}

	const { candidates, errors, source } = await discoverArticleCandidates({ website, onProgress, logger });
	summary.source = source;
	summary.errors.push(...errors);
	summary.found = candidates.length;

	onProgress?.({ type: 'progress', stage: 'init', message: `Discovered ${candidates.length} article candidates from ${source}` });
	const articles = await enrichCandidates(candidates, onProgress);

	let existingRecords = [];
	try {
		existingRecords = await loadExistingArticlesByWebsite({
			pocketbaseClient,
			websiteId: website.id,
			websiteField: articlesSchema.websiteField,
			logger,
		});
	} catch (error) {
		const message = formatPocketBaseError(error);
		logger?.warn?.('Existing article lookup failed; continuing scan with empty dedupe map', {
			websiteId: website.id,
			message,
			pocketbaseErrorResponse: error?.response?.data || error?.response || null,
		});
		summary.errors.push(`Existing article lookup warning: ${message}`);
		existingRecords = [];
	}

	const existingByUrl = new Map(existingRecords.map((record) => [record.url, record]));

	onProgress?.({ type: 'progress', stage: 'persist', message: `Saving ${articles.length} articles to PocketBase` });
	onProgress?.({
		type: 'progress',
		stage: 'persist',
		message: `Using fields ${articlesSchema.websiteField} + ${articlesSchema.statusField}`,
	});

	let firstPersistError = '';

	for (const article of articles) {
		let existing = existingByUrl.get(article.url);

		const minimalPayload = buildMinimalArticlePayload({
			article,
			websiteId: website.id,
			ownerId,
			websiteField: articlesSchema.websiteField,
			statusField: articlesSchema.statusField,
			source,
			runId,
		});

		const fullPayload = buildArticleWritePayload({
			article,
			websiteId: website.id,
			ownerId,
			websiteField: articlesSchema.websiteField,
			statusField: articlesSchema.statusField,
			source,
			runId,
			existingStatus: existing?.[articlesSchema.statusField] || existing?.status || 'new',
		});

		try {
			if (!existing) {
				let created;
				try {
					created = await pocketbaseClient.collection('website_articles').create(minimalPayload);
				} catch (minimalError) {
					if (isUniqueConflict(minimalError)) {
						existing = await findArticleByWebsiteUrl({
							pocketbaseClient,
							websiteId: website.id,
							websiteField: articlesSchema.websiteField,
							url: article.url,
						});
						if (!existing) {
							throw minimalError;
						}
					} else {
						// Retry once with sanitized full payload for older schemas.
						const sanitized = await sanitizeCollectionPayload({
							collection: 'website_articles',
							payload: fullPayload,
							context: 'website-scan:create-fallback',
							requiredKeys: [articlesSchema.websiteField, 'owner', 'url', 'title', articlesSchema.statusField],
						});
						sanitized[articlesSchema.websiteField] = website.id;
						sanitized.owner = ownerId;
						try {
							created = await pocketbaseClient.collection('website_articles').create(sanitized);
						} catch (fullError) {
							if (isUniqueConflict(fullError)) {
								existing = await findArticleByWebsiteUrl({
									pocketbaseClient,
									websiteId: website.id,
									websiteField: articlesSchema.websiteField,
									url: article.url,
								});
								if (!existing) {
									throw fullError;
								}
							} else {
								throw fullError || minimalError;
							}
						}
					}
				}

				if (!existing) {
					created = await ensureArticleLinkedToWebsite({
						pocketbaseClient,
						record: created,
						websiteId: website.id,
						websiteField: articlesSchema.websiteField,
						ownerId,
						logger,
					});

					if (!recordMatchesWebsite(created, website.id, articlesSchema.websiteField)) {
						throw new Error(`Article created without website relation (${articlesSchema.websiteField})`);
					}

					// Best-effort metadata enrichment after the required create succeeds.
					const metaPatch = {};
					for (const key of ['meta_description', 'featured_image', 'category', 'author', 'language', 'slug', 'title', 'source', 'scan_run_id']) {
						if (fullPayload[key]) {
							metaPatch[key] = fullPayload[key];
						}
					}
					if (fullPayload.publish_date) {
						metaPatch.publish_date = fullPayload.publish_date;
					}
					if (fullPayload.last_modified_date) {
						metaPatch.last_modified_date = fullPayload.last_modified_date;
					}
					if (Object.keys(metaPatch).length > 0) {
						created = await pocketbaseClient.collection('website_articles').update(created.id, metaPatch).catch(() => created);
					}

					existingByUrl.set(article.url, created);
					summary.newArticles += 1;
					continue;
				}

				existing = await ensureArticleLinkedToWebsite({
					pocketbaseClient,
					record: existing,
					websiteId: website.id,
					websiteField: articlesSchema.websiteField,
					ownerId,
					logger,
				});
				existingByUrl.set(article.url, existing);
			}

			const updatePayload = {
				[articlesSchema.websiteField]: website.id,
				owner: ownerId,
				scan_run_id: fullPayload.scan_run_id,
			};
			if (fullPayload.last_modified_date) {
				updatePayload.last_modified_date = fullPayload.last_modified_date;
			}
			if (hasMetadataChanges(existing, fullPayload)) {
				Object.assign(updatePayload, {
					slug: fullPayload.slug,
					title: fullPayload.title,
					meta_description: fullPayload.meta_description,
					featured_image: fullPayload.featured_image,
					category: fullPayload.category,
					author: fullPayload.author,
					language: fullPayload.language,
					source: fullPayload.source,
				});
				if (fullPayload.publish_date) {
					updatePayload.publish_date = fullPayload.publish_date;
				}
			}

			const updated = await pocketbaseClient.collection('website_articles').update(existing.id, updatePayload);
			existingByUrl.set(article.url, updated);
			if (hasMetadataChanges(existing, fullPayload)) {
				summary.updatedArticles += 1;
			}
		} catch (error) {
			const message = formatPocketBaseError(error);
			if (!firstPersistError) {
				firstPersistError = message;
			}
			logger?.error?.('Failed to persist scanned article', {
				websiteId: website.id,
				articleUrl: article.url,
				message,
				minimalPayload,
				pocketbaseErrorResponse: error?.response?.data || error?.response || null,
			});
			summary.errors.push(`Failed to save ${article.url}: ${message}`);

			// Fail fast on the first persist error — remaining rows will share the same schema issue.
			if (summary.newArticles === 0 && summary.updatedArticles === 0) {
				break;
			}
		}
	}

	try {
		summary.persistedArticles = await countWebsiteArticles({
			pocketbaseClient,
			websiteId: website.id,
			websiteField: articlesSchema.websiteField,
		});
	} catch (error) {
		logger?.warn?.('Post-scan article recount failed', {
			websiteId: website.id,
			message: formatPocketBaseError(error),
		});
		summary.persistedArticles = 0;
	}

	if (summary.newArticles > 0 && summary.persistedArticles === 0) {
		summary.errors.push('Articles were reported as saved but could not be loaded back from PocketBase.');
	}

	if (summary.persistedArticles === 0 && articles.length > 0) {
		const detail = firstPersistError || summary.errors[0] || 'PocketBase rejected article creates';
		summary.errors.unshift(`Persist failed: ${detail}`);
	}

	try {
		await pocketbaseClient.collection('websites').update(website.id, {
			discovery_status: summary.persistedArticles > 0 || summary.found === 0 ? 'ready' : 'failed',
			last_scan_at: summary.lastScanAt,
			next_scan_at: summary.nextScheduledScan,
			last_scan_summary: summary,
		});
	} catch (error) {
		const message = formatPocketBaseError(error);
		logger?.error?.('Failed to update website scan summary', {
			websiteId: website.id,
			message,
			pocketbaseErrorResponse: error?.response?.data || error?.response || null,
		});
		summary.errors.push(`Failed to update website scan status: ${message}`);
	}

	logger?.info?.('Website scan completed', website.id, summary);

	// Only emit a successful summary when articles are actually queryable.
	if (summary.found > 0 && summary.persistedArticles === 0 && articles.length > 0) {
		const failMessage = firstPersistError
			|| summary.errors.find((item) => String(item).startsWith('Persist failed:'))
			|| summary.errors[summary.errors.length - 1]
			|| 'Scan discovered articles but failed to save any to PocketBase.';
		onProgress?.({ type: 'summary', summary });
		throw new Error(failMessage);
	}

	onProgress?.({ type: 'summary', summary });
	return summary;
}