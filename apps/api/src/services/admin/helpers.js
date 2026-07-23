import pocketbaseClient from '../../utils/pocketbaseClient.js';

export function formatDate(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toISOString().slice(0, 10);
}

export function formatDateTime(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toISOString().replace('T', ' ').slice(0, 16);
}

export function formatRelative(value) {
	if (!value) return '—';
	const ms = Date.now() - new Date(value).getTime();
	if (!Number.isFinite(ms) || ms < 0) return 'just now';
	if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
	return `${Math.round(ms / 86_400_000)}d ago`;
}

export function normalizePage(query = {}, fallbackPerPage = 20) {
	const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
	const perPage = Math.min(100, Math.max(1, Number.parseInt(query.perPage, 10) || fallbackPerPage));
	return { page, perPage };
}

export function domainFromUrl(url = '') {
	try {
		const host = new URL(String(url).startsWith('http') ? url : `https://${url}`).hostname;
		return host.replace(/^www\./, '');
	} catch {
		return String(url || '').replace(/^https?:\/\//, '').split('/')[0] || '—';
	}
}

export function mapWebsiteStatus(status) {
	const value = String(status || '').toLowerCase();
	if (value === 'connected' || value === 'active' || value === 'ready') return 'connected';
	if (value === 'failed' || value === 'error' || value === 'degraded') return 'degraded';
	if (value === 'pending' || value === 'untested' || value === 'running') return 'pending';
	return value || 'pending';
}

export function mapPinterestStatus(status) {
	const value = String(status || '').toLowerCase();
	if (value === 'connected' || value === 'active' || value === 'ok') return 'connected';
	if (value === 'expired' || value === 'error' || value === 'failed' || value === 'degraded') return 'degraded';
	if (value === 'pending' || value === 'disconnected') return value === 'disconnected' ? 'disconnected' : 'pending';
	return value || 'connected';
}

export async function safeFullList(collection, options = {}) {
	return pocketbaseClient.collection(collection).getFullList({ requestKey: null, ...options }).catch(() => []);
}

export async function safeList(collection, page, perPage, options = {}) {
	return pocketbaseClient.collection(collection).getList(page, perPage, {
		requestKey: null,
		...options,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));
}

export async function countFilter(collection, filter) {
	const result = await pocketbaseClient.collection(collection).getList(1, 1, {
		filter: filter || undefined,
		requestKey: null,
	}).catch(() => ({ totalItems: 0 }));
	return Number(result.totalItems) || 0;
}

export async function getOwnerSubscription(ownerId, workspaceKey = '') {
	if (workspaceKey) {
		const byKey = await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
			{ expand: 'plan', requestKey: null },
		).catch(() => null);
		if (byKey) return byKey;
	}
	if (!ownerId) return null;
	return pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
		pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
}
