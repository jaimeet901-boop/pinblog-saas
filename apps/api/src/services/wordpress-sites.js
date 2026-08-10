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
import { getWorkspaceActor, recordBelongsToWorkspace } from './workspace-ownership.js';
import { resolveStoredHealthFromLookup } from './wordpress-health-readonly.js';

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
		// Integration foundation (safe extras; ignored by older clients)
		siteProfile: site.site_profile || null,
		discovery: site.discovery || null,
		language: site.language || site.site_profile?.language || '',
		timezone: site.timezone || site.site_profile?.timezone || '',
		permalinkStructure: site.permalink_structure || site.site_profile?.permalinkStructure || '',
		httpsValidated: Boolean(site.https_validated ?? site.site_profile?.httpsValidated),
		lastDiscoveredAt: site.last_discovered_at || '',
		lastSyncedAt: site.last_synced_at || '',
		nextSyncAt: site.next_sync_at || '',
		syncStatus: site.sync_status || 'idle',
		syncCursor: site.sync_cursor || null,
		lastSyncError: site.last_sync_error || '',
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
	const req = options.req || null;
	const { stampCreateOwnership, andWorkspaceScope, getWorkspaceActor } = await import('./workspace-ownership.js');
	const actor = req ? getWorkspaceActor(req) : null;
	const workspaceKey = req
		? (actor.workspaceKey || await resolveWorkspaceKey(ownerId))
		: await resolveWorkspaceKey(ownerId);
	const resolvedOwner = actor?.workspaceOwnerId || ownerId;

	let site = null;
	try {
		const findFilter = req
			? andWorkspaceScope(req, pocketbaseClient.filter('website = {:website}', { website: website.id }))
			: pocketbaseClient.filter('website = {:website} && owner = {:owner}', {
				website: website.id,
				owner: resolvedOwner,
			});
		site = await pocketbaseClient.collection('wordpress_sites').getFirstListItem(
			findFilter,
			{ requestKey: null },
		);
	} catch {
		try {
			const urlFilter = req
				? andWorkspaceScope(req, pocketbaseClient.filter('url = {:url}', { url: website.url }))
				: pocketbaseClient.filter('url = {:url} && owner = {:owner}', {
					url: website.url,
					owner: resolvedOwner,
				});
			site = await pocketbaseClient.collection('wordpress_sites').getFirstListItem(
				urlFilter,
				{ requestKey: null },
			);
		} catch {
			site = null;
		}
	}

	const status = ['connected', 'active'].includes(website.status) ? 'connected' : (website.status || 'untested');
	const authType = normalizeWpAuthType(options.authType || website.auth_type || WP_AUTH_TYPES.APPLICATION_PASSWORD);

	if (!site) {
		const defaultFilter = req
			? andWorkspaceScope(req, 'is_default = true')
			: pocketbaseClient.filter('owner = {:owner} && is_default = true', { owner: resolvedOwner });
		const existingDefaults = await pocketbaseClient.collection('wordpress_sites').getList(1, 1, {
			filter: defaultFilter,
			requestKey: null,
		}).catch(() => ({ totalItems: 0 }));

		const createPayloadBase = {
			owner: resolvedOwner,
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
		const createPayload = req ? stampCreateOwnership(req, createPayloadBase) : createPayloadBase;
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
				ownerId: resolvedOwner,
				username: website.wp_username,
				password: plain,
				authType,
			});
		}
	}

	return site;
}

export async function syncWordpressSitesForOwner(ownerId, req = null) {
	const { andWorkspaceScope } = await import('./workspace-ownership.js');
	const websites = await pocketbaseClient.collection('websites').getFullList({
		filter: req ? andWorkspaceScope(req) : pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		requestKey: null,
	}).catch(() => []);

	const sites = [];
	for (const website of websites) {
		const site = await ensureWordpressSiteFromWebsite(website, ownerId, { req });
		if (site) sites.push(site);
	}
	return sites;
}

export async function listWordpressSites(ownerId, req = null) {
	await syncWordpressSitesForOwner(ownerId, req);
	const { andWorkspaceScope } = await import('./workspace-ownership.js');
	const records = await pocketbaseClient.collection('wordpress_sites').getFullList({
		filter: req ? andWorkspaceScope(req) : pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
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

export async function resolvePublishSite({ ownerId, siteId, websiteId, req = null }) {
	const id = siteId || websiteId;
	if (!id) throw httpError(422, 'siteId is required', 'VALIDATION_ERROR');
	const { recordBelongsToWorkspace, getWorkspaceActor } = await import('./workspace-ownership.js');
	const resolvedOwner = req ? (getWorkspaceActor(req).workspaceOwnerId || ownerId) : ownerId;

	let site = await pocketbaseClient.collection('wordpress_sites').getOne(id).catch(() => null);
	if (site) {
		const owned = req ? recordBelongsToWorkspace(site, req) : site.owner === resolvedOwner;
		if (owned) {
			return getSiteCredentialsPlain(site.id, resolvedOwner);
		}
	}

	const website = await pocketbaseClient.collection('websites').getOne(id).catch(() => null);
	const websiteOwned = website && (req
		? recordBelongsToWorkspace(website, req)
		: website.owner === resolvedOwner);
	if (!websiteOwned) {
		throw httpError(404, 'Website not found', 'NOT_FOUND');
	}
	site = await ensureWordpressSiteFromWebsite(website, resolvedOwner, { req });
	return getSiteCredentialsPlain(site.id, resolvedOwner);
}

export async function setDefaultWordpressSite(ownerId, siteId, req = null) {
	const { recordBelongsToWorkspace, andWorkspaceScope, getWorkspaceActor } = await import('./workspace-ownership.js');
	const resolvedOwner = req ? (getWorkspaceActor(req).workspaceOwnerId || ownerId) : ownerId;
	const site = await pocketbaseClient.collection('wordpress_sites').getOne(siteId).catch(() => null);
	const owned = site && (req ? recordBelongsToWorkspace(site, req) : site.owner === resolvedOwner);
	if (!owned) {
		throw httpError(404, 'WordPress site not found', 'NOT_FOUND');
	}
	const others = await pocketbaseClient.collection('wordpress_sites').getFullList({
		filter: req ? andWorkspaceScope(req) : pocketbaseClient.filter('owner = {:owner}', { owner: resolvedOwner }),
		requestKey: null,
	});
	await Promise.all(others.map((item) => (
		pocketbaseClient.collection('wordpress_sites').update(item.id, { is_default: item.id === siteId })
	)));
	return mapWordpressSite({ ...site, is_default: true }, { hasCredentials: true });
}

export async function testOwnedWordpressSite(ownerId, siteId, req = null) {
	const { site, username, appPassword, authType } = await resolvePublishSite({ ownerId, siteId, req });
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
			site_profile: result.siteProfile || null,
			language: result.siteProfile?.language || '',
			timezone: result.siteProfile?.timezone || '',
			permalink_structure: result.siteProfile?.permalinkStructure || '',
			https_validated: Boolean(result.https?.httpsValidated),
		};
		const updated = await pocketbaseClient.collection('wordpress_sites').update(site.id, updatePayload).catch(async () => {
			const legacy = { ...updatePayload };
			delete legacy.endpoints;
			delete legacy.wp_version;
			delete legacy.auth_type;
			delete legacy.site_profile;
			delete legacy.language;
			delete legacy.timezone;
			delete legacy.permalink_structure;
			delete legacy.https_validated;
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
			siteProfile: result.siteProfile || null,
			https: result.https || null,
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

async function withSiteClient(ownerId, siteId, fn, req = null) {
	const creds = await resolvePublishSite({ ownerId, siteId, req });
	return fn({
		url: creds.site.url,
		username: creds.username,
		appPassword: creds.appPassword,
		authType: creds.authType,
		logContext: logContextFor(ownerId, creds.site),
		site: creds.site,
	});
}

async function findLinkedWordpressSiteReadOnly(website, resolvedOwner, req = null) {
	const { andWorkspaceScope } = await import('./workspace-ownership.js');
	try {
		const findFilter = req
			? andWorkspaceScope(req, pocketbaseClient.filter('website = {:website}', { website: website.id }))
			: pocketbaseClient.filter('website = {:website} && owner = {:owner}', {
				website: website.id,
				owner: resolvedOwner,
			});
		return await pocketbaseClient.collection('wordpress_sites').getFirstListItem(
			findFilter,
			{ requestKey: null },
		);
	} catch {
		try {
			const urlFilter = req
				? andWorkspaceScope(req, pocketbaseClient.filter('url = {:url}', { url: website.url }))
				: pocketbaseClient.filter('url = {:url} && owner = {:owner}', {
					url: website.url,
					owner: resolvedOwner,
				});
			return await pocketbaseClient.collection('wordpress_sites').getFirstListItem(
				urlFilter,
				{ requestKey: null },
			);
		} catch {
			return null;
		}
	}
}

export async function getStoredWordpressSiteHealth(ownerId, siteId, req = null) {
	const resolvedOwner = req ? (getWorkspaceActor(req).workspaceOwnerId || ownerId) : ownerId;
	const wordpressSite = await pocketbaseClient.collection('wordpress_sites').getOne(siteId).catch(() => null);

	if (wordpressSite) {
		const owned = req ? recordBelongsToWorkspace(wordpressSite, req) : wordpressSite.owner === resolvedOwner;
		if (owned) {
			return wordpressSite.health ?? null;
		}
	}

	const website = await pocketbaseClient.collection('websites').getOne(siteId).catch(() => null);
	let linkedWordpressSite = null;
	if (website && (req ? recordBelongsToWorkspace(website, req) : website.owner === resolvedOwner)) {
		linkedWordpressSite = await findLinkedWordpressSiteReadOnly(website, resolvedOwner, req);
	}

	return resolveStoredHealthFromLookup({
		ownerId,
		wordpressSite,
		website,
		linkedWordpressSite,
		req,
	});
}

export async function getSiteTaxonomy(ownerId, siteId, kind, req = null) {
	if (kind === 'health') {
		return getStoredWordpressSiteHealth(ownerId, siteId, req);
	}
	return withSiteClient(ownerId, siteId, async (client) => {
		if (kind === 'categories') return { items: await fetchWordpressCategories(client) };
		if (kind === 'tags') return { items: await fetchWordpressTags(client) };
		if (kind === 'authors') return { items: await fetchWordpressAuthors(client) };
		throw httpError(404, 'Unknown taxonomy', 'NOT_FOUND');
	}, req);
}

export async function getSiteContent(ownerId, siteId, kind, query = {}, req = null) {
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
	}, req);
}

export { listWordpressAuthProviders, WP_AUTH_TYPES };
