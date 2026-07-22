import pocketbaseClient from '../utils/pocketbaseClient.js';
import { encryptSecret, decryptSecret, isEncryptedSecret } from '../utils/secretCrypto.js';
import { httpError } from '../middleware/require-admin.js';
import {
	testWordpressConnection,
	fetchWordpressCategories,
	fetchWordpressTags,
	fetchWordpressAuthors,
} from './wordpress-client.js';

function workspaceKeyFor(userId) {
	return String(userId || '').trim();
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
	};
}

async function upsertCredentials({ siteId, ownerId, username, password }) {
	const existing = await getCredentials(siteId);
	const payload = {
		site: siteId,
		owner: ownerId,
		username,
		ciphertext: encryptSecret(password),
		kek_version: 'v1',
		rotated_at: new Date().toISOString(),
	};
	if (existing) {
		return pocketbaseClient.collection('wordpress_credentials').update(existing.id, payload);
	}
	return pocketbaseClient.collection('wordpress_credentials').create(payload);
}

/**
 * Ensure a wordpress_sites + credentials row exists for a legacy websites record.
 */
export async function ensureWordpressSiteFromWebsite(website, ownerId) {
	if (!website?.id) return null;
	const workspaceKey = workspaceKeyFor(ownerId);

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
	if (!site) {
		const existingDefaults = await pocketbaseClient.collection('wordpress_sites').getList(1, 1, {
			filter: pocketbaseClient.filter('owner = {:owner} && is_default = true', { owner: ownerId }),
			requestKey: null,
		}).catch(() => ({ totalItems: 0 }));

		site = await pocketbaseClient.collection('wordpress_sites').create({
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
		});
	} else {
		site = await pocketbaseClient.collection('wordpress_sites').update(site.id, {
			name: website.name || site.name,
			url: website.url || site.url,
			domain: website.domain || site.domain || domainFromUrl(website.url),
			status: site.status === 'failed' ? site.status : status,
			website: website.id,
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
		}));
	}
	return { items, totalItems: items.length };
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
	const { site, username, appPassword } = await resolvePublishSite({ ownerId, siteId });
	try {
		const result = await testWordpressConnection({
			url: site.url,
			username,
			appPassword,
		});
		const updated = await pocketbaseClient.collection('wordpress_sites').update(site.id, {
			status: 'connected',
			health: result.health,
			last_tested_at: new Date().toISOString(),
			last_error: '',
		});
		if (site.website) {
			await pocketbaseClient.collection('websites').update(site.website, { status: 'active' }).catch(() => null);
		}
		return {
			ok: true,
			message: `Connected as ${result.user.name}`,
			user: result.user,
			site: mapWordpressSite(updated, { hasCredentials: true, username }),
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

export async function getSiteTaxonomy(ownerId, siteId, kind) {
	const { site, username, appPassword } = await resolvePublishSite({ ownerId, siteId });
	if (kind === 'categories') {
		return { items: await fetchWordpressCategories({ url: site.url, username, appPassword }) };
	}
	if (kind === 'tags') {
		return { items: await fetchWordpressTags({ url: site.url, username, appPassword }) };
	}
	if (kind === 'authors') {
		return { items: await fetchWordpressAuthors({ url: site.url, username, appPassword }) };
	}
	if (kind === 'health') {
		const tested = await testOwnedWordpressSite(ownerId, site.id);
		return tested.health;
	}
	throw httpError(404, 'Unknown taxonomy', 'NOT_FOUND');
}
