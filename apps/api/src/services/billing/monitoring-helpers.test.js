import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ALERT_SEVERITIES,
	buildHealthRollup,
	calculateMonitoringHealthScore,
	deriveOverallStatus,
	evaluateMonitoringAlerts,
	normalizeMonitoringPolicy,
} from './monitoring-helpers.js';

test('alert severities are only INFO WARNING CRITICAL', () => {
	assert.deepEqual([...ALERT_SEVERITIES], ['INFO', 'WARNING', 'CRITICAL']);
});

test('normalizeMonitoringPolicy uses policyVersion and safe defaults', () => {
	const policy = normalizeMonitoringPolicy({});
	assert.equal(policy.policyVersion, 1);
	assert.equal(policy.pollHintSeconds, 30);
	assert.equal(policy.windows.metricsHours, 24);
});

test('calculateMonitoringHealthScore is 100 when healthy', () => {
	const score = calculateMonitoringHealthScore({
		activeProvider: 'stripe',
		activeHealthStatus: 'Healthy',
		activeValidationResult: 'PASS',
		openAlerts: [],
		failoverMode: 'automatic',
		autoFailoverEnabled: true,
	});
	assert.equal(score, 100);
});

test('calculateMonitoringHealthScore drops for critical active provider', () => {
	const score = calculateMonitoringHealthScore({
		activeProvider: 'stripe',
		activeHealthStatus: 'Critical',
		activeValidationResult: 'FAIL',
		openAlerts: [{ severity: 'CRITICAL', status: 'open' }],
		failoverMode: 'automatic',
	});
	assert.ok(score <= 40);
	assert.ok(score >= 0);
});

test('calculateMonitoringHealthScore offline approaches floor', () => {
	const score = calculateMonitoringHealthScore({
		activeProvider: 'stripe',
		activeHealthStatus: 'Offline',
		activeValidationResult: 'FAIL',
		openAlerts: [
			{ severity: 'CRITICAL', status: 'open' },
			{ severity: 'CRITICAL', status: 'open' },
		],
		recentNoEligible: true,
		failoverBurst: true,
	});
	assert.equal(score, 0);
});

test('evaluateMonitoringAlerts assigns fixed severities', () => {
	const alerts = evaluateMonitoringAlerts({
		activeProvider: 'stripe',
		activeHealthStatus: 'Critical',
		activeValidationResult: 'PASS',
		checkoutEnabled: false,
	});
	assert.ok(alerts.some((a) => a.code === 'ACTIVE_PROVIDER_CRITICAL' && a.severity === 'CRITICAL'));
});

test('deriveOverallStatus and health rollup', () => {
	assert.equal(deriveOverallStatus({
		openAlerts: [{ severity: 'CRITICAL', status: 'open' }],
		activeProvider: 'stripe',
		activeHealthStatus: 'Healthy',
	}), 'Critical');
	assert.deepEqual(buildHealthRollup([
		{ status: 'Healthy' },
		{ status: 'Critical' },
		{ status: 'Unknown' },
	]), { healthy: 1, warning: 0, critical: 1, offline: 0, unknown: 1 });
});
