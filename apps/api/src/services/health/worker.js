import logger from '../../utils/logger.js';
import { runHealthCheck } from './monitor.js';

let monitorTimer = null;

export function startHealthMonitorWorker() {
	if (monitorTimer) return;
	const interval = Number.parseInt(process.env.HEALTH_MONITOR_MS || String(60 * 1000), 10);
	logger.info(`[health] monitor worker every ${interval}ms`);
	const tick = () => {
		runHealthCheck({ persist: true }).catch((error) => {
			logger.warn(`[health] monitor failed: ${error.message}`);
		});
	};
	tick();
	monitorTimer = setInterval(tick, interval);
}

export function stopHealthMonitorWorker() {
	if (monitorTimer) {
		clearInterval(monitorTimer);
		monitorTimer = null;
	}
}
