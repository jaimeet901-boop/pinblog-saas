import { decryptSecret } from '../utils/secretCrypto.js';
import { buildWordpressAuthHeader, normalizeWpAuthType, WP_AUTH_TYPES } from './wordpress-auth.js';
import { writeWordpressApiLog } from './wordpress-api-log.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export function resolveWordpressOrigin(url) {
	try {
		return new URL(url).origin;
	} catch {
		throw httpError(422, 'Invalid website URL', 'VALIDATION_ERROR');
	}
}

/**
 * Chef IA requires HTTPS for Application Password transport.
 * Allows http only for localhost / private-lab hosts.
 */
export function assertWordpressHttps(url, { allowLocalHttp = true } = {}) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw httpError(422, 'Invalid website URL', 'VALIDATION_ERROR');
	}

	const host = parsed.hostname.toLowerCase();
	const isLocal = host === 'localhost'
		|| host === '127.0.0.1'
		|| host.endsWith('.local')
		|| host.endsWith('.test');

	if (parsed.protocol === 'https:') {
		return {
			ok: true,
			httpsValidated: true,
			protocol: 'https:',
			origin: parsed.origin,
			host,
		};
	}

	if (parsed.protocol === 'http:' && allowLocalHttp && isLocal) {
		return {
			ok: true,
			httpsValidated: false,
			protocol: 'http:',
			origin: parsed.origin,
			host,
			warning: 'HTTP allowed only for local development hosts',
		};
	}

	throw httpError(
		422,
		'WordPress site must use HTTPS for Application Password authentication',
		'WP_HTTPS_REQUIRED',
	);
}

function stripHtml(value) {
	return String(value || '')
		.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function computeWordCount(htmlOrText) {
	const text = stripHtml(htmlOrText);
	if (!text) return 0;
	return text.split(/\s+/).filter(Boolean).length;
}

export function computeReadingTimeMinutes(wordCount, wordsPerMinute = 200) {
	const words = Number(wordCount) || 0;
	if (words <= 0) return 0;
	return Math.max(1, Math.ceil(words / Math.max(1, wordsPerMinute)));
}

export function computeArticleSyncHash(payload = {}) {
	const basis = [
		payload.wpPostId || '',
		payload.modified || '',
		payload.title || '',
		payload.slug || '',
		payload.status || '',
		payload.featuredImage || '',
		payload.wordCount || 0,
		payload.contentLength || 0,
	].join('|');
	let hash = 0;
	for (let i = 0; i < basis.length; i += 1) {
		hash = ((hash << 5) - hash) + basis.charCodeAt(i);
		hash |= 0;
	}
	return `h${Math.abs(hash)}`;
}

/** @deprecated Prefer buildWordpressAuthHeader from wordpress-auth.js */
export function buildWordpressAuthHeaderLegacy(username, appPassword) {
	return buildWordpressAuthHeader({
		authType: WP_AUTH_TYPES.APPLICATION_PASSWORD,
		username,
		appPassword,
	});
}

export { buildWordpressAuthHeader };

export function mapWpStatus(status, scheduledAt) {
	const normalized = String(status || 'draft').toLowerCase();
	if (normalized === 'future' || (scheduledAt && ['schedule', 'scheduled'].includes(normalized))) {
		return 'future';
	}
	if (['draft', 'pending', 'private', 'publish', 'future'].includes(normalized)) {
		return normalized;
	}
	if (normalized === 'live' || normalized === 'published') return 'publish';
	return 'draft';
}

function authFromOptions(options = {}) {
	return buildWordpressAuthHeader({
		authType: options.authType || WP_AUTH_TYPES.APPLICATION_PASSWORD,
		username: options.username,
		secret: options.secret || options.appPassword || options.password,
		appPassword: options.appPassword,
		password: options.password,
	});
}

function buildWordpressRestFailure(response, data, text = '') {
	const wpStatus = response.status;
	const wpCode = data?.code ? String(data.code) : '';
	const normalizedCode = wpCode.toLowerCase();
	const message = data?.message
		|| data?.code
		|| `${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 240)}` : ''}`;

	let errorStatus;
	let errorCode;
	let authFailed;
	let retryable;

	if (wpStatus === 401 || normalizedCode === 'rest_not_logged_in') {
		errorStatus = 401;
		errorCode = 'WP_AUTH_FAILED';
		authFailed = true;
		retryable = false;
	} else if (
		normalizedCode === 'rest_cannot_create'
		|| normalizedCode === 'rest_cannot_edit'
		|| normalizedCode === 'rest_cannot_delete'
		|| normalizedCode === 'rest_cannot_publish'
		|| normalizedCode.startsWith('rest_cannot_')
		|| (wpStatus === 403 && normalizedCode === 'rest_forbidden')
	) {
		errorStatus = 403;
		errorCode = 'WP_CAPABILITY_DENIED';
		authFailed = false;
		retryable = false;
	} else if (wpStatus === 403) {
		errorStatus = 403;
		errorCode = 'WP_FORBIDDEN';
		authFailed = false;
		retryable = false;
	} else if (wpStatus === 404) {
		errorStatus = 404;
		errorCode = 'WP_NOT_FOUND';
		authFailed = false;
		retryable = false;
	} else if (wpStatus === 429) {
		errorStatus = 502;
		errorCode = 'WP_REQUEST_FAILED';
		authFailed = false;
		retryable = true;
	} else if (wpStatus >= 500) {
		errorStatus = 502;
		errorCode = 'WP_REQUEST_FAILED';
		authFailed = false;
		retryable = true;
	} else {
		errorStatus = 502;
		errorCode = 'WP_REQUEST_FAILED';
		authFailed = false;
		retryable = false;
	}

	const error = httpError(errorStatus, `WordPress error: ${message}`, errorCode);
	error.wpStatus = wpStatus;
	error.retryable = retryable;
	error.authFailed = authFailed;
	if (wpCode) {
		error.wpCode = wpCode;
	}
	return error;
}

async function wpFetch(base, auth, path, options = {}) {
	const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
	const started = Date.now();
	let response;
	try {
		response = await fetch(url, {
			...options,
			headers: {
				Authorization: auth,
				Accept: 'application/json',
				...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
				...(options.headers || {}),
			},
		});
	} catch (err) {
		if (options.logContext) {
			await writeWordpressApiLog({
				...options.logContext,
				method: options.method || 'GET',
				path,
				statusCode: 0,
				durationMs: Date.now() - started,
				ok: false,
				error: err.message,
			});
		}
		throw httpError(502, `Could not reach WordPress: ${err.message}`, 'WP_UNREACHABLE');
	}

	const text = await response.text().catch(() => '');
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}

	if (options.logContext) {
		await writeWordpressApiLog({
			...options.logContext,
			method: options.method || 'GET',
			path,
			statusCode: response.status,
			durationMs: Date.now() - started,
			ok: response.ok,
			error: response.ok ? '' : (data?.message || response.statusText || ''),
			responseMeta: {
				status: response.status,
				code: data?.code || null,
				id: data?.id || null,
			},
		});
	}

	if (!response.ok) {
		throw buildWordpressRestFailure(response, data, text);
	}

	return data;
}

async function probePublicRest(base) {
	const started = Date.now();
	try {
		const response = await fetch(`${base}/wp-json/`, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		});
		const text = await response.text().catch(() => '');
		let data = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = null;
		}
		return {
			ok: response.ok,
			status: response.status,
			durationMs: Date.now() - started,
			name: data?.name || '',
			description: data?.description || '',
			url: data?.url || base,
			namespaces: Array.isArray(data?.namespaces) ? data.namespaces : [],
			routes: data?.routes && typeof data.routes === 'object' ? Object.keys(data.routes).slice(0, 80) : [],
			gmtOffset: data?.gmt_offset,
			timezone: data?.timezone_string || '',
		};
	} catch (error) {
		return {
			ok: false,
			status: 0,
			durationMs: Date.now() - started,
			error: error.message,
			namespaces: [],
			routes: [],
		};
	}
}

export async function probePublicRestSafe(urlOrOrigin) {
	const base = resolveWordpressOrigin(urlOrOrigin);
	return probePublicRest(base);
}

function detectVersion(indexPayload, authenticatedPayload) {
	const fromAuth = authenticatedPayload?.generator
		|| authenticatedPayload?.version
		|| '';
	if (fromAuth) return String(fromAuth).replace(/^WordPress\s+/i, '').slice(0, 40);
	const routeHint = (indexPayload?.namespaces || []).includes('wp/v2') ? 'REST wp/v2' : '';
	return routeHint || '';
}

function endpointChecklist(indexPayload, authenticated) {
	const routes = new Set(indexPayload?.routes || []);
	const has = (path) => routes.has(path) || routes.has(`${path}/(?P<id>[\\d]+)`) || [...routes].some((item) => item.startsWith(path));
	return {
		restIndex: Boolean(indexPayload?.ok),
		wpV2: (indexPayload?.namespaces || []).includes('wp/v2'),
		posts: has('/wp/v2/posts') || authenticated.posts,
		pages: has('/wp/v2/pages') || authenticated.pages,
		media: has('/wp/v2/media') || authenticated.media,
		categories: has('/wp/v2/categories') || authenticated.categories,
		tags: has('/wp/v2/tags') || authenticated.tags,
		users: has('/wp/v2/users') || authenticated.users,
		types: has('/wp/v2/types') || authenticated.types,
	};
}

function hasWordpressCapability(capabilities, key) {
	if (!capabilities || typeof capabilities !== 'object') return false;
	return Boolean(capabilities[key]);
}

export function wordpressCapabilitiesFromKeys(keys = []) {
	if (!Array.isArray(keys)) return {};
	return Object.fromEntries(keys.filter(Boolean).map((key) => [key, true]));
}

export function wordpressStatusRequiresPublishCapability(wpStatus) {
	const normalized = String(wpStatus || '').toLowerCase();
	return normalized === 'publish' || normalized === 'future' || normalized === 'private';
}

function buildWordpressCapabilityError(message) {
	const error = httpError(403, message, 'WP_CAPABILITY_DENIED');
	error.authFailed = false;
	return error;
}

export function assertWordpressConnectionCapabilities(me, username) {
	const displayName = me?.name || username || 'WordPress user';
	if (!hasWordpressCapability(me?.capabilities, 'edit_posts')) {
		throw buildWordpressCapabilityError(
			`WordPress account "${displayName}" is authenticated but cannot create or edit posts (edit_posts capability missing).`,
		);
	}
}

export function assertWordpressStatusAllowed(me, wpStatus, username) {
	const displayName = me?.name || username || 'WordPress user';
	const capabilities = me?.capabilities || {};

	if (!hasWordpressCapability(capabilities, 'edit_posts')) {
		throw buildWordpressCapabilityError(
			`WordPress account "${displayName}" is authenticated but cannot create or edit posts (edit_posts capability missing).`,
		);
	}

	if (wordpressStatusRequiresPublishCapability(wpStatus) && !hasWordpressCapability(capabilities, 'publish_posts')) {
		const action = String(wpStatus || '').toLowerCase() === 'future'
			? 'schedule posts for publication'
			: 'publish posts publicly';
		throw buildWordpressCapabilityError(
			`WordPress account "${displayName}" cannot ${action} (publish_posts capability missing).`,
		);
	}
}

export async function testWordpressConnection({
	url,
	username,
	appPassword,
	password,
	authType = WP_AUTH_TYPES.APPLICATION_PASSWORD,
	logContext = null,
}) {
	const https = assertWordpressHttps(url);
	const base = https.origin || resolveWordpressOrigin(url);
	const auth = authFromOptions({ authType, username, appPassword, password });
	const publicIndex = await probePublicRest(base);

	if (!publicIndex.ok) {
		throw httpError(
			502,
			publicIndex.error
				? `WordPress REST API unreachable: ${publicIndex.error}`
				: `WordPress REST API unavailable (HTTP ${publicIndex.status || 0})`,
			'WP_REST_UNAVAILABLE',
		);
	}

	const me = await wpFetch(base, auth, '/wp-json/wp/v2/users/me?context=edit', {
		logContext,
	});

	assertWordpressConnectionCapabilities(me, username);

	const authenticated = {
		posts: false,
		pages: false,
		media: false,
		categories: false,
		tags: false,
		users: true,
		types: false,
		settings: false,
	};

	const probes = [
		['posts', '/wp-json/wp/v2/posts?per_page=1'],
		['pages', '/wp-json/wp/v2/pages?per_page=1'],
		['media', '/wp-json/wp/v2/media?per_page=1'],
		['categories', '/wp-json/wp/v2/categories?per_page=1'],
		['tags', '/wp-json/wp/v2/tags?per_page=1'],
		['types', '/wp-json/wp/v2/types?context=edit'],
		['settings', '/wp-json/wp/v2/settings'],
	];

	await Promise.all(probes.map(async ([key, path]) => {
		try {
			await wpFetch(base, auth, path, { logContext });
			authenticated[key] = true;
		} catch {
			authenticated[key] = false;
		}
	}));

	let settings = null;
	if (authenticated.settings) {
		settings = await wpFetch(base, auth, '/wp-json/wp/v2/settings', { logContext }).catch(() => null);
	}

	const endpoints = endpointChecklist(publicIndex, authenticated);
	endpoints.settings = authenticated.settings;
	const version = detectVersion(publicIndex, me) || String(settings?.version || '').slice(0, 40);

	const language = String(
		settings?.language
		|| me?.locale
		|| publicIndex?.language
		|| '',
	).slice(0, 32);

	const timezone = String(
		settings?.timezone
		|| publicIndex.timezone
		|| '',
	).slice(0, 120);

	const permalinkStructure = String(
		settings?.permalink_structure
		|| settings?.permalinkStructure
		|| '',
	).slice(0, 255);

	const capabilities = me?.capabilities && typeof me.capabilities === 'object'
		? Object.keys(me.capabilities).filter((key) => me.capabilities[key])
		: [];

	const siteProfile = {
		name: settings?.title || publicIndex.name || '',
		description: settings?.description || publicIndex.description || '',
		url: settings?.url || publicIndex.url || base,
		home: settings?.url || publicIndex.url || base,
		language,
		timezone,
		gmtOffset: publicIndex.gmtOffset ?? settings?.gmt_offset ?? null,
		permalinkStructure,
		httpsValidated: Boolean(https.httpsValidated),
		httpsWarning: https.warning || '',
		version,
		namespaces: publicIndex.namespaces || [],
		capabilities,
		roles: me?.roles || [],
		checkedAt: new Date().toISOString(),
	};

	return {
		ok: true,
		base,
		authType: normalizeWpAuthType(authType),
		user: {
			id: me?.id,
			name: me?.name || username,
			slug: me?.slug || '',
			roles: me?.roles || [],
			capabilities: me?.capabilities || {},
			capabilityKeys: capabilities,
		},
		version,
		endpoints,
		siteProfile,
		https,
		health: {
			restApi: true,
			credentialsValid: true,
			typesAvailable: authenticated.types,
			settingsAvailable: authenticated.settings,
			version,
			endpoints,
			siteName: siteProfile.name,
			description: siteProfile.description,
			language,
			timezone,
			permalinkStructure,
			httpsValidated: Boolean(https.httpsValidated),
			namespaces: publicIndex.namespaces || [],
			capabilities,
			checkedAt: siteProfile.checkedAt,
		},
	};
}

function mapTerm(item) {
	return {
		id: item.id,
		name: item.name,
		slug: item.slug,
		count: item.count,
		parent: item.parent || 0,
	};
}

export async function fetchWordpressCategories(options) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const items = await wpFetch(base, auth, '/wp-json/wp/v2/categories?per_page=100', {
		logContext: options.logContext,
	});
	return (Array.isArray(items) ? items : []).map(mapTerm);
}

export async function fetchWordpressTags(options) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const items = await wpFetch(base, auth, '/wp-json/wp/v2/tags?per_page=100', {
		logContext: options.logContext,
	});
	return (Array.isArray(items) ? items : []).map(mapTerm);
}

export async function fetchWordpressAuthors(options) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const items = await wpFetch(base, auth, '/wp-json/wp/v2/users?who=authors&per_page=100', {
		logContext: options.logContext,
	});
	return (Array.isArray(items) ? items : []).map((item) => ({
		id: item.id,
		name: item.name,
		slug: item.slug,
		roles: item.roles || [],
	}));
}

function mapPostLike(item) {
	return {
		id: item.id,
		title: item.title?.rendered || item.title || '',
		slug: item.slug || '',
		status: item.status || '',
		link: item.link || '',
		date: item.date || '',
		modified: item.modified || '',
		excerpt: item.excerpt?.rendered || '',
		featuredMedia: item.featured_media || 0,
		author: item.author || null,
		categories: item.categories || [],
		tags: item.tags || [],
	};
}

/**
 * Full post mapping for Chef IA article sync (Phase 4 fields).
 */
export function mapWordpressPostFull(item, {
	featuredImageUrl = '',
	categoryNames = [],
	tagNames = [],
	authorName = '',
	language = '',
} = {}) {
	const title = stripHtml(item.title?.rendered || item.title || '');
	const contentHtml = item.content?.rendered || item.content?.raw || item.content || '';
	const excerptHtml = item.excerpt?.rendered || item.excerpt?.raw || item.excerpt || '';
	const wordCount = computeWordCount(contentHtml || excerptHtml || title);
	const seoTitle = stripHtml(
		item.yoast_head_json?.title
		|| item.rank_math?.title
		|| item.meta?.['_yoast_wpseo_title']
		|| title,
	).slice(0, 500);
	const seoDescription = stripHtml(
		item.yoast_head_json?.description
		|| item.rank_math?.description
		|| item.meta?.['_yoast_wpseo_metadesc']
		|| excerptHtml,
	).slice(0, 2000);
	const canonicalUrl = String(
		item.yoast_head_json?.canonical
		|| item.link
		|| '',
	).slice(0, 1000);
	const sticky = Boolean(item.sticky);
	const payload = {
		wpPostId: Number(item.id) || 0,
		slug: String(item.slug || '').slice(0, 255),
		permalink: String(item.link || '').slice(0, 1000),
		title: title.slice(0, 500),
		excerpt: stripHtml(excerptHtml).slice(0, 5000),
		content: String(contentHtml || ''),
		featuredImage: String(featuredImageUrl || '').slice(0, 1000),
		categories: Array.isArray(categoryNames) ? categoryNames : [],
		tags: Array.isArray(tagNames) ? tagNames : [],
		categoryIds: Array.isArray(item.categories) ? item.categories : [],
		tagIds: Array.isArray(item.tags) ? item.tags : [],
		author: String(authorName || '').slice(0, 255),
		authorId: item.author != null ? String(item.author) : '',
		seoTitle,
		seoDescription,
		readingTime: computeReadingTimeMinutes(wordCount),
		wordCount,
		publishDate: item.date_gmt || item.date || '',
		modifiedDate: item.modified_gmt || item.modified || '',
		status: String(item.status || '').slice(0, 40),
		language: String(language || item.lang || '').slice(0, 32),
		canonicalUrl,
		featured: sticky,
		featuredMediaId: Number(item.featured_media) || 0,
	};
	payload.syncHash = computeArticleSyncHash({
		wpPostId: payload.wpPostId,
		modified: payload.modifiedDate,
		title: payload.title,
		slug: payload.slug,
		status: payload.status,
		featuredImage: payload.featuredImage,
		wordCount: payload.wordCount,
		contentLength: payload.content.length,
	});
	return payload;
}

async function wpFetchRaw(base, auth, path, options = {}) {
	const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
	const started = Date.now();
	let response;
	try {
		response = await fetch(url, {
			...options,
			headers: {
				Authorization: auth,
				Accept: 'application/json',
				...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
				...(options.headers || {}),
			},
		});
	} catch (err) {
		if (options.logContext) {
			await writeWordpressApiLog({
				...options.logContext,
				method: options.method || 'GET',
				path,
				statusCode: 0,
				durationMs: Date.now() - started,
				ok: false,
				error: err.message,
			});
		}
		throw httpError(502, `Could not reach WordPress: ${err.message}`, 'WP_UNREACHABLE');
	}

	const text = await response.text().catch(() => '');
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}

	if (options.logContext) {
		await writeWordpressApiLog({
			...options.logContext,
			method: options.method || 'GET',
			path,
			statusCode: response.status,
			durationMs: Date.now() - started,
			ok: response.ok,
			error: response.ok ? '' : (data?.message || response.statusText || ''),
			responseMeta: {
				status: response.status,
				code: data?.code || null,
				total: response.headers.get('X-WP-Total'),
				totalPages: response.headers.get('X-WP-TotalPages'),
			},
		});
	}

	if (!response.ok) {
		throw buildWordpressRestFailure(response, data, text);
	}

	return {
		data,
		headers: response.headers,
		total: Number(response.headers.get('X-WP-Total') || 0) || 0,
		totalPages: Number(response.headers.get('X-WP-TotalPages') || 0) || 0,
	};
}

export async function countWordpressCollection(options = {}, collection = 'posts') {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const status = options.status ? `&status=${encodeURIComponent(options.status)}` : '';
	const result = await wpFetchRaw(
		base,
		auth,
		`/wp-json/wp/v2/${collection}?per_page=1${status}`,
		{ logContext: options.logContext },
	);
	return result.total;
}

export async function listWordpressPostsRaw(options = {}) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const page = Math.max(1, Number(options.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(options.perPage) || 20));
	const search = options.search ? `&search=${encodeURIComponent(options.search)}` : '';
	const status = options.status ? `&status=${encodeURIComponent(options.status)}` : '&status=publish,draft,pending,private,future';
	const modifiedAfter = options.modifiedAfter
		? `&modified_after=${encodeURIComponent(options.modifiedAfter)}`
		: '';
	const orderby = options.orderby ? `&orderby=${encodeURIComponent(options.orderby)}` : '&orderby=modified';
	const order = options.order ? `&order=${encodeURIComponent(options.order)}` : '&order=desc';
	const result = await wpFetchRaw(
		base,
		auth,
		`/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}${search}${status}${modifiedAfter}${orderby}${order}&context=edit&_embed=1`,
		{ logContext: options.logContext },
	);
	return {
		items: Array.isArray(result.data) ? result.data : [],
		total: result.total,
		totalPages: result.totalPages,
		page,
		perPage,
	};
}

export async function listWordpressPosts(options = {}) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const page = Math.max(1, Number(options.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(options.perPage) || 20));
	const search = options.search ? `&search=${encodeURIComponent(options.search)}` : '';
	const status = options.status ? `&status=${encodeURIComponent(options.status)}` : '';
	const items = await wpFetch(
		base,
		auth,
		`/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}${search}${status}&context=edit`,
		{ logContext: options.logContext },
	);
	return (Array.isArray(items) ? items : []).map(mapPostLike);
}

export async function getWordpressPost(options = {}) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const item = await wpFetch(base, auth, `/wp-json/wp/v2/posts/${options.postId}?context=edit`, {
		logContext: options.logContext,
	});
	return mapPostLike(item);
}

export async function listWordpressPages(options = {}) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const page = Math.max(1, Number(options.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(options.perPage) || 20));
	const search = options.search ? `&search=${encodeURIComponent(options.search)}` : '';
	const items = await wpFetch(
		base,
		auth,
		`/wp-json/wp/v2/pages?per_page=${perPage}&page=${page}${search}&context=edit`,
		{ logContext: options.logContext },
	);
	return (Array.isArray(items) ? items : []).map(mapPostLike);
}

export async function getWordpressPage(options = {}) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const item = await wpFetch(base, auth, `/wp-json/wp/v2/pages/${options.pageId}?context=edit`, {
		logContext: options.logContext,
	});
	return mapPostLike(item);
}

export async function listWordpressMedia(options = {}) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const page = Math.max(1, Number(options.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(options.perPage) || 20));
	const items = await wpFetch(
		base,
		auth,
		`/wp-json/wp/v2/media?per_page=${perPage}&page=${page}`,
		{ logContext: options.logContext },
	);
	return (Array.isArray(items) ? items : []).map((item) => ({
		id: item.id,
		title: item.title?.rendered || item.title || '',
		sourceUrl: item.source_url || '',
		mimeType: item.mime_type || '',
		altText: item.alt_text || '',
		date: item.date || '',
		mediaType: item.media_type || '',
	}));
}

export async function getWordpressMedia(options = {}) {
	const base = resolveWordpressOrigin(options.url);
	const auth = authFromOptions(options);
	const item = await wpFetch(base, auth, `/wp-json/wp/v2/media/${options.mediaId}`, {
		logContext: options.logContext,
	});
	return {
		id: item.id,
		title: item.title?.rendered || item.title || '',
		sourceUrl: item.source_url || '',
		mimeType: item.mime_type || '',
		altText: item.alt_text || '',
		date: item.date || '',
		mediaType: item.media_type || '',
	};
}

async function ensureTermIds({ base, auth, taxonomy, names = [], logContext = null }) {
	const ids = [];
	for (const raw of names) {
		if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
			ids.push(Number(raw));
			continue;
		}
		const name = String(raw || '').trim();
		if (!name) continue;
		const search = await wpFetch(
			base,
			auth,
			`/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(name)}&per_page=10`,
			{ logContext },
		).catch(() => []);
		const existing = (Array.isArray(search) ? search : []).find(
			(item) => String(item.name).toLowerCase() === name.toLowerCase(),
		);
		if (existing) {
			ids.push(existing.id);
			continue;
		}
		const created = await wpFetch(base, auth, `/wp-json/wp/v2/${taxonomy}`, {
			method: 'POST',
			body: JSON.stringify({ name }),
			logContext,
		}).catch(() => null);
		if (created?.id) ids.push(created.id);
	}
	return [...new Set(ids)];
}

export async function uploadWordpressMedia({
	url,
	username,
	appPassword,
	password,
	authType,
	imageUrl,
	filename,
	logContext = null,
}) {
	if (!imageUrl) return null;
	const base = resolveWordpressOrigin(url);
	const auth = authFromOptions({ authType, username, appPassword, password });

	let imageResponse;
	try {
		const { safeFetch } = await import('../utils/ssrf-guard.js');
		imageResponse = await safeFetch(imageUrl, { fieldName: 'featured_image_url' });
	} catch (err) {
		throw httpError(502, `Failed to download featured image: ${err.message}`, 'MEDIA_DOWNLOAD_FAILED');
	}
	if (!imageResponse.ok) {
		throw httpError(502, `Featured image download failed (${imageResponse.status})`, 'MEDIA_DOWNLOAD_FAILED');
	}

	const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
	const buffer = Buffer.from(await imageResponse.arrayBuffer());
	const safeName = filename || `chefia-${Date.now()}.${contentType.includes('png') ? 'png' : 'jpg'}`;
	const started = Date.now();

	let response;
	try {
		response = await fetch(`${base}/wp-json/wp/v2/media`, {
			method: 'POST',
			headers: {
				Authorization: auth,
				'Content-Type': contentType,
				'Content-Disposition': `attachment; filename="${safeName}"`,
			},
			body: buffer,
		});
	} catch (err) {
		if (logContext) {
			await writeWordpressApiLog({
				...logContext,
				method: 'POST',
				path: '/wp-json/wp/v2/media',
				ok: false,
				error: err.message,
				durationMs: Date.now() - started,
			});
		}
		throw httpError(502, `Media upload failed: ${err.message}`, 'MEDIA_UPLOAD_FAILED');
	}

	const text = await response.text().catch(() => '');
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}

	if (logContext) {
		await writeWordpressApiLog({
			...logContext,
			method: 'POST',
			path: '/wp-json/wp/v2/media',
			statusCode: response.status,
			durationMs: Date.now() - started,
			ok: response.ok,
			error: response.ok ? '' : (data?.message || response.statusText || ''),
			responseMeta: { id: data?.id || null },
		});
	}

	if (!response.ok) {
		const error = httpError(
			502,
			`Media upload failed: ${data?.message || response.statusText}`,
			'MEDIA_UPLOAD_FAILED',
		);
		error.retryable = response.status >= 500 || response.status === 429;
		throw error;
	}

	return {
		id: data?.id,
		url: data?.source_url || data?.guid?.rendered || '',
	};
}

export async function createOrUpdateWordpressPost({
	url,
	username,
	appPassword,
	password,
	authType,
	postId,
	title,
	content,
	excerpt,
	slug,
	status,
	scheduledAt,
	categories = [],
	tags = [],
	featuredMediaId,
	authorId,
	metaDescription,
	seo = {},
	recipeCard = null,
	contentType = 'post',
	logContext = null,
}) {
	const base = resolveWordpressOrigin(url);
	const auth = authFromOptions({ authType, username, appPassword, password });
	const wpStatus = mapWpStatus(status, scheduledAt);
	const resource = contentType === 'page' ? 'pages' : 'posts';

	const me = await wpFetch(base, auth, '/wp-json/wp/v2/users/me?context=edit', {
		logContext,
	});
	assertWordpressStatusAllowed(me, wpStatus, username);

	const categoryIds = contentType === 'page'
		? []
		: await ensureTermIds({
			base,
			auth,
			taxonomy: 'categories',
			names: Array.isArray(categories) ? categories : [],
			logContext,
		});
	const tagIds = contentType === 'page'
		? []
		: await ensureTermIds({
			base,
			auth,
			taxonomy: 'tags',
			names: Array.isArray(tags) ? tags : [],
			logContext,
		});

	const body = {
		title,
		content,
		status: wpStatus,
		...(excerpt ? { excerpt } : {}),
		...(slug ? { slug } : {}),
		...(categoryIds.length ? { categories: categoryIds } : {}),
		...(tagIds.length ? { tags: tagIds } : {}),
		...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
		...(authorId ? { author: Number(authorId) } : {}),
	};

	if (wpStatus === 'future' && scheduledAt) {
		const date = new Date(scheduledAt);
		if (!Number.isNaN(date.getTime())) {
			body.date_gmt = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
			body.status = 'future';
		}
	}

	const yoast = metaDescription || seo.metaDescription || seo.description;
	if (yoast || seo.title || recipeCard || seo.focusKeyword) {
		body.meta = {
			...(yoast ? { _yoast_wpseo_metadesc: yoast } : {}),
			...(seo.title ? { _yoast_wpseo_title: seo.title } : {}),
			...(seo.focusKeyword ? { _yoast_wpseo_focuskw: seo.focusKeyword } : {}),
			...(recipeCard ? { chefia_recipe_card: recipeCard } : {}),
		};
	}

	const path = postId
		? `/wp-json/wp/v2/${resource}/${postId}`
		: `/wp-json/wp/v2/${resource}`;

	const data = await wpFetch(base, auth, path, {
		method: 'POST',
		body: JSON.stringify(body),
		logContext,
	});

	return {
		id: data.id,
		link: data.link,
		status: data.status,
		slug: data.slug,
		date: data.date,
		modified: data.modified,
		type: resource === 'pages' ? 'page' : 'post',
	};
}

export function decryptSitePassword(ciphertext) {
	return decryptSecret(ciphertext);
}
