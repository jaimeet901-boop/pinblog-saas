import { decryptSecret } from '../utils/secretCrypto.js';

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

export function buildWordpressAuthHeader(username, appPassword) {
	return `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`;
}

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

async function wpFetch(base, auth, path, options = {}) {
	const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
	let response;
	try {
		response = await fetch(url, {
			...options,
			headers: {
				Authorization: auth,
				...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
				...(options.headers || {}),
			},
		});
	} catch (err) {
		throw httpError(502, `Could not reach WordPress: ${err.message}`, 'WP_UNREACHABLE');
	}

	const text = await response.text().catch(() => '');
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}

	if (!response.ok) {
		const message = data?.message
			|| data?.code
			|| `${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 240)}` : ''}`;
		const error = httpError(
			response.status === 401 || response.status === 403 ? response.status : 502,
			`WordPress error: ${message}`,
			response.status === 401 || response.status === 403 ? 'WP_AUTH_FAILED' : 'WP_REQUEST_FAILED',
		);
		error.wpStatus = response.status;
		error.retryable = response.status >= 500 || response.status === 429;
		error.authFailed = response.status === 401 || response.status === 403;
		throw error;
	}

	return data;
}

export async function testWordpressConnection({ url, username, appPassword }) {
	const base = resolveWordpressOrigin(url);
	const auth = buildWordpressAuthHeader(username, appPassword);
	const me = await wpFetch(base, auth, '/wp-json/wp/v2/users/me?context=edit');
	let siteHealth = null;
	try {
		siteHealth = await wpFetch(base, auth, '/wp-json/wp/v2/types?context=edit');
	} catch {
		siteHealth = null;
	}
	return {
		ok: true,
		base,
		user: {
			id: me?.id,
			name: me?.name || username,
			roles: me?.roles || [],
		},
		health: {
			restApi: true,
			typesAvailable: Boolean(siteHealth),
			checkedAt: new Date().toISOString(),
		},
	};
}

export async function fetchWordpressCategories({ url, username, appPassword }) {
	const base = resolveWordpressOrigin(url);
	const auth = buildWordpressAuthHeader(username, appPassword);
	const items = await wpFetch(base, auth, '/wp-json/wp/v2/categories?per_page=100');
	return (Array.isArray(items) ? items : []).map((item) => ({
		id: item.id,
		name: item.name,
		slug: item.slug,
		count: item.count,
	}));
}

export async function fetchWordpressTags({ url, username, appPassword }) {
	const base = resolveWordpressOrigin(url);
	const auth = buildWordpressAuthHeader(username, appPassword);
	const items = await wpFetch(base, auth, '/wp-json/wp/v2/tags?per_page=100');
	return (Array.isArray(items) ? items : []).map((item) => ({
		id: item.id,
		name: item.name,
		slug: item.slug,
		count: item.count,
	}));
}

export async function fetchWordpressAuthors({ url, username, appPassword }) {
	const base = resolveWordpressOrigin(url);
	const auth = buildWordpressAuthHeader(username, appPassword);
	const items = await wpFetch(base, auth, '/wp-json/wp/v2/users?who=authors&per_page=100');
	return (Array.isArray(items) ? items : []).map((item) => ({
		id: item.id,
		name: item.name,
		slug: item.slug,
		roles: item.roles || [],
	}));
}

async function ensureTermIds({ base, auth, taxonomy, names = [] }) {
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
		}).catch(() => null);
		if (created?.id) ids.push(created.id);
	}
	return [...new Set(ids)];
}

export async function uploadWordpressMedia({ url, username, appPassword, imageUrl, filename }) {
	if (!imageUrl) return null;
	const base = resolveWordpressOrigin(url);
	const auth = buildWordpressAuthHeader(username, appPassword);

	let imageResponse;
	try {
		imageResponse = await fetch(imageUrl);
	} catch (err) {
		throw httpError(502, `Failed to download featured image: ${err.message}`, 'MEDIA_DOWNLOAD_FAILED');
	}
	if (!imageResponse.ok) {
		throw httpError(502, `Featured image download failed (${imageResponse.status})`, 'MEDIA_DOWNLOAD_FAILED');
	}

	const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
	const buffer = Buffer.from(await imageResponse.arrayBuffer());
	const safeName = filename || `chefia-${Date.now()}.${contentType.includes('png') ? 'png' : 'jpg'}`;

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
		throw httpError(502, `Media upload failed: ${err.message}`, 'MEDIA_UPLOAD_FAILED');
	}

	const text = await response.text().catch(() => '');
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
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
	metaDescription,
	seo = {},
	recipeCard = null,
}) {
	const base = resolveWordpressOrigin(url);
	const auth = buildWordpressAuthHeader(username, appPassword);
	const wpStatus = mapWpStatus(status, scheduledAt);

	const categoryIds = await ensureTermIds({
		base,
		auth,
		taxonomy: 'categories',
		names: Array.isArray(categories) ? categories : [],
	});
	const tagIds = await ensureTermIds({
		base,
		auth,
		taxonomy: 'tags',
		names: Array.isArray(tags) ? tags : [],
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
	};

	if (wpStatus === 'future' && scheduledAt) {
		const date = new Date(scheduledAt);
		if (!Number.isNaN(date.getTime())) {
			body.date_gmt = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
			body.status = 'future';
		}
	}

	const yoast = metaDescription || seo.metaDescription || seo.description;
	if (yoast || seo.title || recipeCard) {
		body.meta = {
			...(yoast ? { _yoast_wpseo_metadesc: yoast } : {}),
			...(seo.title ? { _yoast_wpseo_title: seo.title } : {}),
			...(recipeCard ? { chefia_recipe_card: recipeCard } : {}),
		};
	}

	const path = postId
		? `/wp-json/wp/v2/posts/${postId}`
		: '/wp-json/wp/v2/posts';
	const method = postId ? 'POST' : 'POST'; // WP uses POST for create and update with id in path also accepts POST

	const data = await wpFetch(base, auth, path, {
		method,
		body: JSON.stringify(body),
	});

	return {
		id: data.id,
		link: data.link,
		status: data.status,
		slug: data.slug,
		date: data.date,
		modified: data.modified,
	};
}

export function decryptSitePassword(ciphertext) {
	return decryptSecret(ciphertext);
}
