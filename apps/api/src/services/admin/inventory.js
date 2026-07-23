import pocketbaseClient from '../../utils/pocketbaseClient.js';
import {
	domainFromUrl,
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
	const items = await Promise.all((result.items || []).map(async (site) => ({
		id: site.id,
		domain: domainFromUrl(site.domain || site.url || site.name),
		workspace: await workspaceNameForOwner(site.owner, cache),
		cms: 'WordPress',
		status: mapWebsiteStatus(site.status),
	})));

	return {
		items,
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || items.length,
		totalPages: result.totalPages || 1,
	};
}

export async function listInventoryPinterestAccounts(query = {}) {
	const { page, perPage } = normalizePage(query, 50);
	const parts = [];
	if (query.status) {
		const status = String(query.status);
		if (status === 'connected') {
			parts.push('(status = "connected" || status = "active" || status = "" || status = null)');
		} else if (status === 'degraded') {
			parts.push('(status = "expired" || status = "failed" || status = "error" || status = "degraded")');
		} else {
			parts.push(pocketbaseClient.filter('status = {:status}', { status }));
		}
	}
	if (query.q) {
		const q = String(query.q).trim();
		if (q) {
			parts.push(pocketbaseClient.filter('(name ~ {:q} || username ~ {:q})', { q }));
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
			name: account.name || account.username || account.id,
			workspace: await workspaceNameForOwner(account.owner, cache),
			boards: Number(boards.totalItems) || Number(account.board_count) || 0,
			status: mapPinterestStatus(account.status || 'connected'),
		};
	}));

	let filtered = items;
	if (query.q) {
		const q = String(query.q).trim().toLowerCase();
		filtered = items.filter((item) => `${item.name} ${item.workspace}`.toLowerCase().includes(q));
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
