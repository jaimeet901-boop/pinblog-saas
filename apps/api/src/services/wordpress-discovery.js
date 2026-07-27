/**
 * WordPress site discovery for Chef IA.
 * Collects site identity, taxonomy, authors, media, and content counts.
 * Does not invent values — only persists what the REST API returns.
 */
import pocketbaseClient from '../utils/pocketbaseClient.js';
import {
	assertWordpressHttps,
	countWordpressCollection,
	fetchWordpressAuthors,
	fetchWordpressCategories,
	fetchWordpressTags,
	listWordpressMedia,
	probePublicRestSafe,
	resolveWordpressOrigin,
	testWordpressConnection,
} from './wordpress-client.js';
import { resolvePublishSite, mapWordpressSite } from './wordpress-sites.js';

function logContextFor(ownerId, site, jobId = '') {
	return {
		ownerId,
		workspaceKey: site?.workspace_key || ownerId,
		siteId: site?.id || '',
		jobId,
	};
}

function pickLogoFromMedia(mediaItems = []) {
	const preferred = (mediaItems || []).find((item) => {
		const title = String(item.title || '').toLowerCase();
		const alt = String(item.altText || '').toLowerCase();
		return /logo|brand|site.?icon|favicon/.test(`${title} ${alt}`);
	});
	return preferred?.sourceUrl || mediaItems?.[0]?.sourceUrl || '';
}

function extractFeaturedImages(mediaItems = [], limit = 12) {
	return (mediaItems || [])
		.filter((item) => item.mediaType === 'image' || String(item.mimeType || '').startsWith('image/'))
		.slice(0, limit)
		.map((item) => ({
			id: item.id,
			url: item.sourceUrl || '',
			title: item.title || '',
			altText: item.altText || '',
		}))
		.filter((item) => item.url);
}

async function fetchPublicSiteBits(url) {
	const origin = resolveWordpressOrigin(url);
	const index = await probePublicRestSafe(origin);
	let favicon = `${origin}/favicon.ico`;
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);
		const response = await fetch(origin, {
			method: 'GET',
			headers: { Accept: 'text/html' },
			signal: controller.signal,
		});
		clearTimeout(timeout);
		const html = await response.text().catch(() => '');
		const iconMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i);
		const href = iconMatch?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
		if (href) {
			favicon = new URL(href, origin).toString();
		}
	} catch {
		// Keep default favicon guess.
	}
	return {
		name: index.name || '',
		description: index.description || '',
		favicon,
		namespaces: index.namespaces || [],
		timezone: index.timezone || '',
	};
}

/**
 * Discover WordPress site metadata and cache it on wordpress_sites.discovery.
 */
export async function discoverOwnedWordpressSite(ownerId, siteId, { refreshConnection = true } = {}) {
	const { site, username, appPassword, authType } = await resolvePublishSite({ ownerId, siteId });
	assertWordpressHttps(site.url);

	const client = {
		url: site.url,
		username,
		appPassword,
		authType,
		logContext: logContextFor(ownerId, site),
	};

	let connection = null;
	if (refreshConnection) {
		connection = await testWordpressConnection(client);
	}

	const publicBits = await fetchPublicSiteBits(site.url);

	const [categories, tags, authors, media, totalPosts, totalPages] = await Promise.all([
		fetchWordpressCategories(client).catch(() => []),
		fetchWordpressTags(client).catch(() => []),
		fetchWordpressAuthors(client).catch(() => []),
		listWordpressMedia({ ...client, page: 1, perPage: 40 }).catch(() => []),
		countWordpressCollection(client, 'posts').catch(() => 0),
		countWordpressCollection(client, 'pages').catch(() => 0),
	]);

	const featuredImages = extractFeaturedImages(media);
	const logo = pickLogoFromMedia(media) || publicBits.favicon || '';

	const discovery = {
		siteTitle: connection?.siteProfile?.name || publicBits.name || site.name || '',
		description: connection?.siteProfile?.description || publicBits.description || '',
		logo,
		favicon: publicBits.favicon || '',
		categories,
		tags,
		authors,
		mediaLibrary: {
			sampled: media.length,
			items: media.slice(0, 20),
		},
		featuredImages,
		totalPosts,
		totalPages,
		language: connection?.siteProfile?.language || site.language || '',
		timezone: connection?.siteProfile?.timezone || publicBits.timezone || site.timezone || '',
		permalinkStructure: connection?.siteProfile?.permalinkStructure || site.permalink_structure || '',
		discoveredAt: new Date().toISOString(),
	};

	const updatePayload = {
		discovery,
		site_profile: connection?.siteProfile || site.site_profile || null,
		language: discovery.language,
		timezone: discovery.timezone,
		permalink_structure: discovery.permalinkStructure,
		https_validated: Boolean(connection?.https?.httpsValidated ?? site.https_validated),
		last_discovered_at: discovery.discoveredAt,
		status: site.status === 'failed' ? 'connected' : (site.status || 'connected'),
		last_error: '',
	};

	if (connection) {
		updatePayload.health = connection.health;
		updatePayload.endpoints = connection.endpoints;
		updatePayload.wp_version = connection.version || '';
		updatePayload.auth_type = connection.authType;
		updatePayload.last_tested_at = new Date().toISOString();
	}

	const updated = await pocketbaseClient.collection('wordpress_sites').update(site.id, updatePayload).catch(async () => {
		const legacy = { ...updatePayload };
		delete legacy.site_profile;
		delete legacy.discovery;
		delete legacy.language;
		delete legacy.timezone;
		delete legacy.permalink_structure;
		delete legacy.https_validated;
		delete legacy.last_discovered_at;
		return pocketbaseClient.collection('wordpress_sites').update(site.id, legacy);
	});

	if (site.website) {
		await pocketbaseClient.collection('websites').update(site.website, {
			name: discovery.siteTitle || undefined,
			favicon: discovery.favicon || undefined,
			status: 'active',
		}).catch(() => null);
	}

	return {
		ok: true,
		discovery,
		site: mapWordpressSite(updated, { hasCredentials: true, username, authType }),
		connection: connection
			? {
				version: connection.version,
				health: connection.health,
				endpoints: connection.endpoints,
				siteProfile: connection.siteProfile,
			}
			: null,
	};
}
