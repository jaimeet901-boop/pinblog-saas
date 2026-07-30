/**
 * Billing Monitoring Engine (BP-5).
 * Observation/aggregation only — no payment runtime mutation.
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { getBillingPermissions } from '../../middleware/billing-permissions.js';
import {
	getRawBillingPayload,
	invalidateBillingRequestCache,
	listControlPlaneHealth,
	listControlPlaneLogs,
	writeControlPlaneAudit,
} from './control-plane.js';
import { normalizeFailoverPolicy } from './failover-helpers.js';
import { getBillingRequestCache } from './request-cache.js';
import { isRevenueEventType } from './revenue-recognition.js';
import {
	ALERT_CODES,
	ALERT_SEVERITIES,
	buildHealthRollup,
	calculateMonitoringHealthScore,
	countOpenAlerts,
	defaultMonitoringPolicy,
	deriveOverallStatus,
	evaluateMonitoringAlerts,
	normalizeMonitoringPolicy,
} from './monitoring-helpers.js';

export {
	ALERT_CODES,
	ALERT_SEVERITIES,
	calculateMonitoringHealthScore,
	normalizeMonitoringPolicy,
	defaultMonitoringPolicy,
} from './monitoring-helpers.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function normalizeProvider(value) {
	const code = String(value || 'none').trim().toLowerCase();
	return code || 'none';
}

async function getSettingsRow() {
	return pocketbaseClient.collection('platform_settings').getFirstListItem(
		pocketbaseClient.filter('config_key = {:key}', { key: 'platform' }),
		{ requestKey: null },
	).catch(() => null);
}

async function persistMonitoring(nextMonitoring, actor = {}, { expectedUpdatedAt = null, billingBase = null } = {}) {
	const row = await getSettingsRow();
	if (!row) throw httpError(500, 'Platform settings are not initialized.', 'SETTINGS_MISSING');
	if (expectedUpdatedAt && row.updated && String(row.updated) !== String(expectedUpdatedAt)) {
		throw httpError(409, 'Billing configuration changed. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
	}

	const payload = structuredClone(row.payload || {});
	payload.billing = payload.billing || {};
	if (billingBase) {
		payload.billing = { ...billingBase, monitoring: nextMonitoring };
	} else {
		payload.billing.monitoring = nextMonitoring;
	}

	const saved = await pocketbaseClient.collection('platform_settings').update(row.id, {
		config_key: 'platform',
		payload,
		version: row.version || 'v1',
		meta: {
			...(row.meta || {}),
			updatedBy: actor.email || actor.id || 'admin',
			updatedAt: new Date().toISOString(),
			billingControlPlane: true,
		},
	});
	invalidateBillingRequestCache();
	clearMonitoringSnapshot();
	const { bumpWorkspaceConfigVersion } = await import('../workspace-config-bus.js');
	bumpWorkspaceConfigVersion('platform_settings');
	return {
		billing: saved.payload?.billing || payload.billing,
		updatedAt: saved.updated,
	};
}

function clearMonitoringSnapshot() {
	const cache = getBillingRequestCache();
	if (cache) cache.monitoringSnapshot = null;
}

function getMonitoringSnapshot() {
	const cache = getBillingRequestCache();
	return cache?.monitoringSnapshot || null;
}

function setMonitoringSnapshot(snapshot) {
	const cache = getBillingRequestCache();
	if (cache) cache.monitoringSnapshot = snapshot;
}

async function countAuditActions(actions = [], hours = 24) {
	const from = new Date(Date.now() - hours * 3600 * 1000).toISOString();
	const counts = Object.fromEntries(actions.map((action) => [action, 0]));
	try {
		const result = await pocketbaseClient.collection('audit_logs').getList(1, 200, {
			filter: pocketbaseClient.filter(
				'(service = "billing-control-plane" || ui_category = "Billing Admin") && occurred_at >= {:from}',
				{ from },
			),
			sort: '-occurred_at',
			requestKey: null,
		});
		for (const row of result.items || []) {
			if (Object.prototype.hasOwnProperty.call(counts, row.action)) {
				counts[row.action] += 1;
			}
		}
	} catch {
		/* empty */
	}
	return counts;
}

async function listFailoverAudit(limit = 100, actionPrefix = 'billing.failover') {
	const result = await pocketbaseClient.collection('audit_logs').getList(1, Math.min(200, limit), {
		filter: `(service = "billing-control-plane" || ui_category = "Billing Admin") && (action ~ "${actionPrefix}")`,
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	return (result.items || []).map((row) => ({
		id: row.id,
		timestamp: row.occurred_at || row.created,
		action: row.action,
		message: row.message,
		provider: row.provider,
		administrator: row.actor_label || '—',
		reasonCode: row.metadata?.after?.reasonCode || null,
		recognition: row.metadata?.after?.recognition || null,
	}));
}

async function composeStatusCore() {
	const [{ billing, updatedAt }, healthPayload] = await Promise.all([
		getRawBillingPayload(),
		listControlPlaneHealth(),
	]);
	const policy = normalizeMonitoringPolicy(billing.monitoring || {});
	const failover = normalizeFailoverPolicy(billing.failover || {});
	const activeProvider = normalizeProvider(billing.provider);
	const items = healthPayload.items || [];
	const activeCard = items.find((item) => item.code === activeProvider) || null;
	const activeHealthStatus = activeCard?.status || (activeProvider === 'none' ? 'Offline' : 'Unknown');
	const activeValidationResult = activeCard?.validation?.result
		|| activeCard?.lastValidation?.result
		|| 'FAIL';

	const hours = policy.windows.metricsHours;
	const auditCounts = await countAuditActions([
		'billing.failover.executed',
		'billing.failover.blocked',
		'billing.failover.recovered',
		'billing.health.check_executed',
		'billing.health.check_failed',
	], hours);

	const failoverBurst = (auditCounts['billing.failover.executed'] || 0) >= policy.thresholds.failoverBurstCount;
	const recentNoEligible = (failover.recentEvents || []).some(
		(event) => event.reasonCode === 'NO_ELIGIBLE_PROVIDER'
			&& event.at
			&& (Date.now() - new Date(event.at).getTime()) < policy.thresholds.failoverBurstMinutes * 60 * 1000,
	) || (failover.lastDecision?.reasonCode === 'NO_ELIGIBLE_PROVIDER');

	const evaluated = evaluateMonitoringAlerts({
		activeProvider,
		checkoutEnabled: Boolean(billing.checkoutEnabled),
		activeHealthStatus,
		activeValidationResult,
		autoFailoverEnabled: Boolean(failover.autoFailoverEnabled),
		failoverBurst,
		recentNoEligible,
		storedItems: policy.alerts.items,
	});

	const openAlerts = evaluated.filter((a) => a.status === 'open' || a.status === 'acknowledged');
	const healthRollup = buildHealthRollup(items);
	const healthScore = calculateMonitoringHealthScore({
		activeProvider,
		activeHealthStatus,
		activeValidationResult,
		openAlerts,
		failoverMode: failover.mode,
		preferredPrimary: failover.preferredPrimary,
		autoFailoverEnabled: failover.autoFailoverEnabled,
		recentNoEligible,
		failoverBurst,
	});
	const overallStatus = deriveOverallStatus({
		openAlerts,
		activeProvider,
		activeHealthStatus,
		healthRollup,
	});

	const lastHealthCheckAt = items
		.map((item) => item.lastHealthCheck)
		.filter(Boolean)
		.sort()
		.reverse()[0] || null;

	return {
		activeProvider,
		checkoutEnabled: Boolean(billing.checkoutEnabled),
		failoverMode: failover.mode,
		autoFailoverEnabled: Boolean(failover.autoFailoverEnabled),
		preferredPrimary: failover.preferredPrimary,
		healthScore,
		healthRollup,
		openAlerts: countOpenAlerts(evaluated),
		alerts: evaluated,
		lastFailoverAt: failover.lastDecision?.type?.includes('failover') || failover.lastDecision?.reasonCode
			? failover.lastDecision.at
			: null,
		lastRecoveryAt: (failover.recentEvents || []).find((e) => e.reasonCode === 'RECOVERY_COMPLETED')?.at || null,
		lastHealthCheckAt,
		overallStatus,
		updatedAt,
		policy,
		failover,
		healthItems: items,
		auditCounts,
		billing,
	};
}

/**
 * Optional monitoring snapshot — read-only request cache, never source of truth.
 */
export async function getMonitoringStatus(adminUser = null, { bypassSnapshot = false } = {}) {
	if (!bypassSnapshot) {
		const cached = getMonitoringSnapshot();
		if (cached?.status) {
			return {
				...cached.status,
				snapshotUsed: true,
				permissions: adminUser ? getBillingPermissions(adminUser) : undefined,
			};
		}
	}

	const core = await composeStatusCore();
	const status = {
		activeProvider: core.activeProvider,
		checkoutEnabled: core.checkoutEnabled,
		failoverMode: core.failoverMode,
		autoFailoverEnabled: core.autoFailoverEnabled,
		healthScore: core.healthScore,
		healthRollup: core.healthRollup,
		openAlerts: core.openAlerts,
		lastFailoverAt: core.lastFailoverAt,
		lastRecoveryAt: core.lastRecoveryAt,
		lastHealthCheckAt: core.lastHealthCheckAt,
		overallStatus: core.overallStatus,
		updatedAt: core.updatedAt,
		pollHintSeconds: core.policy.pollHintSeconds,
		snapshotUsed: false,
	};

	setMonitoringSnapshot({
		status,
		alerts: core.alerts,
		healthItems: core.healthItems,
		policy: core.policy,
		auditCounts: core.auditCounts,
		composedAt: new Date().toISOString(),
	});

	return {
		...status,
		permissions: adminUser ? getBillingPermissions(adminUser) : undefined,
	};
}

export async function getMonitoringHealth(adminUser = null) {
	const core = await composeStatusCore();
	return {
		items: core.healthItems,
		healthRollup: core.healthRollup,
		healthScore: core.healthScore,
		activeProvider: core.activeProvider,
		overallStatus: core.overallStatus,
		updatedAt: core.updatedAt,
		permissions: adminUser ? getBillingPermissions(adminUser) : undefined,
	};
}

export async function getFailoverTimeline(query = {}) {
	const { billing } = await getRawBillingPayload();
	const policy = normalizeMonitoringPolicy(billing.monitoring || {});
	const failover = normalizeFailoverPolicy(billing.failover || {});
	const limit = Math.min(policy.windows.timelineLimit, Number(query.limit) || policy.windows.timelineLimit);
	const items = await listFailoverAudit(limit, 'billing.failover');
	const filtered = items.filter((row) => {
		const action = String(row.action || '');
		return action.includes('executed')
			|| action.includes('blocked')
			|| action.includes('override')
			|| action.includes('noop')
			|| row.reasonCode;
	});
	return {
		items: filtered,
		recentEvents: (failover.recentEvents || []).filter((e) => e.reasonCode !== 'RECOVERY_COMPLETED'),
		limit,
	};
}

export async function getRecoveryTimeline(query = {}) {
	const { billing } = await getRawBillingPayload();
	const policy = normalizeMonitoringPolicy(billing.monitoring || {});
	const failover = normalizeFailoverPolicy(billing.failover || {});
	const limit = Math.min(policy.windows.timelineLimit, Number(query.limit) || policy.windows.timelineLimit);
	const items = (await listFailoverAudit(limit, 'billing.failover')).filter((row) => {
		const action = String(row.action || '');
		return action.includes('recovered') || action.includes('recovery');
	});
	return {
		items,
		recentEvents: (failover.recentEvents || []).filter((e) => e.reasonCode === 'RECOVERY_COMPLETED'),
		limit,
	};
}

export async function getMonitoringEvents(query = {}) {
	const { billing } = await getRawBillingPayload();
	const policy = normalizeMonitoringPolicy(billing.monitoring || {});
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(policy.windows.eventsPageMax, Math.max(1, Number(query.perPage) || 20));
	const provider = String(query.provider || '').trim().toLowerCase();
	const eventType = String(query.eventType || query.type || '').trim();

	const parts = [];
	if (query.from) {
		parts.push(pocketbaseClient.filter('occurred_at >= {:from}', { from: String(query.from) }));
	}
	if (query.to) {
		parts.push(pocketbaseClient.filter('occurred_at <= {:to}', { to: String(query.to) }));
	}
	if (eventType) {
		parts.push(pocketbaseClient.filter('event_type = {:type}', { type: eventType }));
	}

	const result = await pocketbaseClient.collection('billing_events').getList(page, perPage, {
		filter: parts.length ? parts.join(' && ') : undefined,
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));

	let items = (result.items || []).map((row) => ({
		id: row.id,
		workspaceKey: row.workspace_key,
		workspaceName: row.workspace_name,
		eventType: row.event_type,
		fromPlan: row.from_plan,
		toPlan: row.to_plan,
		actor: row.actor,
		message: row.message,
		occurredAt: row.occurred_at || row.created,
		provider: row.metadata?.providerSnapshot || row.metadata?.provider || null,
		amountSnapshot: row.metadata?.amountSnapshot ?? null,
		recognitionHint: row.metadata?.amountSnapshot != null
			? 'event_snapshot'
			: (row.metadata?.providerAmount != null ? 'provider_amount' : null),
	}));

	if (provider) {
		items = items.filter((row) => String(row.provider || '').toLowerCase() === provider);
	}

	return {
		items,
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || items.length,
		totalPages: result.totalPages || 1,
	};
}

export async function getMonitoringAudit(query = {}) {
	return listControlPlaneLogs(query);
}

export async function getMonitoringMetrics() {
	const core = await composeStatusCore();
	const hours = core.policy.windows.metricsHours;
	const from = new Date(Date.now() - hours * 3600 * 1000).toISOString();
	let revenueCount = 0;
	let paymentFailed = 0;
	try {
		const events = await pocketbaseClient.collection('billing_events').getList(1, 200, {
			filter: pocketbaseClient.filter('occurred_at >= {:from}', { from }),
			requestKey: null,
		});
		for (const row of events.items || []) {
			if (isRevenueEventType(row.event_type)) revenueCount += 1;
			if (String(row.event_type || '').includes('payment_failed') || row.event_type === 'payment_failed') {
				paymentFailed += 1;
			}
		}
	} catch {
		/* empty */
	}

	return {
		asOf: new Date().toISOString(),
		window: { hours },
		metrics: {
			'system.health_score': core.healthScore,
			'providers.healthy_count': core.healthRollup.healthy,
			'providers.critical_count': core.healthRollup.critical,
			'failover.executed_24h': core.auditCounts['billing.failover.executed'] || 0,
			'failover.blocked_24h': core.auditCounts['billing.failover.blocked'] || 0,
			'recovery.completed_24h': core.auditCounts['billing.failover.recovered'] || 0,
			'health.checks_24h': (core.auditCounts['billing.health.check_executed'] || 0)
				+ (core.auditCounts['billing.health.check_failed'] || 0),
			'validation.fail_latest': core.healthItems.filter((i) => i.validation?.result === 'FAIL').length,
			'events.revenue_count_24h': revenueCount,
			'events.payment_failed_24h': paymentFailed,
			'alerts.open_count': core.openAlerts,
		},
	};
}

export async function getMonitoringTrends(query = {}) {
	const { billing } = await getRawBillingPayload();
	const policy = normalizeMonitoringPolicy(billing.monitoring || {});
	const days = Math.min(policy.windows.trendsDays, Number(query.days) || policy.windows.trendsDays);
	const from = new Date(Date.now() - days * 86400 * 1000);
	const buckets = {};

	const audits = await pocketbaseClient.collection('audit_logs').getList(1, 200, {
		filter: pocketbaseClient.filter(
			'(service = "billing-control-plane" || ui_category = "Billing Admin") && occurred_at >= {:from}',
			{ from: from.toISOString() },
		),
		sort: '-occurred_at',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	for (const row of audits.items || []) {
		const day = String(row.occurred_at || row.created || '').slice(0, 10);
		if (!day) continue;
		if (!buckets[day]) buckets[day] = { day, failover: 0, recovery: 0, healthChecks: 0 };
		const action = String(row.action || '');
		if (action.includes('failover.executed')) buckets[day].failover += 1;
		if (action.includes('failover.recovered')) buckets[day].recovery += 1;
		if (action.includes('health.check')) buckets[day].healthChecks += 1;
	}

	const items = Object.values(buckets).sort((a, b) => a.day.localeCompare(b.day)).slice(-90);
	return {
		asOf: new Date().toISOString(),
		window: { days },
		items,
	};
}

export async function getMonitoringAlerts(adminUser = null) {
	const cached = getMonitoringSnapshot();
	if (cached?.alerts) {
		return {
			items: cached.alerts,
			severities: ALERT_SEVERITIES,
			codes: ALERT_CODES,
			openCount: countOpenAlerts(cached.alerts),
			snapshotUsed: true,
			permissions: adminUser ? getBillingPermissions(adminUser) : undefined,
		};
	}
	const core = await composeStatusCore();
	return {
		items: core.alerts,
		severities: ALERT_SEVERITIES,
		codes: ALERT_CODES,
		openCount: core.openAlerts,
		snapshotUsed: false,
		permissions: adminUser ? getBillingPermissions(adminUser) : undefined,
	};
}

export async function acknowledgeMonitoringAlert(id, actor = {}, requestMeta = {}) {
	const core = await composeStatusCore();
	const { billing, updatedAt } = { billing: core.billing, updatedAt: core.updatedAt };
	const policy = normalizeMonitoringPolicy(billing.monitoring || {});
	let found = false;
	const items = core.alerts.map((item) => {
		if (item.id !== id) return item;
		found = true;
		return {
			...item,
			status: 'acknowledged',
			acknowledgedAt: new Date().toISOString(),
		};
	});
	if (!found) throw httpError(404, 'Alert not found.', 'ALERT_NOT_FOUND');
	const next = { ...policy, alerts: { items } };
	const saved = await persistMonitoring(next, actor, {
		expectedUpdatedAt: requestMeta.expectedUpdatedAt || updatedAt,
		billingBase: billing,
	});
	await writeControlPlaneAudit({
		action: 'billing.monitoring.alert_acked',
		message: `Alert acknowledged: ${id}`,
		provider: normalizeProvider(saved.billing.provider),
		severity: 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before: { id },
		after: { id, status: 'acknowledged' },
	});
	return {
		items: normalizeMonitoringPolicy(saved.billing.monitoring || next).alerts.items,
		updatedAt: saved.updatedAt,
	};
}

export async function muteMonitoringAlert(id, body = {}, actor = {}, requestMeta = {}) {
	const muteMinutes = Math.max(1, Math.min(10080, Number(body.minutes) || 60));
	const muteUntil = body.muteUntil || new Date(Date.now() + muteMinutes * 60 * 1000).toISOString();
	const core = await composeStatusCore();
	const { billing, updatedAt } = { billing: core.billing, updatedAt: core.updatedAt };
	const policy = normalizeMonitoringPolicy(billing.monitoring || {});
	let found = false;
	const items = core.alerts.map((item) => {
		if (item.id !== id) return item;
		found = true;
		return {
			...item,
			status: 'muted',
			muteUntil,
		};
	});
	if (!found) throw httpError(404, 'Alert not found.', 'ALERT_NOT_FOUND');
	const next = { ...policy, alerts: { items } };
	const saved = await persistMonitoring(next, actor, {
		expectedUpdatedAt: requestMeta.expectedUpdatedAt || updatedAt,
		billingBase: billing,
	});
	await writeControlPlaneAudit({
		action: 'billing.monitoring.alert_muted',
		message: `Alert muted: ${id}`,
		provider: normalizeProvider(saved.billing.provider),
		severity: 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before: { id },
		after: { id, status: 'muted', muteUntil },
	});
	return {
		items: normalizeMonitoringPolicy(saved.billing.monitoring || next).alerts.items,
		updatedAt: saved.updatedAt,
	};
}

export async function getMonitoringDiagnostics() {
	const core = await composeStatusCore();
	let idempotencyCount = null;
	try {
		const result = await pocketbaseClient.collection('billing_idempotency').getList(1, 1, { requestKey: null });
		idempotencyCount = result.totalItems ?? null;
	} catch {
		idempotencyCount = null;
	}

	return {
		activeProvider: core.activeProvider,
		checkoutEnabled: core.checkoutEnabled,
		failoverMode: core.failoverMode,
		autoFailoverEnabled: core.autoFailoverEnabled,
		preferredPrimary: core.preferredPrimary,
		healthScore: core.healthScore,
		overallStatus: core.overallStatus,
		lastHealthCheckAt: core.lastHealthCheckAt,
		providersConfigured: core.healthItems.filter((i) => i.connected).length,
		providersTotal: core.healthItems.length,
		openAlerts: core.openAlerts,
		idempotencyRecords: idempotencyCount,
		singleWriteAuthority: {
			monitoringOwned: true,
			failoverOwned: true,
			providersOwned: true,
		},
		notes: [
			'Monitoring is observation-only.',
			'Monitoring snapshot is an optional read-only optimization, never a source of truth.',
			'Webhook runtime is not redesigned; idempotency count is diagnostics-only when available.',
		],
		updatedAt: core.updatedAt,
	};
}

export async function getMonitoringPolicy(adminUser = null) {
	const { billing, updatedAt } = await getRawBillingPayload();
	return {
		policy: normalizeMonitoringPolicy(billing.monitoring || {}),
		updatedAt,
		severities: ALERT_SEVERITIES,
		codes: ALERT_CODES,
		permissions: adminUser ? getBillingPermissions(adminUser) : undefined,
	};
}

export async function updateMonitoringPolicy(body = {}, actor = {}, requestMeta = {}) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const current = normalizeMonitoringPolicy(billing.monitoring || {});
	const patch = body.policy && typeof body.policy === 'object' ? body.policy : body;
	const next = normalizeMonitoringPolicy({
		...current,
		...patch,
		windows: { ...current.windows, ...(patch.windows || {}) },
		thresholds: { ...current.thresholds, ...(patch.thresholds || {}) },
		alerts: { items: current.alerts.items },
		policyVersion: current.policyVersion,
	});
	const clientStamp = body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || null;
	if (clientStamp && updatedAt && String(clientStamp) !== String(updatedAt)) {
		throw httpError(409, 'Billing configuration changed. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
	}
	const saved = await persistMonitoring(next, actor, {
		expectedUpdatedAt: clientStamp || updatedAt,
		billingBase: billing,
	});
	await writeControlPlaneAudit({
		action: 'billing.monitoring.policy_updated',
		message: 'Monitoring policy updated',
		provider: normalizeProvider(saved.billing.provider),
		severity: 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before: { pollHintSeconds: current.pollHintSeconds },
		after: { pollHintSeconds: next.pollHintSeconds, windows: next.windows },
	});
	return {
		policy: normalizeMonitoringPolicy(saved.billing.monitoring || next),
		updatedAt: saved.updatedAt,
	};
}
