import logger from '../../utils/logger.js';
import { enqueueJob } from '../queue/jobs.js';
import { invalidateAnalyticsCache } from './cache.js';
import { buildPlatformOverview } from './platform.js';

let refreshTimer = null;

export async function refreshAnalyticsCaches({ ownerId } = {}) {
	await invalidateAnalyticsCache({ scope: 'platform' });
	const ranges = ['today', '7d', '30d', '90d'];
	for (const range of ranges) {
		await buildPlatformOverview({ range, bypassCache: true }).catch((error) => {
			logger.warn(`[analytics] refresh ${range} failed: ${error.message}`);
		});
	}
	if (ownerId) {
		await invalidateAnalyticsCache({ scope: 'workspace' });
	}
	return { refreshed: true, ranges, at: new Date().toISOString() };
}

export async function enqueueAnalyticsRefresh(ownerId) {
	if (!ownerId) return null;
	return enqueueJob({
		owner: ownerId,
		type: 'analytics_refresh',
		priority: 'low',
		payload: { scope: 'platform' },
		inputs: { scope: 'platform' },
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
