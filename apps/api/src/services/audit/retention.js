import pocketbaseClient from '../../utils/pocketbaseClient.js';
import logger from '../../utils/logger.js';
import { writeSystemLog } from './write.js';

const DEFAULT_RETENTION_DAYS = Number.parseInt(process.env.AUDIT_RETENTION_DAYS || '90', 10);

let retentionTimer = null;

async function deleteOlderThan(collection, field, cutoffIso, batch = 50) {
	const rows = await pocketbaseClient.collection(collection).getList(1, batch, {
		filter: pocketbaseClient.filter(`${field} < {:cutoff}`, { cutoff: cutoffIso }),
		requestKey: null,
	}).catch(() => ({ items: [] }));
	let deleted = 0;
	for (const row of rows.items || []) {
		await pocketbaseClient.collection(collection).delete(row.id).catch(() => null);
		deleted += 1;
	}
	return deleted;
}

export async function runAuditRetention({ days = DEFAULT_RETENTION_DAYS } = {}) {
	const cutoff = new Date(Date.now() - Math.max(7, days) * 86400000).toISOString();
	const securityCutoff = new Date(Date.now() - Math.max(days, 180) * 86400000).toISOString();

	const [audit, system, api, login, security] = await Promise.all([
		deleteOlderThan('audit_logs', 'occurred_at', cutoff),
		deleteOlderThan('system_logs', 'occurred_at', cutoff),
		deleteOlderThan('api_requests', 'occurred_at', cutoff),
		deleteOlderThan('login_history', 'occurred_at', cutoff),
		deleteOlderThan('security_events', 'occurred_at', securityCutoff),
	]);

	const total = audit + system + api + login + security;
	if (total > 0) {
		await writeSystemLog({
			level: 'info',
			source: 'audit-retention',
			message: `Retention cleanup removed ${total} rows`,
			meta: { audit, system, api, login, security, days },
		});
	}
	return { deleted: total, audit, system, api, login, security, cutoff };
}

export function startAuditRetentionWorker() {
	if (retentionTimer) return;
	const interval = Number.parseInt(process.env.AUDIT_RETENTION_MS || String(6 * 60 * 60 * 1000), 10);
	logger.info(`[audit] retention worker every ${interval}ms (keep ${DEFAULT_RETENTION_DAYS}d)`);
	const tick = () => {
		runAuditRetention().catch((error) => {
			logger.warn(`[audit] retention failed: ${error.message}`);
		});
	};
	tick();
	retentionTimer = setInterval(tick, interval);
}

export function stopAuditRetentionWorker() {
	if (retentionTimer) {
		clearInterval(retentionTimer);
		retentionTimer = null;
	}
}
