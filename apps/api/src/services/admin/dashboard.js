import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { buildPlatformOverview } from '../analytics/platform.js';
import { getLatestHealthPayload } from '../health/monitor.js';
import { listRecentActivity } from '../queue/metrics.js';
import { listActiveAlerts } from '../health/incidents.js';
import { formatRelative, safeList } from './helpers.js';

export async function getAdminDashboard() {
	const [overview, health, queueActivity, alerts, recentUsers] = await Promise.all([
		buildPlatformOverview({ range: '7d' }).catch(() => null),
		getLatestHealthPayload().catch(() => null),
		listRecentActivity(8).catch(() => []),
		listActiveAlerts(8).catch(() => []),
		safeList('users', 1, 6, { sort: '-created' }),
	]);

	const kpis = overview?.kpis?.['7d'] || overview?.kpis?.today || overview?.kpis || {};
	const providers = overview?.providers || [];
	const stats = {
		activeUsers: Number(kpis.activeUsers || kpis.totalUsers) || 0,
		workspaces: Number(kpis.activeWorkspaces || kpis.totalWorkspaces) || 0,
		creditsUsed: Number(kpis.creditsConsumed) || 0,
		aiRequests: providers.reduce((sum, row) => sum + (Number(row.requests) || 0), 0),
		revenue: Number(kpis.mrr) || 0,
		serverHealth: health?.overall?.status === 'healthy'
			? 'Operational'
			: health?.overall?.status === 'warning'
				? 'Degraded'
				: health?.overall?.status === 'critical'
					? 'Critical'
					: 'Operational',
	};

	const chartSource = overview?.charts?.aiRequests || overview?.charts?.dau || overview?.charts?.creditsUsage || [];
	const max = Math.max(1, ...chartSource.map((row) => Number(row.value) || 0));
	const chart = (chartSource.length ? chartSource : [
		{ label: 'Mon', value: 0 },
		{ label: 'Tue', value: 0 },
		{ label: 'Wed', value: 0 },
		{ label: 'Thu', value: 0 },
		{ label: 'Fri', value: 0 },
		{ label: 'Sat', value: 0 },
		{ label: 'Sun', value: 0 },
	]).slice(-7).map((row) => ({
		label: row.label,
		value: Math.round(((Number(row.value) || 0) / max) * 100),
	}));

	const mappedAlerts = (alerts.length ? alerts : (health?.alerts || [])).slice(0, 8).map((alert) => ({
		id: alert.id,
		text: alert.message || alert.text || alert.title || 'Alert',
		tone: alert.severity === 'critical' || alert.severity === 'error'
			? 'red'
			: alert.severity === 'warning' || alert.status === 'open'
				? 'amber'
				: 'green',
	}));

	const registrations = (recentUsers.items || []).map((user) => ({
		name: user.name || user.email || 'User',
		plan: user.plan || 'free',
	}));

	const activity = (queueActivity.length
		? queueActivity
		: (overview?.activity || [])
	).slice(0, 8).map((item) => ({
		id: item.id || `${item.text}-${item.time}`,
		text: item.text || item.message || 'Activity',
		time: item.time || formatRelative(item.at || item.created),
	}));

	return {
		stats,
		alerts: mappedAlerts,
		activity,
		chart,
		registrations,
		meta: {
			computedAt: new Date().toISOString(),
			health: health?.overall?.status || 'unknown',
		},
	};
}
