import test from 'node:test';
import assert from 'node:assert/strict';
import {
	DR_MANIFEST_VERSION,
	DR_POLICY_VERSION,
	DR_REASON_CODES,
	applyBackupPayloadToBilling,
	buildSimulationResult,
	composeReadinessStatus,
	createBackupRecord,
	hashPayload,
	isRestoreCooldownActive,
	normalizeDisasterRecovery,
	sanitizeBackupForPublic,
	trimBackups,
	verifyBackupCompatibility,
	verifyBackupIntegrity,
	verifyLiveState,
} from './disaster-recovery-helpers.js';
import {
	__resetDisasterRecoveryWriteLockForTests,
	withDisasterRecoveryWriteLock,
} from './disaster-recovery-lock.js';

function sampleBilling(overrides = {}) {
	return {
		provider: 'stripe',
		checkoutEnabled: false,
		webhookPath: '/billing/webhooks',
		providers: {
			stripe: {
				enabled: true,
				mode: 'test',
				secretKeyCipher: 'enc:v1:abc',
				secretKeySet: true,
				webhookSecretSet: false,
			},
			paddle: { enabled: true, mode: 'test' },
			lemonsqueezy: { enabled: true, mode: 'test' },
			paypal: { enabled: false, mode: 'test' },
		},
		failover: { policyVersion: 1, autoFailoverEnabled: false },
		priceMappings: { version: 1, plans: {}, packs: {}, meta: {} },
		monitoring: { policyVersion: 1, alerts: { items: [] } },
		...overrides,
	};
}

test('DR reason codes are fixed enum', () => {
	assert.ok(DR_REASON_CODES.includes('UNSUPPORTED_MANIFEST_VERSION'));
	assert.ok(DR_REASON_CODES.includes('ENVIRONMENT_INCOMPATIBLE'));
	assert.ok(DR_REASON_CODES.includes('OK'));
});

test('normalizeDisasterRecovery uses policyVersion and safe defaults', () => {
	const dr = normalizeDisasterRecovery({});
	assert.equal(dr.policyVersion, DR_POLICY_VERSION);
	assert.equal(dr.maxBackups, 20);
	assert.deepEqual(dr.backups, []);
	assert.equal(dr.checkpoints.preRestore, null);
});

test('createBackupRecord stamps policyVersion and manifestVersion', () => {
	const created = createBackupRecord({ billing: sampleBilling(), actor: { email: 'a@b.c' }, label: 'manual' });
	assert.equal(created.ok, true);
	assert.equal(created.backup.manifest.policyVersion, DR_POLICY_VERSION);
	assert.equal(created.backup.manifest.manifestVersion, DR_MANIFEST_VERSION);
	assert.equal(created.backup.manifest.includesCiphertext, true);
	assert.equal(created.backup.integrity.algo, 'sha256');
	assert.equal(created.backup.integrity.hash, hashPayload(created.backup.payload));
});

test('createBackupRecord rejects plaintext secrets', () => {
	const billing = sampleBilling({
		providers: {
			stripe: {
				enabled: true,
				mode: 'test',
				secretKey: 'sk_test_plaintext',
			},
		},
	});
	const created = createBackupRecord({ billing });
	assert.equal(created.ok, false);
	assert.equal(created.reasonCode, 'PLAINTEXT_SECRET_FORBIDDEN');
});

test('verifyBackupIntegrity detects tamper', () => {
	const created = createBackupRecord({ billing: sampleBilling() });
	const backup = created.backup;
	backup.payload.provider = 'paddle';
	const result = verifyBackupIntegrity(backup);
	assert.equal(result.ok, false);
	assert.equal(result.reasonCode, 'INTEGRITY_MISMATCH');
});

test('verifyBackupCompatibility rejects unsupported manifestVersion', () => {
	const created = createBackupRecord({ billing: sampleBilling() });
	const backup = created.backup;
	backup.manifest.manifestVersion = 99;
	backup.integrity.hash = hashPayload(backup.payload);
	const result = verifyBackupCompatibility(backup, sampleBilling());
	assert.equal(result.ok, false);
	assert.equal(result.reasonCode, 'UNSUPPORTED_MANIFEST_VERSION');
});

test('verifyBackupCompatibility rejects unsupported policyVersion', () => {
	const created = createBackupRecord({ billing: sampleBilling() });
	const backup = created.backup;
	backup.manifest.policyVersion = 99;
	backup.integrity.hash = hashPayload(backup.payload);
	const result = verifyBackupCompatibility(backup, sampleBilling());
	assert.equal(result.ok, false);
	assert.equal(result.reasonCode, 'UNSUPPORTED_POLICY_VERSION');
});

test('verifyBackupCompatibility rejects environment mismatch', () => {
	const created = createBackupRecord({ billing: sampleBilling() });
	const live = sampleBilling({
		providers: {
			...sampleBilling().providers,
			stripe: { ...sampleBilling().providers.stripe, mode: 'live' },
		},
	});
	const result = verifyBackupCompatibility(created.backup, live);
	assert.equal(result.ok, false);
	assert.equal(result.reasonCode, 'ENVIRONMENT_INCOMPATIBLE');
});

test('simulation is blocked on incompatibility and never implies writes', () => {
	const created = createBackupRecord({ billing: sampleBilling() });
	const backup = created.backup;
	backup.manifest.manifestVersion = 2;
	backup.integrity.hash = hashPayload(backup.payload);
	const simulation = buildSimulationResult({
		backup,
		liveBilling: sampleBilling(),
	});
	assert.equal(simulation.simulation, true);
	assert.equal(simulation.predictedAction, 'blocked');
	assert.equal(simulation.blockingReason, 'UNSUPPORTED_MANIFEST_VERSION');
});

test('applyBackupPayloadToBilling restores owned keys only', () => {
	const live = sampleBilling({ provider: 'paddle', disasterRecovery: { backups: [{ id: 'keep' }] } });
	const created = createBackupRecord({ billing: sampleBilling({ provider: 'stripe' }) });
	const next = applyBackupPayloadToBilling(live, created.backup.payload);
	assert.equal(next.provider, 'stripe');
	assert.equal(next.disasterRecovery.backups[0].id, 'keep');
});

test('sanitizeBackupForPublic redacts ciphertext', () => {
	const created = createBackupRecord({ billing: sampleBilling() });
	const publicBackup = sanitizeBackupForPublic(created.backup);
	assert.equal(publicBackup.payload.providers.stripe.secretKeyCipher, undefined);
	assert.equal(publicBackup.payload.providers.stripe.secretKeySet, true);
	assert.equal(publicBackup.payloadRedacted, true);
});

test('trimBackups respects maxBackups FIFO by recency', () => {
	const items = [
		{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
		{ id: 'b', createdAt: '2026-01-03T00:00:00.000Z' },
		{ id: 'c', createdAt: '2026-01-02T00:00:00.000Z' },
	];
	const trimmed = trimBackups(items, 2);
	assert.equal(trimmed.length, 2);
	assert.equal(trimmed[0].id, 'b');
	assert.equal(trimmed[1].id, 'c');
});

test('verifyLiveState flags checkout incoherent', () => {
	const state = verifyLiveState(sampleBilling({ checkoutEnabled: true, provider: 'none' }));
	assert.equal(state.ok, false);
	assert.equal(state.reasonCode, 'CHECKOUT_INCOHERENT');
});

test('composeReadinessStatus Unknown without backups', () => {
	const readiness = composeReadinessStatus({
		archive: normalizeDisasterRecovery({}),
		liveBilling: sampleBilling(),
	});
	assert.equal(readiness.status, 'Unknown');
});

test('composeReadinessStatus Ready with valid backup', () => {
	const created = createBackupRecord({ billing: sampleBilling() });
	const readiness = composeReadinessStatus({
		archive: normalizeDisasterRecovery({ backups: [created.backup] }),
		liveBilling: sampleBilling(),
		activeValidationResult: 'PASS',
		openCriticalAlerts: 0,
	});
	assert.equal(readiness.status, 'Ready');
});

test('isRestoreCooldownActive respects lastRestore', () => {
	const archive = normalizeDisasterRecovery({
		cooldownSeconds: 300,
		lastRestore: { at: new Date().toISOString(), applied: true, reasonCode: 'OK' },
	});
	assert.equal(isRestoreCooldownActive(archive), true);
	assert.equal(isRestoreCooldownActive({
		...archive,
		lastRestore: { at: '2020-01-01T00:00:00.000Z', applied: true },
	}), false);
});

test('single-flight serializes DR write lock', async () => {
	__resetDisasterRecoveryWriteLockForTests();
	const order = [];
	await Promise.all([
		withDisasterRecoveryWriteLock(async () => {
			order.push('a-start');
			await new Promise((r) => setTimeout(r, 30));
			order.push('a-end');
		}),
		withDisasterRecoveryWriteLock(async () => {
			order.push('b-start');
			order.push('b-end');
		}),
	]);
	assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});
