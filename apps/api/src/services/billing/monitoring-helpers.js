/**
 * Pure Billing Monitoring helpers (BP-5). No PocketBase side effects.
 */

export const ALERT_SEVERITIES = Object.freeze(['INFO', 'WARNING', 'CRITICAL']);

export const ALERT_CODES = Object.freeze([
	'ACTIVE_PROVIDER_CRITICAL',
	'ACTIVE_PROVIDER_OFFLINE',
	'ACTIVE_VALIDATION_FAILED',
	'FAILOVER_BURST',
	'NO_ELIGIBLE_FAILOVER',
	'AUTO_FAILOVER_DISABLED_UNHEALTHY',
	'CHECKOUT_ENABLED_PROVIDER_NONE',
]);

const ALERT_SEVERITY_BY_CODE = Object.freeze({
	ACTIVE_PROVIDER_CRITICAL: 'CRITICAL',
	ACTIVE_PROVIDER_OFFLINE: 'CRITICAL',
	ACTIVE_VALIDATION_FAILED: 'CRITICAL',
	FAILOVER_BURST: 'WARNING',
	NO_ELIGIBLE_FAILOVER: 'CRITICAL',
	AUTO_FAILOVER_DISABLED_UNHEALTHY: 'WARNING',
	CHECKOUT_ENABLED_PROVIDER_NONE: 'WARNING',
});

export function isAlertSeverity(value) {
	return ALERT_SEVERITIES.includes(String(value || '').toUpperCase());
}

export function defaultMonitoringPolicy() {
	return {
		policyVersion: 1,
		pollHintSeconds: 30,
		windows: {
			metricsHours: 24,
			trendsDays: 30,
			timelineLimit: 100,
			eventsPageMax: 100,
		},
		thresholds: {
			criticalProvidersMin: 1,
			failoverBurstCount: 3,
			failoverBurstMinutes: 60,
			validationFailStreak: 2,
		},
		alerts: {
			items: [],
		},
	};
}

export function normalizeMonitoringPolicy(raw = {}) {
	const defaults = defaultMonitoringPolicy();
	const windows = raw.windows && typeof raw.windows === 'object' ? raw.windows : {};
	const thresholds = raw.thresholds && typeof raw.thresholds === 'object' ? raw.thresholds : {};
	const alerts = raw.alerts && typeof raw.alerts === 'object' ? raw.alerts : {};
	const items = Array.isArray(alerts.items) ? alerts.items : [];

	return {
		policyVersion: Math.max(1, Number(raw.policyVersion) || defaults.policyVersion),
		pollHintSeconds: Math.max(5, Math.min(300, Number(raw.pollHintSeconds) || defaults.pollHintSeconds)),
		windows: {
			metricsHours: Math.max(1, Math.min(168, Number(windows.metricsHours) || defaults.windows.metricsHours)),
			trendsDays: Math.max(1, Math.min(90, Number(windows.trendsDays) || defaults.windows.trendsDays)),
			timelineLimit: Math.max(10, Math.min(200, Number(windows.timelineLimit) || defaults.windows.timelineLimit)),
			eventsPageMax: Math.max(10, Math.min(100, Number(windows.eventsPageMax) || defaults.windows.eventsPageMax)),
		},
		thresholds: {
			criticalProvidersMin: Math.max(0, Number(thresholds.criticalProvidersMin) ?? defaults.thresholds.criticalProvidersMin),
			failoverBurstCount: Math.max(1, Number(thresholds.failoverBurstCount) || defaults.thresholds.failoverBurstCount),
			failoverBurstMinutes: Math.max(1, Number(thresholds.failoverBurstMinutes) || defaults.thresholds.failoverBurstMinutes),
			validationFailStreak: Math.max(1, Number(thresholds.validationFailStreak) || defaults.thresholds.validationFailStreak),
		},
		alerts: {
			items: items.slice(0, 200).map(normalizeStoredAlert).filter(Boolean),
		},
	};
}

function normalizeStoredAlert(row) {
	if (!row || typeof row !== 'object') return null;
	const code = String(row.code || '');
	if (!ALERT_CODES.includes(code)) return null;
	const severity = ALERT_SEVERITY_BY_CODE[code];
	const status = ['open', 'acknowledged', 'resolved', 'muted'].includes(row.status)
		? row.status
		: 'open';
	return {
		id: String(row.id || `${code}:${row.provider || 'platform'}`).slice(0, 120),
		code,
		severity,
		status,
		provider: row.provider ? String(row.provider).slice(0, 40) : null,
		message: String(row.message || '').slice(0, 500),
		fingerprint: String(row.fingerprint || code).slice(0, 180),
		openedAt: row.openedAt || null,
		acknowledgedAt: row.acknowledgedAt || null,
		resolvedAt: row.resolvedAt || null,
		muteUntil: row.muteUntil || null,
	};
}

export function buildHealthRollup(providerCards = []) {
	const rollup = { healthy: 0, warning: 0, critical: 0, offline: 0, unknown: 0 };
	for (const card of providerCards) {
		const status = String(card.status || card.healthStatus || 'Unknown');
		if (status === 'Healthy') rollup.healthy += 1;
		else if (status === 'Warning') rollup.warning += 1;
		else if (status === 'Critical') rollup.critical += 1;
		else if (status === 'Offline') rollup.offline += 1;
		else rollup.unknown += 1;
	}
	return rollup;
}

/**
 * Deterministic Monitoring Health Score 0–100.
 * Inputs: provider health, active alerts, failover state, validation status.
 */
export function calculateMonitoringHealthScore({
	activeProvider = 'none',
	activeHealthStatus = 'Unknown',
	activeValidationResult = 'FAIL',
	openAlerts = [],
	failoverMode = 'automatic',
	preferredPrimary = null,
	autoFailoverEnabled = false,
	recentNoEligible = false,
	failoverBurst = false,
} = {}) {
	let score = 100;

	// Provider Health (active)
	const health = String(activeHealthStatus || 'Unknown');
	if (activeProvider === 'none') score -= 50;
	else if (health === 'Healthy') score -= 0;
	else if (health === 'Warning') score -= 25;
	else if (health === 'Critical') score -= 50;
	else if (health === 'Offline') score -= 80;
	else score -= 40; // Unknown

	// Validation Status (active)
	const validation = String(activeValidationResult || '').toUpperCase();
	if (validation === 'FAIL') score -= 40;
	else if (validation === 'WARNING') score -= 15;

	// Active Alerts
	for (const alert of openAlerts) {
		const sev = String(alert.severity || '').toUpperCase();
		if (sev === 'CRITICAL') score -= 20;
		else if (sev === 'WARNING') score -= 10;
		// INFO: no score penalty
	}

	// Failover State
	if (failoverMode === 'manual_force' && preferredPrimary && preferredPrimary !== activeProvider) {
		score -= 10;
	}
	if (recentNoEligible) score -= 25;
	if (failoverBurst) score -= 15;
	if (!autoFailoverEnabled && (health === 'Critical' || health === 'Offline')) {
		score -= 5;
	}

	return Math.max(0, Math.min(100, Math.round(score)));
}

export function deriveOverallStatus({
	openAlerts = [],
	activeProvider = 'none',
	activeHealthStatus = 'Unknown',
	healthRollup = {},
} = {}) {
	const hasCriticalAlert = openAlerts.some((a) => String(a.severity).toUpperCase() === 'CRITICAL' && a.status === 'open');
	if (hasCriticalAlert) return 'Critical';

	const activeHealth = String(activeHealthStatus || 'Unknown');
	if (activeProvider !== 'none' && (activeHealth === 'Critical' || activeHealth === 'Offline')) {
		return 'Critical';
	}

	const hasWarningAlert = openAlerts.some((a) => String(a.severity).toUpperCase() === 'WARNING' && a.status === 'open');
	if (hasWarningAlert || activeHealth === 'Warning' || (healthRollup.warning || 0) > 0) {
		return 'Degraded';
	}

	if (activeProvider !== 'none' && activeHealth === 'Healthy' && (healthRollup.critical || 0) === 0) {
		return 'Healthy';
	}

	return 'Unknown';
}

export function alertSeverityForCode(code) {
	return ALERT_SEVERITY_BY_CODE[code] || null;
}

/**
 * Evaluate alerts from live signals. Merges with stored ack/mute state.
 */
export function evaluateMonitoringAlerts({
	activeProvider = 'none',
	checkoutEnabled = false,
	activeHealthStatus = 'Unknown',
	activeValidationResult = 'PASS',
	autoFailoverEnabled = false,
	failoverBurst = false,
	recentNoEligible = false,
	storedItems = [],
	now = Date.now(),
} = {}) {
	const candidates = [];

	if (activeProvider !== 'none' && activeHealthStatus === 'Critical') {
		candidates.push(makeCandidate('ACTIVE_PROVIDER_CRITICAL', activeProvider, `Active provider ${activeProvider} is Critical`));
	}
	if (activeProvider !== 'none' && activeHealthStatus === 'Offline') {
		candidates.push(makeCandidate('ACTIVE_PROVIDER_OFFLINE', activeProvider, `Active provider ${activeProvider} is Offline`));
	}
	if (activeProvider !== 'none' && String(activeValidationResult).toUpperCase() === 'FAIL') {
		candidates.push(makeCandidate('ACTIVE_VALIDATION_FAILED', activeProvider, `Active provider ${activeProvider} validation FAIL`));
	}
	if (failoverBurst) {
		candidates.push(makeCandidate('FAILOVER_BURST', activeProvider || 'platform', 'Failover burst threshold exceeded'));
	}
	if (recentNoEligible) {
		candidates.push(makeCandidate('NO_ELIGIBLE_FAILOVER', activeProvider || 'platform', 'No eligible failover provider'));
	}
	if (
		activeProvider !== 'none'
		&& !autoFailoverEnabled
		&& (activeHealthStatus === 'Critical' || activeHealthStatus === 'Offline' || activeHealthStatus === 'Warning')
	) {
		candidates.push(makeCandidate(
			'AUTO_FAILOVER_DISABLED_UNHEALTHY',
			activeProvider,
			'Auto failover disabled while active provider is unhealthy',
		));
	}
	if (checkoutEnabled && (activeProvider === 'none' || !activeProvider)) {
		candidates.push(makeCandidate('CHECKOUT_ENABLED_PROVIDER_NONE', 'platform', 'Checkout enabled with no active provider'));
	}

	const storedById = new Map((storedItems || []).map((item) => [item.id, item]));
	const nowIso = new Date(now).toISOString();
	const result = [];

	for (const candidate of candidates) {
		const prev = storedById.get(candidate.id);
		const muted = prev?.status === 'muted' && prev.muteUntil && new Date(prev.muteUntil).getTime() > now;
		if (muted) {
			result.push({ ...prev, ...candidate, status: 'muted', severity: candidate.severity });
			continue;
		}
		if (prev?.status === 'acknowledged') {
			result.push({
				...candidate,
				status: 'acknowledged',
				openedAt: prev.openedAt || nowIso,
				acknowledgedAt: prev.acknowledgedAt || nowIso,
			});
			continue;
		}
		result.push({
			...candidate,
			status: 'open',
			openedAt: prev?.openedAt || nowIso,
			acknowledgedAt: null,
			resolvedAt: null,
			muteUntil: null,
		});
	}

	// Preserve resolved history lightly for codes no longer firing
	for (const prev of storedItems || []) {
		if (result.some((row) => row.id === prev.id)) continue;
		if (prev.status === 'open' || prev.status === 'acknowledged') {
			result.push({
				...prev,
				status: 'resolved',
				resolvedAt: nowIso,
				severity: alertSeverityForCode(prev.code) || prev.severity,
			});
		}
	}

	return result;
}

function makeCandidate(code, provider, message) {
	const severity = ALERT_SEVERITY_BY_CODE[code];
	const id = `${code}:${provider || 'platform'}`;
	return {
		id,
		code,
		severity,
		provider: provider || null,
		message,
		fingerprint: id,
	};
}

export function countOpenAlerts(alerts = []) {
	return alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged').length;
}
