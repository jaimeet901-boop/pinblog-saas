import pocketbaseClient from '../utils/pocketbaseClient.js';
import { encryptSecret, decryptSecret, isEncryptedSecret } from '../utils/secretCrypto.js';
import { httpError } from '../middleware/require-admin.js';
import { normalizeWpAuthType, WP_AUTH_TYPES, listWordpressAuthProviders } from './wordpress-auth.js';
import {
	testWordpressConnection,
	fetchWordpressCategories,
	fetchWordpressTags,
	fetchWordpressAuthors,
	listWordpressPosts,
	getWordpressPost,
	listWordpressPages,
	getWordpressPage,
	listWordpressMedia,
	getWordpressMedia,
} from './wordpress-client.js';
import { ensureUserWorkspace } from './workspace-context.js';

function workspaceKeyFor(userId) {
	return String(userId || '').trim();
}

async function resolveWorkspaceKey(ownerId) {
	try {
		const ctx = await ensureUserWorkspace(ownerId);
		return ctx.workspaceKey || ctx.workspace?.workspace_key || workspaceKeyFor(ownerId);
	} catch {
		return workspaceKeyFor(ownerId);
	}
}

function domainFromUrl(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

export function mapWordpressSite(site, extras = {}) {
	return {
		id: site.id,
		name: site.name,
		url: site.url,
		domain: site.domain || domainFromUrl(site.url),
		status: site.status || 'untested',
		isDefault: Boolean(site.is_default),
		websiteId: site.website || site.website_id || null,
		health: site.health || null,
		endpoints: site.endpoints || site.health?.endpoints || null,
		wpVersion: site.wp_version || site.health?.version || '',
		authType: site.auth_type || extras.authType || WP_AUTH_TYPES.APPLICATION_PASSWORD,
		lastTestedAt: site.last_tested_at || null,
		lastError: site.last_error || '',
		hasCredentials: Boolean(extras.hasCredentials),
		username: extras.username || '',
		created: site.created,
		updated: site.updated,
	};
}

async function getCredentials(siteId) {
	try {
		return await pocketbaseClient.collection('wordpress_credentials').getFirstListItem(
			pocketbaseClient.filter('site = {:site}', { site: siteId }),
			{ requestKey: null },
		);
	} catch {
		return null;
	}
}

export async function getSiteCredentialsPlain(siteId, ownerId) {
	const site = await pocketbaseClient.collection('wordpress_sites').getOne(siteId).catch(() => null);
	if (!site || site.owner !== ownerId) {
		throw httpError(404, 'WordPress site not found', 'NOT_FOUND');
	}
	const creds = await getCredentials(siteId);
	if (!creds) {
		throw httpError(422, 'WordPress credentials are missing', 'WP_CREDENTIALS_MISSING');
	}
	return {
		site,
		username: creds.username,
		appPassword: decryptSecret(creds.ciphertext),
		authType: normalizeWpAuthType(creds.auth_type || site.auth_type || WP_AUTH_TYPES.APPLICATION_PASSWORD),
	};
}

function logContextFor(ownerId, site, jobId = '') {
	return {
		ownerId,
		workspaceKey: site?.workspace_key || ownerId,
		siteId: site?.id || '',
		jobId,
	};
}

async function upsertCredentials({ siteId, ownerId, username, password, authType }) {
	const existing = await getCredentials(siteId);
	const payload = {
		site: siteId,
		owner: ownerId,
		username,
		ciphertext: encryptSecret(password),
		kek_version: 'v1',
		rotated_at: new Date().toISOString(),
		auth_type: normalizeWpAuthType(authType),
	};
	if (existing) {
		return pocketbaseClient.collection('wordpress_credentials').update(existing.id, payload).catch(async () => {
			const legacy = { ...payload };
			delete legacy.auth_type;
			return pocketbaseClient.collection('wordpress_credentials').update(existing.id, legacy);
		});
	}
	return pocketbaseClient.collection('wordpress_credentials').create(payload).catch(async () => {
		const legacy = { ...payload };
		delete legacy.auth_type;
		return pocketbaseClient.collection('wordpress_credentials').create(legacy);
	});
}

/**
 * Ensure a wordpress_sites + credentials row exists for a legacy websites record.
 */
export async function ensureWordpressSiteFromWebsite(website, ownerId, options = {}) {
	if (!website?.id) return null;
	const workspaceKey = await resolveWorkspaceKey(ownerId);

	let site = null;
	try {
		site = await pocketbaseClient.collection('wordpress_sites').getFirstListItem(
			pocketbaseClient.filter('website = {:website} && owner = {:owner}', {
				website: website.id,
				owner: ownerId,
			}),
			{ requestKey: null },
		);
	} catch {
		try {
			site = await pocketbaseClient.collection('wordpress_sites').getFirstListItem(
				pocketbaseClient.filter('url = {:url} && owner = {:owner}', {
					url: website.url,
					owner: ownerId,
				}),
				{ requestKey: null },
			);
		} catch {
			site = null;
		}
	}

	const status = ['connected', 'active'].includes(website.status) ? 'connected' : (website.status || 'untested');
	const authType = normalizeWpAuthType(options.authType || website.auth_type || WP_AUTH_TYPES.APPLICATION_PASSWORD);

	if (!site) {
		const existingDefaults = await pocketbaseClient.collection('wordpress_sites').getList(1, 1, {
			filter: pocketbaseClient.filter('owner = {:owner} && is_default = true', { owner: ownerId }),
			requestKey: null,
		}).catch(() => ({ totalItems: 0 }));

		const createPayload = {
			owner: ownerId,
			workspace_key: workspaceKey,
			name: website.name || domainFromUrl(website.url) || 'WordPress site',
			url: website.url,
			domain: website.domain || domainFromUrl(website.url),
			status,
			is_default: existingDefaults.totalItems === 0,
			website: website.id,
			health: {},
			last_error: '',
			auth_type: authType,
		};
		site = await pocketbaseClient.collection('wordpress_sites').create(createPayload).catch(async () => {
			const legacy = { ...createPayload };
			delete legacy.auth_type;
			return pocketbaseClient.collection('wordpress_sites').create(legacy);
		});
	} else {
		const updatePayload = {
			name: website.name || site.name,
			url: website.url || site.url,
			domain: website.domain || site.domain || domainFromUrl(website.url),
			status: site.status === 'failed' ? site.status : status,
			website: website.id,
			workspace_key: workspaceKey,
			auth_type: authType,
		};
		site = await pocketbaseClient.collection('wordpress_sites').update(site.id, updatePayload).catch(async () => {
			const legacy = { ...updatePayload };
			delete legacy.auth_type;
			return pocketbaseClient.collection('wordpress_sites').update(site.id, legacy);
		});
	}

	if (website.wp_username && website.wp_app_password) {
		const plain = isEncryptedSecret(website.wp_app_password)
			? decryptSecret(website.wp_app_password)
			: website.wp_app_password;
		if (plain) {
			await upsertCredentials({
				siteId: site.id,
				ownerId,
				username: website.wp_username,
				password: plain,
				authType,
			});
		}
	}

	return site;
}

export async function syncWordpressSitesForOwner(ownerId) {
	const websites = await pocketbaseClient.collection('websites').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		requestKey: null,
	}).catch(() => []);

	const sites = [];
	for (const website of websites) {
		const site = await ensureWordpressSiteFromWebsite(website, ownerId);
		if (site) sites.push(site);
	}
	return sites;
}

export async function listWordpressSites(ownerId) {
	await syncWordpressSitesForOwner(ownerId);
	const records = await pocketbaseClient.collection('wordpress_sites').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		sort: '-is_default,-updated',
		requestKey: null,
	}).catch(() => []);

	const items = [];
	for (const site of records) {
		const creds = await getCredentials(site.id);
		items.push(mapWordpressSite(site, {
			hasCredentials: Boolean(creds),
			username: creds?.username || '',
			authType: normalizeWpAuthType(creds?.auth_type || site.auth_type),
		}));
	}
	return {
		items,
		totalItems: items.length,
		authProviders: listWordpressAuthProviders(),
	};
}

export async function resolvePublishSite({ ownerId, siteId, websiteId }) {
	const id = siteId || websiteId;
	if (!id) throw httpError(422, 'siteId is required', 'VALIDATION_ERROR');

	let site = await pocketbaseClient.collection('wordpress_sites').getOne(id).catch(() => null);
	if (site && site.owner === ownerId) {
		return getSiteCredentialsPlain(site.id, ownerId);
	}

	const website = await pocketbaseClient.collection('websites').getOne(id).catch(() => null);
	if (!website || website.owner !== ownerId) {
		throw httpError(404, 'Website not found', 'NOT_FOUND');
	}
	site = await ensureWordpressSiteFromWebsite(website, ownerId);
	return getSiteCredentialsPlain(site.id, ownerId);
}

export async function setDefaultWordpressSite(ownerId, siteId) {
	const site = await pocketbaseClient.collection('wordpress_sites').getOne(siteId).catch(() => null);
	if (!site || site.owner !== ownerId) {
		throw httpError(404, 'WordPress site not found', 'NOT_FOUND');
	}
	const others = await pocketbaseClient.collection('wordpress_sites').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		requestKey: null,
	});
	await Promise.all(others.map((item) => (
		pocketbaseClient.collection('wordpress_sites').update(item.id, { is_default: item.id === siteId })
	)));
	return mapWordpressSite({ ...site, is_default: true }, { hasCredentials: true });
}

export async function testOwnedWordpressSite(ownerId, siteId) {
	const { site, username, appPassword, authType } = await resolvePublishSite({ ownerId, siteId });
	try {
		const result = await testWordpressConnection({
			url: site.url,
			username,
			appPassword,
			authType,
			logContext: logContextFor(ownerId, site),
		});
		const updatePayload = {
			status: 'connected',
			health: result.health,
			endpoints: result.endpoints,
			wp_version: result.version || '',
			auth_type: result.authType,
			last_tested_at: new Date().toISOString(),
			last_error: '',
		};
		const updated = await pocketbaseClient.collection('wordpress_sites').update(site.id, updatePayload).catch(async () => {
			const legacy = { ...updatePayload };
			delete legacy.endpoints;
			delete legacy.wp_version;
			delete legacy.auth_type;
			return pocketbaseClient.collection('wordpress_sites').update(site.id, legacy);
		});
		if (site.website) {
			await pocketbaseClient.collection('websites').update(site.website, { status: 'active' }).catch(() => null);
		}
		return {
			ok: true,
			message: `Connected as ${result.user.name}`,
			user: result.user,
			version: result.version,
			endpoints: result.endpoints,
			site: mapWordpressSite(updated, { hasCredentials: true, username, authType }),
			health: result.health,
		};
	} catch (error) {
		await pocketbaseClient.collection('wordpress_sites').update(site.id, {
			status: 'failed',
			last_tested_at: new Date().toISOString(),
			last_error: error.message,
		}).catch(() => null);
		if (site.website) {
			await pocketbaseClient.collection('websites').update(site.website, { status: 'failed' }).catch(() => null);
		}
		throw error;
	}
}

async function withSiteClient(ownerId, siteId, fn) {
	const creds = await resolvePublishSite({ ownerId, siteId });
	return fn({
		url: creds.site.url,
		username: creds.username,
		appPassword: creds.appPassword,
		authType: creds.authType,
		logContext: logContextFor(ownerId, creds.site),
		site: creds.site,
	});
}

export async function getSiteTaxonomy(ownerId, siteId, kind) {
	if (kind === 'health') {
		const tested = await testOwnedWordpressSite(ownerId, siteId);
		return tested.health;
	}
	return withSiteClient(ownerId, siteId, async (client) => {
		if (kind === 'categories') return { items: await fetchWordpressCategories(client) };
		if (kind === 'tags') return { items: await fetchWordpressTags(client) };
		if (kind === 'authors') return { items: await fetchWordpressAuthors(client) };
		throw httpError(404, 'Unknown taxonomy', 'NOT_FOUND');
	});
}

export async function getSiteContent(ownerId, siteId, kind, query = {}) {
	return withSiteClient(ownerId, siteId, async (client) => {
		if (kind === 'posts') {
			if (query.id) return { item: await getWordpressPost({ ...client, postId: query.id }) };
			return { items: await listWordpressPosts({ ...client, ...query }) };
		}
		if (kind === 'pages') {
			if (query.id) return { item: await getWordpressPage({ ...client, pageId: query.id }) };
			return { items: await listWordpressPages({ ...client, ...query }) };
		}
		if (kind === 'media') {
			if (query.id) return { item: await getWordpressMedia({ ...client, mediaId: query.id }) };
			return { items: await listWordpressMedia({ ...client, ...query }) };
		}
		throw httpError(404, 'Unknown content type', 'NOT_FOUND');
	});
}

export { listWordpressAuthProviders, WP_AUTH_TYPES };
