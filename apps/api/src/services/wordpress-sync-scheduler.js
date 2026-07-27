/**
 * Lightweight scheduler for due WordPress article syncs.
 * Uses next_sync_at on wordpress_sites — no UI changes required.
 */
import logger from '../utils/logger.js';
import { processDueWordpressSyncs } from './wordpress-sync.js';

let timer = null;
let running = false;

const INTERVAL_MS = Math.max(
	60_000,
	Number(process.env.WORDPRESS_SYNC_TICK_MS) || 5 * 60_000,
);

async function tick() {
	if (running) return;
	running = true;
	try {
		const result = await processDueWordpressSyncs({ limit: 3 });
		if (result.processed > 0) {
			logger.info('WordPress scheduled sync tick', result);
		}
	} catch (error) {
		logger.warn('WordPress scheduled sync tick failed', {
			message: error?.message || String(error),
		});
	} finally {
		running = false;
	}
}

export function startWordpressSyncScheduler() {
	if (timer) return;
	timer = setInterval(tick, INTERVAL_MS);
	if (typeof timer.unref === 'function') timer.unref();
	logger.info('WordPress sync scheduler started', { intervalMs: INTERVAL_MS });
}

export function stopWordpressSyncScheduler() {
	if (!timer) return;
	clearInterval(timer);
	timer = null;
}
