/**
 * Pure Disaster Recovery helpers (BP-6). No PocketBase / audit side effects.
 */

import { createHash } from 'node:crypto';
import {
	CONTROL_PLANE_PROVIDER_CODES,
	SECRET_FIELDS,
	isMaskedSecret,
	publicProviderConfig,
} from './control-plane-helpers.js';

export const DR_POLICY_VERSION = 1;
export const DR_MANIFEST_VERSION = 1;

export const DR_REASON_CODES = Object.freeze([
	'OK',
	'INTEGRITY_MISMATCH',
	'STRUCTURE_INVALID',
	'PLAINTEXT_SECRET_FORBIDDEN',
	'UNSUPPORTED_POLICY_VERSION',
	'UNSUPPORTED_MANIFEST_VERSION',
	'ENVIRONMENT_INCOMPATIBLE',
	'PROVIDER_INCOMPATIBLE',
	'PROVIDER_VALIDATION_FAILED',
	'CHECKOUT_INCOHERENT',
	'CHECKPOINT_MISSING',
	'COOLDOWN_ACTIVE',
]);

export const DR_READINESS_STATUSES = Object.freeze([
	'Ready',
	'Degraded',
	'Not Ready',
	'Unknown',
]);

/** Control Plane–owned keys included in backup payloads (never disasterRecovery itself). */
export const BACKUP_PAYLOAD_KEYS = Object.freeze([
	'provider',
	'providers',
	'checkoutEnabled',
	'webhookPath',
	'failover',
	'priceMappings',
	'monitoring',
]);

const RESTORE_HISTORY_MAX = 40;
const SUPPORTED_ENVIRONMENTS = Object.freeze(['test', 'live']);

export function isDrReasonCode(value) {
	return DR_REASON_CODES.includes(String(value || ''));
}

export function defaultDisasterRecovery() {
	return {
		policyVersion: DR_POLICY_VERSION,
		maxBackups: 20,
		cooldownSeconds: 60,
		backups: [],
		checkpoints: {
			preRestore: null,
		},
		lastRestore: null,
		restoreHistory: [],
	};
}

function clampInt(value, fallback, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Normalize disasterRecovery archive. policyVersion reserved for schema evolution.
 */
export function normalizeDisasterRecovery(raw = {}) {
	const base = defaultDisasterRecovery();
	const backups = Array.isArray(raw.backups)
		? raw.backups.map((item) => normalizeBackupRecord(item)).filter(Boolean)
		: [];
	const restoreHistory = Array.isArray(raw.restoreHistory)
		? raw.restoreHistory.slice(0, RESTORE_HISTORY_MAX).map((item) => normalizeRestoreHistoryEntry(item))
		: [];
	return {
		policyVersion: Math.max(1, Number(raw.policyVersion) || base.policyVersion),
		maxBackups: clampInt(raw.maxBackups, base.maxBackups, 1, 100),
		cooldownSeconds: clampInt(raw.cooldownSeconds, base.cooldownSeconds, 0, 3600),
		backups,
		checkpoints: {
			preRestore: raw.checkpoints?.preRestore
				? normalizeBackupRecord(raw.checkpoints.preRestore)
				: null,
		},
		lastRestore: raw.lastRestore ? normalizeRestoreHistoryEntry(raw.lastRestore) : null,
		restoreHistory,
	};
}

function normalizeRestoreHistoryEntry(raw = {}) {
	return {
		id: String(raw.id || ''),
		at: raw.at || null,
		type: raw.type === 'rollback' ? 'rollback' : 'restore',
		backupId: raw.backupId || null,
		checkpointId: raw.checkpointId || null,
		applied: Boolean(raw.applied),
		reasonCode: isDrReasonCode(raw.reasonCode) ? raw.reasonCode : null,
		actor: raw.actor || null,
		message: String(raw.message || '').slice(0, 500),
	};
}

function normalizeBackupRecord(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const id = String(raw.id || '').trim();
	if (!id) return null;
	const manifest = normalizeManifest(raw.manifest || {});
	return {
		id,
		createdAt: raw.createdAt || null,
		createdBy: raw.createdBy || null,
		label: String(raw.label || 'manual').slice(0, 80),
		integrity: {
			algo: raw.integrity?.algo === 'sha256' ? 'sha256' : 'sha256',
			hash: String(raw.integrity?.hash || ''),
		},
		manifest,
		payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
	};
}

export function normalizeManifest(raw = {}) {
	const keys = Array.isArray(raw.keys)
		? raw.keys.map((k) => String(k)).filter((k) => BACKUP_PAYLOAD_KEYS.includes(k))
		: [...BACKUP_PAYLOAD_KEYS];
	const supportedProviders = Array.isArray(raw.supportedProviders)
		? raw.supportedProviders
			.map((c) => String(c || '').trim().toLowerCase())
			.filter((c) => CONTROL_PLANE_PROVIDER_CODES.includes(c))
		: [...CONTROL_PLANE_PROVIDER_CODES];
	const env = String(raw.environment || 'test').toLowerCase();
	return {
		policyVersion: Math.max(1, Number(raw.policyVersion) || DR_POLICY_VERSION),
		manifestVersion: Math.max(1, Number(raw.manifestVersion) || DR_MANIFEST_VERSION),
		environment: SUPPORTED_ENVIRONMENTS.includes(env) ? env : 'test',
		activeProvider: String(raw.activeProvider || 'none').trim().toLowerCase() || 'none',
		includesCiphertext: Boolean(raw.includesCiphertext),
		supportedProviders,
		keys: keys.length ? keys : [...BACKUP_PAYLOAD_KEYS],
	};
}

/** Stable canonical JSON for integrity hashing. */
export function canonicalJson(value) {
	return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (value && typeof value === 'object') {
		const out = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = sortKeysDeep(value[key]);
		}
		return out;
	}
	return value;
}

export function hashPayload(payload) {
	return createHash('sha256').update(canonicalJson(payload || {})).digest('hex');
}

function providerHasPlaintextSecret(code, raw = {}) {
	const secrets = SECRET_FIELDS[code] || [];
	for (const field of secrets) {
		const plain = raw[field];
		if (typeof plain === 'string' && plain && !isMaskedSecret(plain)) {
			return true;
		}
	}
	return false;
}

function stripPlaintextSecretsFromProvider(code, raw = {}) {
	const next = { ...raw };
	for (const field of SECRET_FIELDS[code] || []) {
		delete next[field];
	}
	return next;
}

function providerHasCiphertext(code, raw = {}) {
	const secrets = SECRET_FIELDS[code] || [];
	return secrets.some((field) => Boolean(raw[`${field}Cipher`]));
}

/**
 * Build backup payload from live billing. Ciphertext kept; plaintext secrets stripped.
 * Returns { payload, includesCiphertext, plaintextForbidden }.
 */
export function buildBackupPayload(billing = {}) {
	const payload = {};
	let includesCiphertext = false;
	let plaintextForbidden = false;

	for (const key of BACKUP_PAYLOAD_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(billing, key)) continue;
		if (key === 'providers') {
			const providers = billing.providers && typeof billing.providers === 'object'
				? billing.providers
				: {};
			payload.providers = {};
			for (const code of CONTROL_PLANE_PROVIDER_CODES) {
				const raw = providers[code] || {};
				if (providerHasPlaintextSecret(code, raw)) {
					plaintextForbidden = true;
				}
				const cleaned = stripPlaintextSecretsFromProvider(code, structuredClone(raw));
				if (providerHasCiphertext(code, cleaned)) includesCiphertext = true;
				payload.providers[code] = cleaned;
			}
			continue;
		}
		payload[key] = structuredClone(billing[key]);
	}

	return { payload, includesCiphertext, plaintextForbidden };
}

export function buildManifestFromBilling(billing = {}, { includesCiphertext = false } = {}) {
	const active = String(billing.provider || 'none').trim().toLowerCase() || 'none';
	const activeRaw = billing.providers?.[active] || {};
	const environment = activeRaw.mode === 'live' ? 'live' : 'test';
	return normalizeManifest({
		policyVersion: DR_POLICY_VERSION,
		manifestVersion: DR_MANIFEST_VERSION,
		environment,
		activeProvider: active,
		includesCiphertext,
		supportedProviders: [...CONTROL_PLANE_PROVIDER_CODES],
		keys: [...BACKUP_PAYLOAD_KEYS],
	});
}

export function createBackupRecord({
	billing,
	actor = {},
	label = 'manual',
	id = null,
	createdAt = null,
} = {}) {
	const built = buildBackupPayload(billing);
	if (built.plaintextForbidden) {
		return {
			ok: false,
			reasonCode: 'PLAINTEXT_SECRET_FORBIDDEN',
			backup: null,
		};
	}
	const manifest = buildManifestFromBilling(billing, {
		includesCiphertext: built.includesCiphertext,
	});
	const hash = hashPayload(built.payload);
	const backup = {
		id: id || `drb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
		createdAt: createdAt || new Date().toISOString(),
		createdBy: actor.email || actor.id || 'admin',
		label: String(label || 'manual').slice(0, 80),
		integrity: { algo: 'sha256', hash },
		manifest,
		payload: built.payload,
	};
	return { ok: true, reasonCode: 'OK', backup };
}

export function trimBackups(backups = [], maxBackups = 20) {
	const list = Array.isArray(backups) ? [...backups] : [];
	const max = clampInt(maxBackups, 20, 1, 100);
	if (list.length <= max) return list;
	return list
		.slice()
		.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
		.slice(0, max);
}

export function findBackup(archive, backupId) {
	const id = String(backupId || '').trim();
	if (!id) return null;
	const dr = normalizeDisasterRecovery(archive);
	const fromList = dr.backups.find((b) => b.id === id);
	if (fromList) return fromList;
	if (dr.checkpoints.preRestore?.id === id) return dr.checkpoints.preRestore;
	return null;
}

/**
 * Integrity verification — fixed reason codes only.
 */
export function verifyBackupIntegrity(backup) {
	if (!backup || typeof backup !== 'object' || !backup.id) {
		return { ok: false, reasonCode: 'STRUCTURE_INVALID' };
	}
	if (!backup.manifest || typeof backup.manifest !== 'object') {
		return { ok: false, reasonCode: 'STRUCTURE_INVALID' };
	}
	if (backup.manifest.policyVersion == null || backup.manifest.manifestVersion == null) {
		return { ok: false, reasonCode: 'STRUCTURE_INVALID' };
	}
	if (!backup.payload || typeof backup.payload !== 'object') {
		return { ok: false, reasonCode: 'STRUCTURE_INVALID' };
	}
	const expected = String(backup.integrity?.hash || '');
	const actual = hashPayload(backup.payload);
	if (!expected || expected !== actual) {
		return { ok: false, reasonCode: 'INTEGRITY_MISMATCH' };
	}

	const providers = backup.payload.providers || {};
	for (const code of CONTROL_PLANE_PROVIDER_CODES) {
		if (providerHasPlaintextSecret(code, providers[code] || {})) {
			return { ok: false, reasonCode: 'PLAINTEXT_SECRET_FORBIDDEN' };
		}
	}

	return { ok: true, reasonCode: 'OK' };
}

/**
 * Compatibility verification stage (policy, manifest, environment, provider).
 */
export function verifyBackupCompatibility(backup, liveBilling = {}) {
	const integrity = verifyBackupIntegrity(backup);
	if (!integrity.ok) return integrity;

	const manifest = normalizeManifest(backup.manifest || {});

	if (manifest.policyVersion !== DR_POLICY_VERSION) {
		return { ok: false, reasonCode: 'UNSUPPORTED_POLICY_VERSION' };
	}
	if (manifest.manifestVersion !== DR_MANIFEST_VERSION) {
		return { ok: false, reasonCode: 'UNSUPPORTED_MANIFEST_VERSION' };
	}

	const liveActive = String(liveBilling.provider || 'none').trim().toLowerCase() || 'none';
	const liveRaw = liveBilling.providers?.[liveActive] || {};
	const liveEnv = liveRaw.mode === 'live' ? 'live' : 'test';
	if (manifest.environment !== liveEnv) {
		return { ok: false, reasonCode: 'ENVIRONMENT_INCOMPATIBLE' };
	}

	const active = String(manifest.activeProvider || 'none').toLowerCase();
	if (active !== 'none' && !CONTROL_PLANE_PROVIDER_CODES.includes(active)) {
		return { ok: false, reasonCode: 'PROVIDER_INCOMPATIBLE' };
	}
	for (const code of manifest.supportedProviders || []) {
		if (!CONTROL_PLANE_PROVIDER_CODES.includes(code)) {
			return { ok: false, reasonCode: 'PROVIDER_INCOMPATIBLE' };
		}
	}
	if (active !== 'none' && backup.payload?.providers && !(active in (backup.payload.providers || {}))) {
		return { ok: false, reasonCode: 'PROVIDER_INCOMPATIBLE' };
	}

	return {
		ok: true,
		reasonCode: 'OK',
		compatibility: {
			policyVersion: manifest.policyVersion,
			manifestVersion: manifest.manifestVersion,
			environmentOk: true,
			providerOk: true,
		},
	};
}

export function diffBackupKeys(liveBilling = {}, backupPayload = {}) {
	const wouldRestoreKeys = [];
	const diffSummary = [];
	for (const key of BACKUP_PAYLOAD_KEYS) {
		const liveVal = liveBilling[key];
		const backupVal = backupPayload[key];
		if (backupVal === undefined) continue;
		wouldRestoreKeys.push(key);
		const liveHash = hashPayload({ [key]: liveVal });
		const backupHash = hashPayload({ [key]: backupVal });
		if (liveHash !== backupHash) {
			diffSummary.push({ key, changed: true });
		} else {
			diffSummary.push({ key, changed: false });
		}
	}
	return { wouldRestoreKeys, diffSummary };
}

/**
 * Apply backup payload onto a billing clone (owned keys only). Does not touch disasterRecovery.
 */
export function applyBackupPayloadToBilling(liveBilling = {}, backupPayload = {}) {
	const next = structuredClone(liveBilling || {});
	for (const key of BACKUP_PAYLOAD_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(backupPayload, key)) continue;
		next[key] = structuredClone(backupPayload[key]);
	}
	return next;
}

export function verifyLiveState(liveBilling = {}, backup = null) {
	const active = String(liveBilling.provider || 'none').trim().toLowerCase() || 'none';
	const checkoutEnabled = Boolean(liveBilling.checkoutEnabled);
	const issues = [];

	if (checkoutEnabled && active === 'none') {
		issues.push('CHECKOUT_INCOHERENT');
	}

	const hasFailover = liveBilling.failover && typeof liveBilling.failover === 'object';
	const hasMonitoring = liveBilling.monitoring && typeof liveBilling.monitoring === 'object';
	const hasMappings = liveBilling.priceMappings && typeof liveBilling.priceMappings === 'object';

	let matchesBackup = null;
	if (backup?.payload) {
		const { diffSummary } = diffBackupKeys(liveBilling, backup.payload);
		matchesBackup = diffSummary.every((d) => !d.changed);
	}

	const reasonCode = issues[0] || 'OK';
	return {
		ok: issues.length === 0,
		reasonCode,
		activeProvider: active,
		checkoutEnabled,
		hasFailover,
		hasMonitoring,
		hasMappings,
		matchesBackup,
		issues,
	};
}

export function composeReadinessStatus({
	archive,
	liveBilling = {},
	activeValidationResult = null,
	openCriticalAlerts = 0,
} = {}) {
	const dr = normalizeDisasterRecovery(archive);
	const latest = dr.backups[0] || null;
	if (!latest) {
		return {
			status: 'Unknown',
			reasonCode: 'OK',
			latestBackupId: null,
			latestBackupAt: null,
			includesCiphertext: false,
			notes: ['NO_BACKUP'],
		};
	}

	const integrity = verifyBackupIntegrity(latest);
	const compat = integrity.ok
		? verifyBackupCompatibility(latest, liveBilling)
		: integrity;

	const notes = [];
	if (!integrity.ok) notes.push(integrity.reasonCode);
	else if (!compat.ok) notes.push(compat.reasonCode);
	if (!latest.manifest?.includesCiphertext) notes.push('NO_CIPHERTEXT');
	if (openCriticalAlerts > 0) notes.push('CRITICAL_ALERTS');

	const checkoutEnabled = Boolean(liveBilling.checkoutEnabled);
	const active = String(liveBilling.provider || 'none').toLowerCase();
	if (checkoutEnabled && active !== 'none' && activeValidationResult === 'FAIL') {
		notes.push('PROVIDER_VALIDATION_FAILED');
	}
	if (checkoutEnabled && active === 'none') {
		notes.push('CHECKOUT_INCOHERENT');
	}

	let status = 'Ready';
	if (!integrity.ok || !compat.ok || notes.includes('CHECKOUT_INCOHERENT')) {
		status = 'Not Ready';
	} else if (notes.includes('PROVIDER_VALIDATION_FAILED') || notes.includes('CRITICAL_ALERTS') || notes.includes('NO_CIPHERTEXT')) {
		status = 'Degraded';
	}

	return {
		status,
		reasonCode: integrity.ok && compat.ok ? 'OK' : (compat.reasonCode || integrity.reasonCode),
		latestBackupId: latest.id,
		latestBackupAt: latest.createdAt,
		includesCiphertext: Boolean(latest.manifest?.includesCiphertext),
		notes,
		policyVersion: dr.policyVersion,
		manifestVersion: latest.manifest?.manifestVersion || DR_MANIFEST_VERSION,
	};
}

export function isRestoreCooldownActive(archive, nowMs = Date.now()) {
	const dr = normalizeDisasterRecovery(archive);
	if (!dr.cooldownSeconds || !dr.lastRestore?.at || !dr.lastRestore?.applied) return false;
	const last = Date.parse(dr.lastRestore.at);
	if (!Number.isFinite(last)) return false;
	return nowMs - last < dr.cooldownSeconds * 1000;
}

export function buildSimulationResult({
	backup,
	liveBilling,
	compatibility,
	validationPreview = null,
} = {}) {
	const integrity = verifyBackupIntegrity(backup);
	const compat = compatibility || (integrity.ok
		? verifyBackupCompatibility(backup, liveBilling)
		: integrity);

	const { wouldRestoreKeys, diffSummary } = diffBackupKeys(liveBilling, backup?.payload || {});
	const changed = diffSummary.filter((d) => d.changed).length;

	let blockingReason = null;
	let predictedAction = 'restore';
	if (!integrity.ok) {
		blockingReason = integrity.reasonCode;
		predictedAction = 'blocked';
	} else if (!compat.ok) {
		blockingReason = compat.reasonCode;
		predictedAction = 'blocked';
	} else if (changed === 0) {
		predictedAction = 'noop';
		blockingReason = null;
	}

	return {
		simulation: true,
		backupId: backup?.id || null,
		wouldRestoreKeys,
		diffSummary,
		blockingReason,
		predictedAction,
		secretsPresent: Boolean(backup?.manifest?.includesCiphertext),
		validationPreview,
		compatibility: compat.compatibility || {
			policyVersion: backup?.manifest?.policyVersion ?? null,
			manifestVersion: backup?.manifest?.manifestVersion ?? null,
			environmentOk: compat.ok && compat.reasonCode !== 'ENVIRONMENT_INCOMPATIBLE',
			providerOk: compat.ok && compat.reasonCode !== 'PROVIDER_INCOMPATIBLE',
		},
		reasonCode: blockingReason || 'OK',
	};
}

/**
 * Redact ciphertext from a backup for public API responses.
 */
export function sanitizeBackupForPublic(backup) {
	if (!backup) return null;
	const copy = structuredClone(backup);
	if (copy.payload?.providers) {
		const providers = {};
		for (const code of CONTROL_PLANE_PROVIDER_CODES) {
			providers[code] = publicProviderConfig(code, copy.payload.providers[code] || {});
		}
		copy.payload.providers = providers;
	}
	return {
		id: copy.id,
		createdAt: copy.createdAt,
		createdBy: copy.createdBy,
		label: copy.label,
		integrity: copy.integrity,
		manifest: copy.manifest,
		payload: copy.payload,
		payloadRedacted: true,
	};
}

export function sanitizeDisasterRecoveryForPublic(raw = {}) {
	const dr = normalizeDisasterRecovery(raw);
	return {
		policyVersion: dr.policyVersion,
		maxBackups: dr.maxBackups,
		cooldownSeconds: dr.cooldownSeconds,
		backups: dr.backups.map((b) => sanitizeBackupForPublic(b)),
		checkpoints: {
			preRestore: sanitizeBackupForPublic(dr.checkpoints.preRestore),
		},
		lastRestore: dr.lastRestore,
		restoreHistory: dr.restoreHistory,
		backupCount: dr.backups.length,
	};
}

export function appendRestoreHistory(archive, entry) {
	const dr = normalizeDisasterRecovery(archive);
	const nextEntry = normalizeRestoreHistoryEntry(entry);
	return {
		...dr,
		lastRestore: nextEntry,
		restoreHistory: [nextEntry, ...dr.restoreHistory].slice(0, RESTORE_HISTORY_MAX),
	};
}
