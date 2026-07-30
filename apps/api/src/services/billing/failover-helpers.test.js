import test from 'node:test';
import assert from 'node:assert/strict';
import {
	FAILOVER_REASON_CODES,
	appendRecentEvent,
	buildSimulationResult,
	decideFailover,
	decideRecovery,
	decisionFingerprint,
	defaultFailoverPolicy,
	isCooldownActive,
	normalizeFailoverPolicy,
} from './failover-helpers.js';

function views(overrides = {}) {
	return {
		stripe: {
			code: 'stripe',
			enabled: true,
			implemented: true,
			healthStatus: 'Healthy',
			validationResult: 'PASS',
			...(overrides.stripe || {}),
		},
		lemonsqueezy: {
			code: 'lemonsqueezy',
			enabled: true,
			implemented: true,
			healthStatus: 'Healthy',
			validationResult: 'PASS',
			...(overrides.lemonsqueezy || {}),
		},
		paddle: {
			code: 'paddle',
			enabled: true,
			implemented: true,
			healthStatus: 'Healthy',
			validationResult: 'PASS',
			...(overrides.paddle || {}),
		},
	};
}

test('reason codes are exactly the certified fixed set', () => {
	assert.deepEqual([...FAILOVER_REASON_CODES], [
		'PROVIDER_OFFLINE',
		'PROVIDER_CRITICAL',
		'VALIDATION_FAILED',
		'PROVIDER_DISABLED',
		'MANUAL_OVERRIDE',
		'RECOVERY_COMPLETED',
		'NO_ELIGIBLE_PROVIDER',
		'COOLDOWN_ACTIVE',
	]);
});

test('normalizeFailoverPolicy uses policyVersion and safe defaults', () => {
	const policy = normalizeFailoverPolicy({});
	assert.equal(policy.policyVersion, 1);
	assert.equal(policy.autoFailoverEnabled, false);
	assert.equal(policy.recovery.mode, 'manual');
	assert.deepEqual(policy.priority, ['stripe', 'lemonsqueezy', 'paddle']);
});

test('decideFailover prefers next eligible by priority when active is Critical', () => {
	const policy = normalizeFailoverPolicy({
		...defaultFailoverPolicy(),
		autoFailoverEnabled: true,
		priority: ['stripe', 'lemonsqueezy', 'paddle'],
	});
	const decision = decideFailover({
		activeProvider: 'stripe',
		viewsByCode: views({ stripe: { healthStatus: 'Critical' } }),
		policy,
	});
	assert.equal(decision.predictedAction, 'failover');
	assert.equal(decision.reasonCode, 'PROVIDER_CRITICAL');
	assert.equal(decision.selectedCandidate, 'lemonsqueezy');
	assert.equal(decision.blockingReason, null);
});

test('decideFailover returns NO_ELIGIBLE_PROVIDER when all backups fail gates', () => {
	const policy = normalizeFailoverPolicy({
		autoFailoverEnabled: true,
		priority: ['stripe', 'lemonsqueezy', 'paddle'],
	});
	const decision = decideFailover({
		activeProvider: 'stripe',
		viewsByCode: views({
			stripe: { healthStatus: 'Offline' },
			lemonsqueezy: { enabled: false },
			paddle: { validationResult: 'FAIL' },
		}),
		policy,
	});
	assert.equal(decision.predictedAction, 'blocked');
	assert.equal(decision.reasonCode, 'NO_ELIGIBLE_PROVIDER');
});

test('decideFailover respects MANUAL_OVERRIDE when auto disabled', () => {
	const decision = decideFailover({
		activeProvider: 'stripe',
		viewsByCode: views({ stripe: { healthStatus: 'Critical' } }),
		policy: normalizeFailoverPolicy({ autoFailoverEnabled: false }),
	});
	assert.equal(decision.predictedAction, 'noop');
	assert.equal(decision.reasonCode, 'MANUAL_OVERRIDE');
});

test('cooldown suppresses duplicate failover fingerprint', () => {
	const base = normalizeFailoverPolicy({
		autoFailoverEnabled: true,
		cooldownSeconds: 300,
	});
	const first = decideFailover({
		activeProvider: 'stripe',
		viewsByCode: views({ stripe: { healthStatus: 'Offline' } }),
		policy: base,
	});
	const policy = appendRecentEvent(base, {
		...first,
		reasonCode: first.reasonCode,
		applied: true,
		fingerprint: first.fingerprint,
	});
	const second = decideFailover({
		activeProvider: 'stripe',
		viewsByCode: views({ stripe: { healthStatus: 'Offline' } }),
		policy,
		now: Date.now(),
	});
	assert.equal(second.reasonCode, 'COOLDOWN_ACTIVE');
	assert.equal(isCooldownActive(policy, first.fingerprint), true);
});

test('decideRecovery returns RECOVERY_COMPLETED when preferred is Healthy', () => {
	const policy = normalizeFailoverPolicy({
		preferredPrimary: 'stripe',
		recovery: { mode: 'manual', autoRestorePreferred: false, requireHealthyPrimary: true },
	});
	const decision = decideRecovery({
		activeProvider: 'lemonsqueezy',
		viewsByCode: views(),
		policy,
		explicit: true,
	});
	assert.equal(decision.predictedAction, 'recovery');
	assert.equal(decision.reasonCode, 'RECOVERY_COMPLETED');
	assert.equal(decision.to, 'stripe');
});

test('buildSimulationResult never implies writes', () => {
	const decision = decideFailover({
		activeProvider: 'stripe',
		viewsByCode: views({ stripe: { healthStatus: 'Critical' } }),
		policy: normalizeFailoverPolicy({ autoFailoverEnabled: true }),
	});
	const sim = buildSimulationResult(decision, 'stripe');
	assert.equal(sim.simulation, true);
	assert.equal(sim.currentProvider, 'stripe');
	assert.ok(Array.isArray(sim.eligibleProviders));
	assert.equal(sim.selectedCandidate, decision.selectedCandidate);
	assert.equal(sim.predictedAction, decision.predictedAction);
});

test('decisionFingerprint is stable', () => {
	assert.equal(
		decisionFingerprint({ type: 'failover', from: 'stripe', to: 'paddle', reasonCode: 'PROVIDER_CRITICAL' }),
		'failover:stripe:paddle:PROVIDER_CRITICAL',
	);
});
