import pocketbaseClient from '../../utils/pocketbaseClient.js';
import logger from '../../utils/logger.js';
import { enqueueJob } from '../queue/jobs.js';
import { invalidateAnalyticsCache } from './cache.js';
import { buildPlatformOverview } from './platform.js';

let refreshTimer = null;

/**
 * Resolve workspace scope keys owned by a user (server-side only).
 * Used so one owner's refresh never blasts every workspace cache.
 */
async function resolveOwnerWorkspaceScopeKeys(ownerId) {
	const owner = String(ownerId || '').trim();
	if (!owner) return [];

	const rows = await pocketbaseClient.collection('workspaces').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
		fields: 'id,workspace_key',
		requestKey: null,
	}).catch(() => []);

	const keys = new Set();
	for (const row of rows || []) {
		const key = String(row.workspace_key || '').trim();
		if (key) keys.add(key);
		// Legacy cache keys sometimes used workspace id.
		if (row.id) keys.add(String(row.id));
	}
	// Legacy workspaceKeyFor fallback used owner id as scope key.
	keys.add(owner);
	return [...keys];
}

/**
 * Refresh analytics caches with workspace-isolated invalidation.
 * Never invalidates all workspace scopes for a single owner event.
 */
export async function refreshAnalyticsCaches({ ownerId, workspaceKey } = {}) {
	await invalidateAnalyticsCache({ scope: 'platform' });
	const ranges = ['today', '7d', '30d', '90d'];
	for (const range of ranges) {
		await buildPlatformOverview({ range, bypassCache: true }).catch((error) => {
			logger.warn(`[analytics] refresh ${range} failed: ${error.message}`);
		});
	}

	const explicitKey = String(workspaceKey || '').trim();
	if (explicitKey) {
		await invalidateAnalyticsCache({ scope: 'workspace', scopeKey: explicitKey });
	} else if (ownerId) {
		const keys = await resolveOwnerWorkspaceScopeKeys(ownerId);
		for (const key of keys) {
			await invalidateAnalyticsCache({ scope: 'workspace', scopeKey: key });
		}
	}

	return {
		refreshed: true,
		ranges,
		workspaceKey: explicitKey || null,
		at: new Date().toISOString(),
	};
}

/**
 * Enqueue analytics refresh. Ownership comes from trusted caller fields (job/req),
 * not from client payload ownership.
 */
export async function enqueueAnalyticsRefresh(ownerId, options = {}) {
	if (!ownerId) return null;
	const workspaceKey = typeof options === 'string'
		? options
		: String(options?.workspaceKey || '').trim();

	return enqueueJob({
		owner: ownerId,
		workspaceKey,
		type: 'analytics_refresh',
		priority: 'low',
		// Do not put owner/workspaceKey in payload — native engine reads job record stamps.
		payload: { scope: workspaceKey ? 'workspace' : 'platform' },
		inputs: { scope: workspaceKey ? 'workspace' : 'platform' },
		provider: 'system',
	}).catch(() => null);
}

export function startAnalyticsRefreshWorker() {
	if (refreshTimer) return;
	const interval = Number.parseInt(process.env.ANALYTICS_REFRESH_MS || String(5 * 60 * 1000), 10);
	logger.info(`[analytics] starting cache refresh every ${interval}ms`);
	const tick = () => {
		refreshAnalyticsCaches().catch((error) => {
			logger.warn(`[analytics] background refresh failed: ${error.message}`);
		});
	};
	tick();
	refreshTimer = setInterval(tick, interval);
}

export function stopAnalyticsRefreshWorker() {
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
}
