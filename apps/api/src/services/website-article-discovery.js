const MAX_SOURCE_URLS = 250;
const MAX_ARTICLE_FETCHES = 50;
const MAX_CRAWL_PAGES = 40;
const REQUEST_TIMEOUT_MS = 12000;
const NEXT_SCAN_DELAY_MS = 24 * 60 * 60 * 1000;

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

async function discoverArticleCandidates({ website, onProgress }) {
	const baseUrl = website.url;
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

export async function scanWebsiteArticles({ pocketbaseClient, website, runId, onProgress, logger }) {
	const startedAt = new Date().toISOString();
	const summary = {
		found: 0,
		newArticles: 0,
		updatedArticles: 0,
		errors: [],
		source: '',
		lastScanAt: startedAt,
		nextScheduledScan: new Date(Date.now() + NEXT_SCAN_DELAY_MS).toISOString(),
	};

	onProgress?.({ type: 'progress', stage: 'init', message: 'Preparing website scan' });
	const { candidates, errors, source } = await discoverArticleCandidates({ website, onProgress });
	summary.source = source;
	summary.errors.push(...errors);
	summary.found = candidates.length;

	onProgress?.({ type: 'progress', stage: 'init', message: `Discovered ${candidates.length} article candidates from ${source}` });
	const articles = await enrichCandidates(candidates, onProgress);

	const existingRecords = await pocketbaseClient.collection('website_articles').getFullList({
		filter: pocketbaseClient.filter('websiteId = {:websiteId}', { websiteId: website.id }),
		sort: '-updated',
	});
	const existingByUrl = new Map(existingRecords.map((record) => [record.url, record]));

	for (const article of articles) {
		const payload = {
			websiteId: website.id,
			owner: website.owner,
			url: article.url,
			slug: article.slug || deriveSlug(article.url),
			title: article.title || deriveSlug(article.url),
			meta_description: article.metaDescription || '',
			featured_image: article.featuredImage || '',
			publish_date: article.publishDate || '',
			last_modified_date: article.lastModifiedDate || article.publishDate || '',
			category: article.category || '',
			author: article.author || '',
			language: article.language || '',
			status: existingByUrl.get(article.url)?.status || 'new',
			source: article.source || source,
			scan_run_id: runId,
		};

		const existing = existingByUrl.get(article.url);
		if (!existing) {
			await pocketbaseClient.collection('website_articles').create(payload);
			summary.newArticles += 1;
			continue;
		}

		const updatePayload = {
			last_modified_date: payload.last_modified_date,
			scan_run_id: runId,
		};

		if (hasMetadataChanges(existing, payload)) {
			Object.assign(updatePayload, {
				slug: payload.slug,
				title: payload.title,
				meta_description: payload.meta_description,
				featured_image: payload.featured_image,
				publish_date: payload.publish_date,
				category: payload.category,
				author: payload.author,
				language: payload.language,
				source: payload.source,
			});
			summary.updatedArticles += 1;
		}

		await pocketbaseClient.collection('website_articles').update(existing.id, updatePayload);
	}

	await pocketbaseClient.collection('websites').update(website.id, {
		discovery_status: 'ready',
		last_scan_at: summary.lastScanAt,
		next_scan_at: summary.nextScheduledScan,
		last_scan_summary: summary,
	});

	onProgress?.({ type: 'summary', summary });
	logger?.info?.('Website scan completed', website.id, summary);

	return summary;
}