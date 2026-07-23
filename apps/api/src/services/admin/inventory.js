import pocketbaseClient from '../../utils/pocketbaseClient.js';
import {
	domainFromUrl,
	formatDateTime,
	mapPinterestStatus,
	mapWebsiteStatus,
	normalizePage,
	safeFullList,
	safeList,
} from './helpers.js';

async function workspaceNameForOwner(ownerId, cache) {
	if (!ownerId) return '—';
	if (cache.has(ownerId)) return cache.get(ownerId);
	const workspace = await pocketbaseClient.collection('workspaces').getFirstListItem(
		pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		{ requestKey: null },
	).catch(() => null);
	const name = workspace?.name || '—';
	cache.set(ownerId, name);
	return name;
}

export async function listInventoryWebsites(query = {}) {
	const { page, perPage } = normalizePage(query, 50);
	const parts = [];
	if (query.status) {
		const status = String(query.status);
		if (status === 'connected') {
			parts.push('(status = "connected" || status = "active" || status = "ready")');
		} else if (status === 'degraded') {
			parts.push('(status = "failed" || status = "error" || status = "degraded")');
		} else {
			parts.push(pocketbaseClient.filter('status = {:status}', { status }));
		}
	}
	if (query.q) {
		const q = String(query.q).trim();
		if (q) {
			parts.push(pocketbaseClient.filter('(name ~ {:q} || url ~ {:q} || domain ~ {:q})', { q }));
		}
	}

	const result = await safeList('websites', page, perPage, {
		filter: parts.length ? parts.join(' && ') : undefined,
		sort: '-updated,-created',
	});

	const cache = new Map();
	const items = await Promise.all((result.items || []).map(async (site) => {
		const wpSite = await pocketbaseClient.collection('wordpress_sites').getFirstListItem(
			pocketbaseClient.filter('website = {:website} || url = {:url}', {
				website: site.id,
				url: site.url,
			}),
			{ requestKey: null },
		).catch(() => null);

		const publishStats = wpSite
			? await Promise.all([
				pocketbaseClient.collection('publish_history').getList(1, 1, {
					filter: pocketbaseClient.filter('site = {:site} && result = "published"', { site: wpSite.id }),
					requestKey: null,
				}).catch(() => ({ totalItems: 0 })),
				pocketbaseClient.collection('publish_history').getList(1, 1, {
					filter: pocketbaseClient.filter('site = {:site} && result = "failed"', { site: wpSite.id }),
					requestKey: null,
				}).catch(() => ({ totalItems: 0 })),
				pocketbaseClient.collection('publish_jobs').getList(1, 1, {
					filter: pocketbaseClient.filter('site = {:site} && (status = "queued" || status = "scheduled" || status = "publishing")', { site: wpSite.id }),
					requestKey: null,
				}).catch(() => ({ totalItems: 0 })),
			])
			: [{ totalItems: 0 }, { totalItems: 0 }, { totalItems: 0 }];

		const published = Number(publishStats[0].totalItems) || 0;
		const failed = Number(publishStats[1].totalItems) || 0;
		const inFlight = Number(publishStats[2].totalItems) || 0;
		const attempts = published + failed;
		const successRate = attempts ? Math.round((published / attempts) * 1000) / 10 : null;

		return {
			id: site.id,
			domain: domainFromUrl(site.domain || site.url || site.name),
			workspace: await workspaceNameForOwner(site.owner, cache),
			cms: 'WordPress',
			status: mapWebsiteStatus(wpSite?.status || site.status),
			updatedAt: formatDateTime(site.updated || site.created),
			wpVersion: wpSite?.wp_version || wpSite?.health?.version || '',
			lastTestedAt: formatDateTime(wpSite?.last_tested_at),
			publishing: {
				published,
				failed,
				inFlight,
				successRate,
				status: inFlight > 0
					? 'publishing'
					: failed > published && failed > 0
						? 'degraded'
						: published > 0
							? 'healthy'
							: 'idle',
			},
		};
	}));

	return {
		items,
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || items.length,
		totalPages: result.totalPages || 1,
	};
}

export async function listInventoryPinterestAccounts(query = {}) {
	const { page, perPage } = normalizePage(query, 100);
	const parts = [];
	if (query.status) {
		const status = String(query.status);
		if (status === 'connected') {
			parts.push('(status = "connected" || status = "active" || status = "" || status = null || connected = true)');
		} else if (status === 'degraded') {
			parts.push('(status = "expired" || status = "failed" || status = "error" || status = "degraded")');
		} else {
			parts.push(pocketbaseClient.filter('status = {:status}', { status }));
		}
	}
	if (query.q) {
		const q = String(query.q).trim();
		if (q) {
			parts.push(pocketbaseClient.filter('(label ~ {:q} || account_name ~ {:q} || username ~ {:q})', { q }));
		}
	}

	const result = await safeList('pinterest_accounts', page, perPage, {
		filter: parts.length ? parts.join(' && ') : undefined,
		sort: '-updated,-created',
	});

	const cache = new Map();
	const items = await Promise.all((result.items || []).map(async (account) => {
		const boards = await pocketbaseClient.collection('pinterest_boards').getList(1, 1, {
			filter: pocketbaseClient.filter('account = {:account} || owner = {:owner}', {
				account: account.id,
				owner: account.owner,
			}),
			requestKey: null,
		}).catch(() => ({ totalItems: 0 }));
		return {
			id: account.id,
			name: account.label || account.account_name || account.username || account.name || account.id,
			username: account.username || '—',
			workspace: await workspaceNameForOwner(account.owner, cache),
			boards: Number(boards.totalItems) || Number(account.board_count) || 0,
			status: mapPinterestStatus(account.status || (account.connected ? 'connected' : 'error')),
			connectedAt: formatDateTime(account.connected_at || account.created),
			expiresAt: formatDateTime(account.token_expires_at),
			lastSyncAt: formatDateTime(account.last_sync_at),
		};
	}));

	let filtered = items;
	if (query.q) {
		const q = String(query.q).trim().toLowerCase();
		filtered = items.filter((item) => `${item.name} ${item.username} ${item.workspace}`.toLowerCase().includes(q));
	}

	return {
		items: filtered,
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || filtered.length,
		totalPages: result.totalPages || 1,
	};
}

export async function listAllWebsitesForFilters() {
	return safeFullList('websites');
}
