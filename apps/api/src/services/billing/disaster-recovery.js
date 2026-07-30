/**
 * Disaster Recovery Engine (BP-6).
 * Backup / restore / rollback of Billing Control Plane configuration only.
 * Atomic restore: all-or-nothing. Never migrates subscriptions or rewrites billing history.
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import {
	assertBillingPermission,
	BILLING_PERMISSIONS,
	getBillingPermissions,
} from '../../middleware/billing-permissions.js';
import {
	getRawBillingPayload,
	invalidateBillingRequestCache,
	writeControlPlaneAudit,
} from './control-plane.js';
import { validateProvider } from './validation-engine.js';
import { normalizeFailoverPolicy } from './failover-helpers.js';
import { normalizeMonitoringPolicy } from './monitoring-helpers.js';
import {
	DR_MANIFEST_VERSION,
	DR_POLICY_VERSION,
	DR_REASON_CODES,
	appendRestoreHistory,
	applyBackupPayloadToBilling,
	buildSimulationResult,
	composeReadinessStatus,
	createBackupRecord,
	defaultDisasterRecovery,
	findBackup,
	isRestoreCooldownActive,
	normalizeDisasterRecovery,
	sanitizeBackupForPublic,
	sanitizeDisasterRecoveryForPublic,
	trimBackups,
	verifyBackupCompatibility,
	verifyBackupIntegrity,
	verifyLiveState,
} from './disaster-recovery-helpers.js';
import { withDisasterRecoveryWriteLock } from './disaster-recovery-lock.js';

export {
	DR_REASON_CODES,
	DR_POLICY_VERSION,
	DR_MANIFEST_VERSION,
	normalizeDisasterRecovery,
	defaultDisasterRecovery,
	verifyBackupIntegrity,
	verifyBackupCompatibility,
	buildSimulationResult,
} from './disaster-recovery-helpers.js';

export { withDisasterRecoveryWriteLock } from './disaster-recovery-lock.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

async function getSettingsRow() {
	return pocketbaseClient.collection('platform_settings').getFirstListItem(
		pocketbaseClient.filter('config_key = {:key}', { key: 'platform' }),
		{ requestKey: null },
	).catch(() => null);
}

/**
 * Atomic SWA persist of full billing payload with OCC.
 */
async function persistBilling(nextBilling, actor = {}, { expectedUpdatedAt = null, requireOptimistic = true } = {}) {
	const row = await getSettingsRow();
	if (!row) throw httpError(500, 'Platform settings are not initialized.', 'SETTINGS_MISSING');
	if (requireOptimistic && !expectedUpdatedAt) {
		throw httpError(409, 'Billing configuration stamp required. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
	}
	if (expectedUpdatedAt && row.updated && String(row.updated) !== String(expectedUpdatedAt)) {
		throw httpError(409, 'Billing configuration changed. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
	}

	const payload = structuredClone(row.payload || {});
	payload.billing = nextBilling;

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
	const { bumpWorkspaceConfigVersion } = await import('../workspace-config-bus.js');
	bumpWorkspaceConfigVersion('platform_settings');
	return {
		billing: saved.payload?.billing || nextBilling,
		updatedAt: saved.updated,
	};
}

async function loadFreshBilling() {
	invalidateBillingRequestCache();
	return getRawBillingPayload();
}

function getArchive(billing = {}) {
	return normalizeDisasterRecovery(billing.disasterRecovery || {});
}

function validationPreviewForBilling(billing = {}) {
	const active = String(billing.provider || 'none').trim().toLowerCase() || 'none';
	if (active === 'none') {
		return { provider: 'none', result: 'PASS', diagnostics: [] };
	}
	const raw = billing.providers?.[active] || {};
	const validation = validateProvider(active, raw, billing);
	return {
		provider: active,
		result: validation.result,
		diagnostics: (validation.diagnostics || []).slice(0, 10).map((d) => ({
			code: d.code,
			severity: d.severity,
			message: d.message,
		})),
	};
}

function assertSecretsWriteIfNeeded(actorUser, backup) {
	if (!backup?.manifest?.includesCiphertext) return;
	assertBillingPermission(actorUser, BILLING_PERMISSIONS.SECRETS_WRITE);
}

function openCriticalFromBilling(billing = {}) {
	const monitoring = normalizeMonitoringPolicy(billing.monitoring || {});
	const items = monitoring.alerts?.items || [];
	return items.filter((a) => (
		a?.severity === 'CRITICAL'
		&& (a.status === 'open' || a.status === 'acknowledged')
	)).length;
}

/* ── Public API ─────────────────────────────────────────────────── */

export async function getDisasterRecoveryReadiness(adminUser = null) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const archive = getArchive(billing);
	const preview = validationPreviewForBilling(billing);
	const readiness = composeReadinessStatus({
		archive,
		liveBilling: billing,
		activeValidationResult: preview.result,
		openCriticalAlerts: openCriticalFromBilling(billing),
	});
	return {
		...readiness,
		activeProvider: String(billing.provider || 'none'),
		checkoutEnabled: Boolean(billing.checkoutEnabled),
		updatedAt,
		permissions: getBillingPermissions(adminUser),
		disasterRecovery: sanitizeDisasterRecoveryForPublic(archive),
	};
}

export async function listDisasterRecoveryBackups(adminUser = null, { limit = 50 } = {}) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const archive = getArchive(billing);
	const items = archive.backups
		.slice(0, Math.min(100, Math.max(1, Number(limit) || 50)))
		.map((b) => sanitizeBackupForPublic(b));
	return {
		items,
		total: archive.backups.length,
		maxBackups: archive.maxBackups,
		policyVersion: archive.policyVersion,
		updatedAt,
		permissions: getBillingPermissions(adminUser),
	};
}

export async function getDisasterRecoveryBackup(backupId, adminUser = null) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const archive = getArchive(billing);
	const backup = findBackup(archive, backupId);
	if (!backup) throw httpError(404, 'Backup not found.', 'BACKUP_NOT_FOUND');
	return {
		backup: sanitizeBackupForPublic(backup),
		updatedAt,
		permissions: getBillingPermissions(adminUser),
	};
}

export async function createDisasterRecoveryBackup(body = {}, actor = {}, requestMeta = {}) {
	return withDisasterRecoveryWriteLock(async () => {
		const { billing, updatedAt } = await loadFreshBilling();
		const expectedUpdatedAt = body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || updatedAt;
		const archive = getArchive(billing);
		const created = createBackupRecord({
			billing,
			actor,
			label: body.label || 'manual',
		});
		if (!created.ok) {
			throw httpError(400, created.reasonCode, created.reasonCode);
		}

		const nextArchive = {
			...archive,
			backups: trimBackups([created.backup, ...archive.backups], archive.maxBackups),
		};
		const nextBilling = { ...billing, disasterRecovery: nextArchive };
		const saved = await persistBilling(nextBilling, actor, {
			expectedUpdatedAt,
			requireOptimistic: true,
		});

		await writeControlPlaneAudit({
			action: 'billing.dr.backup_created',
			message: `Disaster recovery backup ${created.backup.id}`,
			provider: String(billing.provider || ''),
			actor,
			ip: requestMeta.ip,
			userAgent: requestMeta.userAgent,
			before: { backupCount: archive.backups.length },
			after: {
				backupId: created.backup.id,
				manifestVersion: created.backup.manifest.manifestVersion,
				policyVersion: created.backup.manifest.policyVersion,
				includesCiphertext: created.backup.manifest.includesCiphertext,
			},
		});

		return {
			backup: sanitizeBackupForPublic(created.backup),
			reasonCode: 'OK',
			updatedAt: saved.updatedAt,
		};
	});
}

export async function verifyDisasterRecoveryBackup(backupId, adminUser = null) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const archive = getArchive(billing);
	const backup = findBackup(archive, backupId);
	if (!backup) throw httpError(404, 'Backup not found.', 'BACKUP_NOT_FOUND');

	const integrity = verifyBackupIntegrity(backup);
	const compatibility = integrity.ok
		? verifyBackupCompatibility(backup, billing)
		: integrity;
	const state = verifyLiveState(billing, backup);

	return {
		backupId: backup.id,
		integrity,
		compatibility: {
			ok: compatibility.ok,
			reasonCode: compatibility.reasonCode,
			...(compatibility.compatibility || {}),
		},
		state,
		reasonCode: compatibility.ok ? 'OK' : compatibility.reasonCode,
		updatedAt,
		permissions: getBillingPermissions(adminUser),
	};
}

export async function simulateDisasterRecoveryRestore(body = {}, adminUser = null) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const archive = getArchive(billing);
	const backupId = body.backupId || body.id;
	const backup = findBackup(archive, backupId);
	if (!backup) throw httpError(404, 'Backup not found.', 'BACKUP_NOT_FOUND');

	const compatibility = verifyBackupCompatibility(backup, billing);
	const targetBilling = applyBackupPayloadToBilling(billing, backup.payload || {});
	const validationPreview = validationPreviewForBilling(targetBilling);
	const simulation = buildSimulationResult({
		backup,
		liveBilling: billing,
		compatibility,
		validationPreview,
	});

	if (
		simulation.predictedAction === 'restore'
		&& validationPreview.result === 'FAIL'
		&& String(targetBilling.provider || 'none') !== 'none'
	) {
		simulation.blockingReason = 'PROVIDER_VALIDATION_FAILED';
		simulation.predictedAction = 'blocked';
		simulation.reasonCode = 'PROVIDER_VALIDATION_FAILED';
	}

	return {
		...simulation,
		updatedAt,
		permissions: getBillingPermissions(adminUser),
	};
}

/**
 * Atomic restore: verify → checkpoint → single SWA write of full next billing.
 * On any verification failure: abort, live config unchanged, checkpoint preserved if already created
 * (checkpoint is only written in the same atomic persist as the apply — so failed verify never
 * creates a checkpoint; if OCC fails after staging, nothing is written).
 */
export async function restoreDisasterRecovery(body = {}, actor = {}, requestMeta = {}, actorUser = null) {
	return withDisasterRecoveryWriteLock(async () => {
		const { billing, updatedAt } = await loadFreshBilling();
		const expectedUpdatedAt = body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || updatedAt;
		const archive = getArchive(billing);
		const backupId = body.backupId || body.id;
		const backup = findBackup(archive, backupId);
		if (!backup) throw httpError(404, 'Backup not found.', 'BACKUP_NOT_FOUND');

		if (body.dryRun) {
			return {
				...(await simulateDisasterRecoveryRestore({ backupId }, actorUser)),
				applied: false,
				dryRun: true,
			};
		}

		assertSecretsWriteIfNeeded(actorUser || actor, backup);

		if (isRestoreCooldownActive(archive)) {
			return {
				applied: false,
				dryRun: false,
				backupId: backup.id,
				reasonCode: 'COOLDOWN_ACTIVE',
				blockingReason: 'COOLDOWN_ACTIVE',
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
			};
		}

		const integrity = verifyBackupIntegrity(backup);
		if (!integrity.ok) {
			return {
				applied: false,
				dryRun: false,
				backupId: backup.id,
				reasonCode: integrity.reasonCode,
				blockingReason: integrity.reasonCode,
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
			};
		}

		const compatibility = verifyBackupCompatibility(backup, billing);
		if (!compatibility.ok) {
			return {
				applied: false,
				dryRun: false,
				backupId: backup.id,
				reasonCode: compatibility.reasonCode,
				blockingReason: compatibility.reasonCode,
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
			};
		}

		const targetBillingBase = applyBackupPayloadToBilling(billing, backup.payload || {});
		const validationPreview = validationPreviewForBilling(targetBillingBase);
		if (
			validationPreview.result === 'FAIL'
			&& String(targetBillingBase.provider || 'none') !== 'none'
			&& body.allowValidationFail !== true
		) {
			return {
				applied: false,
				dryRun: false,
				backupId: backup.id,
				reasonCode: 'PROVIDER_VALIDATION_FAILED',
				blockingReason: 'PROVIDER_VALIDATION_FAILED',
				validationPreview,
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
			};
		}

		const stateCheck = verifyLiveState(targetBillingBase, backup);
		if (stateCheck.reasonCode === 'CHECKOUT_INCOHERENT' && body.allowCheckoutIncoherent !== true) {
			return {
				applied: false,
				dryRun: false,
				backupId: backup.id,
				reasonCode: 'CHECKOUT_INCOHERENT',
				blockingReason: 'CHECKOUT_INCOHERENT',
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
			};
		}

		// Stage pre-restore checkpoint from CURRENT live billing (not yet applied).
		const checkpointResult = createBackupRecord({
			billing,
			actor,
			label: 'pre-restore',
		});
		if (!checkpointResult.ok) {
			return {
				applied: false,
				dryRun: false,
				backupId: backup.id,
				reasonCode: checkpointResult.reasonCode,
				blockingReason: checkpointResult.reasonCode,
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
			};
		}

		const restoreEntry = {
			id: `drr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
			at: new Date().toISOString(),
			type: 'restore',
			backupId: backup.id,
			checkpointId: checkpointResult.backup.id,
			applied: true,
			reasonCode: 'OK',
			actor: actor.email || actor.id || 'admin',
			message: `Restored from ${backup.id}`,
		};

		let nextArchive = {
			...archive,
			backups: trimBackups(
				[checkpointResult.backup, ...archive.backups.filter((b) => b.id !== checkpointResult.backup.id)],
				archive.maxBackups,
			),
			checkpoints: {
				preRestore: checkpointResult.backup,
			},
		};
		nextArchive = appendRestoreHistory(nextArchive, restoreEntry);

		// Atomic: restored config keys + updated disasterRecovery in one write.
		const nextBilling = {
			...targetBillingBase,
			disasterRecovery: nextArchive,
		};

		const saved = await persistBilling(nextBilling, actor, {
			expectedUpdatedAt,
			requireOptimistic: true,
		});

		await writeControlPlaneAudit({
			action: 'billing.dr.restore_applied',
			message: `Disaster recovery restore from ${backup.id}`,
			provider: String(nextBilling.provider || ''),
			actor,
			ip: requestMeta.ip,
			userAgent: requestMeta.userAgent,
			before: {
				provider: billing.provider,
				backupId: backup.id,
			},
			after: {
				provider: nextBilling.provider,
				backupId: backup.id,
				checkpointId: checkpointResult.backup.id,
				reasonCode: 'OK',
			},
		});

		return {
			applied: true,
			dryRun: false,
			backupId: backup.id,
			checkpointId: checkpointResult.backup.id,
			reasonCode: 'OK',
			blockingReason: null,
			validationPreview,
			updatedAt: saved.updatedAt,
			activeProvider: String(saved.billing?.provider || nextBilling.provider),
			checkpointPreserved: true,
		};
	});
}

export async function rollbackDisasterRecovery(body = {}, actor = {}, requestMeta = {}, actorUser = null) {
	return withDisasterRecoveryWriteLock(async () => {
		const { billing, updatedAt } = await loadFreshBilling();
		const expectedUpdatedAt = body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || updatedAt;
		const archive = getArchive(billing);

		let target = archive.checkpoints.preRestore;
		let source = 'checkpoint';
		if (!target && body.backupId) {
			target = findBackup(archive, body.backupId);
			source = 'backup';
		}
		if (!target) {
			return {
				applied: false,
				dryRun: Boolean(body.dryRun),
				reasonCode: 'CHECKPOINT_MISSING',
				blockingReason: 'CHECKPOINT_MISSING',
				updatedAt,
				checkpointPreserved: false,
			};
		}

		if (body.dryRun) {
			const simulation = await simulateDisasterRecoveryRestore({ backupId: target.id }, actorUser);
			return { ...simulation, applied: false, dryRun: true, source };
		}

		assertSecretsWriteIfNeeded(actorUser || actor, target);

		if (isRestoreCooldownActive(archive)) {
			return {
				applied: false,
				dryRun: false,
				backupId: target.id,
				reasonCode: 'COOLDOWN_ACTIVE',
				blockingReason: 'COOLDOWN_ACTIVE',
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
				source,
			};
		}

		const integrity = verifyBackupIntegrity(target);
		if (!integrity.ok) {
			return {
				applied: false,
				dryRun: false,
				backupId: target.id,
				reasonCode: integrity.reasonCode,
				blockingReason: integrity.reasonCode,
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
				source,
			};
		}

		const compatibility = verifyBackupCompatibility(target, billing);
		if (!compatibility.ok) {
			return {
				applied: false,
				dryRun: false,
				backupId: target.id,
				reasonCode: compatibility.reasonCode,
				blockingReason: compatibility.reasonCode,
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
				source,
			};
		}

		const targetBillingBase = applyBackupPayloadToBilling(billing, target.payload || {});
		const validationPreview = validationPreviewForBilling(targetBillingBase);
		if (
			validationPreview.result === 'FAIL'
			&& String(targetBillingBase.provider || 'none') !== 'none'
			&& body.allowValidationFail !== true
		) {
			return {
				applied: false,
				dryRun: false,
				backupId: target.id,
				reasonCode: 'PROVIDER_VALIDATION_FAILED',
				blockingReason: 'PROVIDER_VALIDATION_FAILED',
				validationPreview,
				updatedAt,
				checkpointPreserved: Boolean(archive.checkpoints.preRestore),
				source,
			};
		}

		// Preserve existing pre-restore checkpoint until successful apply; then clear/rotate.
		const priorCheckpoint = archive.checkpoints.preRestore;
		const restoreEntry = {
			id: `drr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
			at: new Date().toISOString(),
			type: 'rollback',
			backupId: target.id,
			checkpointId: priorCheckpoint?.id || null,
			applied: true,
			reasonCode: 'OK',
			actor: actor.email || actor.id || 'admin',
			message: `Rollback via ${source} ${target.id}`,
		};

		let nextArchive = {
			...archive,
			checkpoints: {
				// Clear checkpoint only after successful apply (staged in same write).
				preRestore: null,
			},
		};
		nextArchive = appendRestoreHistory(nextArchive, restoreEntry);

		const nextBilling = {
			...targetBillingBase,
			disasterRecovery: nextArchive,
		};

		const saved = await persistBilling(nextBilling, actor, {
			expectedUpdatedAt,
			requireOptimistic: true,
		});

		await writeControlPlaneAudit({
			action: 'billing.dr.rollback_applied',
			message: `Disaster recovery rollback from ${target.id}`,
			provider: String(nextBilling.provider || ''),
			actor,
			ip: requestMeta.ip,
			userAgent: requestMeta.userAgent,
			before: {
				provider: billing.provider,
				source,
				backupId: target.id,
			},
			after: {
				provider: nextBilling.provider,
				backupId: target.id,
				reasonCode: 'OK',
			},
		});

		return {
			applied: true,
			dryRun: false,
			backupId: target.id,
			reasonCode: 'OK',
			blockingReason: null,
			validationPreview,
			updatedAt: saved.updatedAt,
			activeProvider: String(saved.billing?.provider || nextBilling.provider),
			checkpointPreserved: false,
			source,
		};
	});
}

export async function listDisasterRecoveryRestores(adminUser = null, { limit = 40 } = {}) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const archive = getArchive(billing);
	const items = archive.restoreHistory.slice(0, Math.min(100, Math.max(1, Number(limit) || 40)));
	return {
		items,
		lastRestore: archive.lastRestore,
		checkpoint: sanitizeBackupForPublic(archive.checkpoints.preRestore),
		updatedAt,
		permissions: getBillingPermissions(adminUser),
	};
}

export async function verifyDisasterRecoveryState(adminUser = null, body = {}) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const archive = getArchive(billing);
	const backup = body.backupId ? findBackup(archive, body.backupId) : (archive.backups[0] || null);
	const state = verifyLiveState(billing, backup);
	const preview = validationPreviewForBilling(billing);
	return {
		state,
		validationPreview: preview,
		failoverPresent: Boolean(billing.failover),
		monitoringPresent: Boolean(billing.monitoring),
		failoverPolicyVersion: normalizeFailoverPolicy(billing.failover || {}).policyVersion,
		monitoringPolicyVersion: normalizeMonitoringPolicy(billing.monitoring || {}).policyVersion,
		updatedAt,
		permissions: getBillingPermissions(adminUser),
	};
}

export async function validateDisasterRecovery(adminUser = null) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const preview = validationPreviewForBilling(billing);
	const readiness = composeReadinessStatus({
		archive: getArchive(billing),
		liveBilling: billing,
		activeValidationResult: preview.result,
		openCriticalAlerts: openCriticalFromBilling(billing),
	});
	const reasonCode = preview.result === 'FAIL' && String(billing.provider || 'none') !== 'none'
		? 'PROVIDER_VALIDATION_FAILED'
		: 'OK';
	return {
		reasonCode,
		validationPreview: preview,
		readiness,
		updatedAt,
		permissions: getBillingPermissions(adminUser),
	};
}

export async function listDisasterRecoveryAudit({ page = 1, perPage = 20 } = {}) {
	const safePage = Math.max(1, Number(page) || 1);
	const safePerPage = Math.min(100, Math.max(1, Number(perPage) || 20));
	const result = await pocketbaseClient.collection('audit_logs').getList(safePage, safePerPage, {
		filter: '(service = "billing-control-plane" || ui_category = "Billing Admin") && (action ~ "billing.dr.")',
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0, page: safePage, perPage: safePerPage }));

	return {
		items: (result.items || []).map((row) => ({
			id: row.id,
			timestamp: row.occurred_at || row.created,
			action: row.action,
			message: row.message,
			provider: row.provider,
			administrator: row.actor_label || '—',
			reasonCode: row.metadata?.after?.reasonCode || null,
			backupId: row.metadata?.after?.backupId || row.metadata?.before?.backupId || null,
		})),
		page: result.page || safePage,
		perPage: result.perPage || safePerPage,
		totalItems: result.totalItems || 0,
	};
}
