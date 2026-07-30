/**
 * Pure Failover & Recovery helpers (BP-4). No PocketBase / audit side effects.
 */

export const FAILOVER_REASON_CODES = Object.freeze([
	'PROVIDER_OFFLINE',
	'PROVIDER_CRITICAL',
	'VALIDATION_FAILED',
	'PROVIDER_DISABLED',
	'MANUAL_OVERRIDE',
	'RECOVERY_COMPLETED',
	'NO_ELIGIBLE_PROVIDER',
	'COOLDOWN_ACTIVE',
]);

export const FAILOVER_PROVIDER_CODES = Object.freeze(['stripe', 'paddle', 'lemonsqueezy']);

const RECENT_EVENTS_MAX = 20;

export function isFailoverReasonCode(value) {
	return FAILOVER_REASON_CODES.includes(String(value || ''));
}

export function defaultFailoverPolicy() {
	return {
		policyVersion: 1,
		autoFailoverEnabled: false,
		mode: 'automatic',
		forcedProvider: null,
		priority: ['stripe', 'lemonsqueezy', 'paddle'],
		preferredPrimary: 'stripe',
		eligibility: {
			requireEnabled: true,
			requireImplemented: true,
			forbidHealth: ['Critical', 'Offline', 'Unknown'],
			forbidValidation: ['FAIL'],
			allowWarning: true,
		},
		cooldownSeconds: 300,
		autoOnHealthCheck: false,
		recovery: {
			mode: 'manual',
			autoRestorePreferred: false,
			requireHealthyPrimary: true,
		},
		lastDecision: {
			at: null,
			type: null,
			from: null,
			to: null,
			reasonCode: null,
			fingerprint: null,
		},
		recentEvents: [],
	};
}

function normalizePriority(list) {
	const seen = new Set();
	const out = [];
	const source = Array.isArray(list) && list.length
		? list
		: defaultFailoverPolicy().priority;
	for (const item of source) {
		const code = String(item || '').trim().toLowerCase();
		if (!FAILOVER_PROVIDER_CODES.includes(code) || seen.has(code)) continue;
		seen.add(code);
		out.push(code);
	}
	for (const code of FAILOVER_PROVIDER_CODES) {
		if (!seen.has(code)) out.push(code);
	}
	return out;
}

function normalizeEligibility(raw = {}) {
	const base = defaultFailoverPolicy().eligibility;
	const forbidHealth = Array.isArray(raw.forbidHealth)
		? raw.forbidHealth.map((v) => String(v)).filter(Boolean)
		: base.forbidHealth;
	const forbidValidation = Array.isArray(raw.forbidValidation)
		? raw.forbidValidation.map((v) => String(v).toUpperCase())
		: base.forbidValidation;
	return {
		requireEnabled: raw.requireEnabled !== false,
		requireImplemented: raw.requireImplemented !== false,
		forbidHealth,
		forbidValidation,
		allowWarning: raw.allowWarning !== false,
	};
}

function normalizeLastDecision(raw = {}) {
	const base = defaultFailoverPolicy().lastDecision;
	const reasonCode = isFailoverReasonCode(raw.reasonCode) ? raw.reasonCode : null;
	return {
		at: raw.at || null,
		type: raw.type || null,
		from: raw.from || null,
		to: raw.to || null,
		reasonCode,
		fingerprint: raw.fingerprint || null,
	};
}

function normalizeRecentEvents(list) {
	if (!Array.isArray(list)) return [];
	return list.slice(0, RECENT_EVENTS_MAX).map((event) => ({
		at: event?.at || null,
		type: event?.type || null,
		from: event?.from || null,
		to: event?.to || null,
		reasonCode: isFailoverReasonCode(event?.reasonCode) ? event.reasonCode : null,
		applied: Boolean(event?.applied),
		message: String(event?.message || '').slice(0, 500),
	}));
}

/**
 * Normalize failover policy. policyVersion is reserved for future schema evolution.
 */
export function normalizeFailoverPolicy(raw = {}) {
	const defaults = defaultFailoverPolicy();
	const mode = raw.mode === 'manual_force' ? 'manual_force' : 'automatic';
	const forced = raw.forcedProvider
		? String(raw.forcedProvider).trim().toLowerCase()
		: null;
	const preferred = String(raw.preferredPrimary || defaults.preferredPrimary).trim().toLowerCase();
	const recoveryIn = raw.recovery && typeof raw.recovery === 'object' ? raw.recovery : {};

	return {
		policyVersion: Math.max(1, Number(raw.policyVersion) || defaults.policyVersion),
		autoFailoverEnabled: Boolean(raw.autoFailoverEnabled),
		mode,
		forcedProvider: FAILOVER_PROVIDER_CODES.includes(forced) ? forced : null,
		priority: normalizePriority(raw.priority),
		preferredPrimary: FAILOVER_PROVIDER_CODES.includes(preferred) ? preferred : defaults.preferredPrimary,
		eligibility: normalizeEligibility(raw.eligibility || {}),
		cooldownSeconds: Math.max(0, Math.min(86400, Number(raw.cooldownSeconds) || defaults.cooldownSeconds)),
		autoOnHealthCheck: Boolean(raw.autoOnHealthCheck),
		recovery: {
			mode: recoveryIn.mode === 'automatic' ? 'automatic' : 'manual',
			autoRestorePreferred: Boolean(recoveryIn.autoRestorePreferred),
			requireHealthyPrimary: recoveryIn.requireHealthyPrimary !== false,
		},
		lastDecision: normalizeLastDecision(raw.lastDecision || {}),
		recentEvents: normalizeRecentEvents(raw.recentEvents),
	};
}

export function decisionFingerprint({ type, from, to, reasonCode }) {
	return `${type || 'noop'}:${from || ''}:${to || ''}:${reasonCode || ''}`;
}

export function isCooldownActive(policy, fingerprint, now = Date.now()) {
	const last = policy?.lastDecision || {};
	if (!last.at || !last.fingerprint || !fingerprint) return false;
	if (String(last.fingerprint) !== String(fingerprint)) return false;
	const elapsed = now - new Date(last.at).getTime();
	if (!Number.isFinite(elapsed) || elapsed < 0) return false;
	return elapsed < (Number(policy.cooldownSeconds) || 0) * 1000;
}

export function appendRecentEvent(policy, event) {
	const next = normalizeFailoverPolicy(policy);
	const entry = {
		at: event.at || new Date().toISOString(),
		type: event.type || null,
		from: event.from || null,
		to: event.to || null,
		reasonCode: isFailoverReasonCode(event.reasonCode) ? event.reasonCode : null,
		applied: Boolean(event.applied),
		message: String(event.message || '').slice(0, 500),
	};
	next.recentEvents = [entry, ...next.recentEvents].slice(0, RECENT_EVENTS_MAX);
	next.lastDecision = {
		at: entry.at,
		type: entry.type,
		from: entry.from,
		to: entry.to,
		reasonCode: entry.reasonCode,
		fingerprint: event.fingerprint || decisionFingerprint(entry),
	};
	return next;
}

/**
 * @typedef {object} ProviderView
 * @property {string} code
 * @property {boolean} enabled
 * @property {boolean} implemented
 * @property {string} healthStatus
 * @property {string} validationResult
 */

export function healthTriggerReason(healthStatus) {
	const status = String(healthStatus || 'Unknown');
	if (status === 'Offline') return 'PROVIDER_OFFLINE';
	if (status === 'Critical') return 'PROVIDER_CRITICAL';
	// Unknown (and any other forbidden health) maps to CRITICAL within fixed codes.
	return 'PROVIDER_CRITICAL';
}

export function evaluateProviderEligibility(view, policy) {
	const eligibility = policy.eligibility || defaultFailoverPolicy().eligibility;
	if (!view || !FAILOVER_PROVIDER_CODES.includes(view.code)) {
		return { eligible: false, reasonCode: 'NO_ELIGIBLE_PROVIDER' };
	}
	if (eligibility.requireImplemented && view.implemented === false) {
		return { eligible: false, reasonCode: 'NO_ELIGIBLE_PROVIDER' };
	}
	if (eligibility.requireEnabled && view.enabled === false) {
		return { eligible: false, reasonCode: 'PROVIDER_DISABLED' };
	}
	const validation = String(view.validationResult || '').toUpperCase();
	if ((eligibility.forbidValidation || []).includes(validation)) {
		return { eligible: false, reasonCode: 'VALIDATION_FAILED' };
	}
	if (validation === 'WARNING' && eligibility.allowWarning === false) {
		return { eligible: false, reasonCode: 'VALIDATION_FAILED' };
	}
	const health = String(view.healthStatus || 'Unknown');
	if ((eligibility.forbidHealth || []).includes(health)) {
		return { eligible: false, reasonCode: healthTriggerReason(health) };
	}
	return { eligible: true, reasonCode: null };
}

export function listEligibleProviders(viewsByCode, policy) {
	const eligible = [];
	for (const code of policy.priority || []) {
		const view = viewsByCode[code];
		const gate = evaluateProviderEligibility(view || { code, enabled: false, implemented: true, healthStatus: 'Unknown', validationResult: 'FAIL' }, policy);
		if (gate.eligible) eligible.push(code);
	}
	return eligible;
}

/**
 * Deterministic failover decision (pure).
 */
export function decideFailover({
	activeProvider = 'none',
	viewsByCode = {},
	policy: rawPolicy = {},
	now = Date.now(),
	forceAuto = false,
} = {}) {
	const policy = normalizeFailoverPolicy(rawPolicy);
	const active = String(activeProvider || 'none').toLowerCase();
	const eligibleProviders = listEligibleProviders(viewsByCode, policy);

	if (!forceAuto && (policy.mode === 'manual_force' || !policy.autoFailoverEnabled)) {
		return {
			predictedAction: 'noop',
			recognition: 'noop',
			reasonCode: 'MANUAL_OVERRIDE',
			blockingReason: 'MANUAL_OVERRIDE',
			selectedCandidate: null,
			eligibleProviders,
			from: active,
			to: null,
			warranted: false,
		};
	}

	if (active === 'none' || !FAILOVER_PROVIDER_CODES.includes(active)) {
		return {
			predictedAction: 'noop',
			recognition: 'noop',
			reasonCode: null,
			blockingReason: null,
			selectedCandidate: null,
			eligibleProviders,
			from: active,
			to: null,
			warranted: false,
		};
	}

	const activeView = viewsByCode[active] || {
		code: active,
		enabled: false,
		implemented: true,
		healthStatus: 'Unknown',
		validationResult: 'FAIL',
	};

	let triggerReason = null;
	if (activeView.enabled === false) triggerReason = 'PROVIDER_DISABLED';
	else {
		const validation = String(activeView.validationResult || '').toUpperCase();
		if ((policy.eligibility.forbidValidation || []).includes(validation)) {
			triggerReason = 'VALIDATION_FAILED';
		} else if ((policy.eligibility.forbidHealth || []).includes(String(activeView.healthStatus || 'Unknown'))) {
			triggerReason = healthTriggerReason(activeView.healthStatus);
		}
	}

	if (!triggerReason) {
		return {
			predictedAction: 'noop',
			recognition: 'noop',
			reasonCode: null,
			blockingReason: null,
			selectedCandidate: null,
			eligibleProviders,
			from: active,
			to: null,
			warranted: false,
		};
	}

	const selectedCandidate = eligibleProviders.find((code) => code !== active) || null;
	if (!selectedCandidate) {
		const fingerprint = decisionFingerprint({
			type: 'failover_blocked',
			from: active,
			to: null,
			reasonCode: 'NO_ELIGIBLE_PROVIDER',
		});
		if (isCooldownActive(policy, fingerprint, now)) {
			return {
				predictedAction: 'blocked',
				recognition: 'noop',
				reasonCode: 'COOLDOWN_ACTIVE',
				blockingReason: 'COOLDOWN_ACTIVE',
				selectedCandidate: null,
				eligibleProviders,
				from: active,
				to: null,
				warranted: true,
				fingerprint,
			};
		}
		return {
			predictedAction: 'blocked',
			recognition: 'failover',
			reasonCode: 'NO_ELIGIBLE_PROVIDER',
			blockingReason: 'NO_ELIGIBLE_PROVIDER',
			selectedCandidate: null,
			eligibleProviders,
			from: active,
			to: null,
			warranted: true,
			fingerprint,
		};
	}

	const fingerprint = decisionFingerprint({
		type: 'failover',
		from: active,
		to: selectedCandidate,
		reasonCode: triggerReason,
	});
	if (isCooldownActive(policy, fingerprint, now)) {
		return {
			predictedAction: 'noop',
			recognition: 'noop',
			reasonCode: 'COOLDOWN_ACTIVE',
			blockingReason: 'COOLDOWN_ACTIVE',
			selectedCandidate,
			eligibleProviders,
			from: active,
			to: selectedCandidate,
			warranted: true,
			fingerprint,
		};
	}

	return {
		predictedAction: 'failover',
		recognition: 'failover',
		reasonCode: triggerReason,
		blockingReason: null,
		selectedCandidate,
		eligibleProviders,
		from: active,
		to: selectedCandidate,
		warranted: true,
		fingerprint,
	};
}

/**
 * Deterministic recovery decision (pure). Platform default only — no subscription moves.
 */
export function decideRecovery({
	activeProvider = 'none',
	viewsByCode = {},
	policy: rawPolicy = {},
	now = Date.now(),
	explicit = false,
} = {}) {
	const policy = normalizeFailoverPolicy(rawPolicy);
	const active = String(activeProvider || 'none').toLowerCase();
	const preferred = policy.preferredPrimary;
	const eligibleProviders = listEligibleProviders(viewsByCode, policy);

	if (policy.mode === 'manual_force' && !explicit) {
		return {
			predictedAction: 'blocked',
			recognition: 'noop',
			reasonCode: 'MANUAL_OVERRIDE',
			blockingReason: 'MANUAL_OVERRIDE',
			selectedCandidate: preferred,
			eligibleProviders,
			from: active,
			to: preferred,
			warranted: false,
		};
	}

	if (!explicit && !(policy.recovery.mode === 'automatic' && policy.recovery.autoRestorePreferred)) {
		return {
			predictedAction: 'noop',
			recognition: 'noop',
			reasonCode: null,
			blockingReason: null,
			selectedCandidate: preferred,
			eligibleProviders,
			from: active,
			to: preferred,
			warranted: false,
		};
	}

	if (!preferred || preferred === active) {
		return {
			predictedAction: 'noop',
			recognition: 'noop',
			reasonCode: null,
			blockingReason: null,
			selectedCandidate: preferred,
			eligibleProviders,
			from: active,
			to: preferred,
			warranted: false,
		};
	}

	const preferredView = viewsByCode[preferred];
	const gate = evaluateProviderEligibility(
		preferredView || {
			code: preferred,
			enabled: false,
			implemented: true,
			healthStatus: 'Unknown',
			validationResult: 'FAIL',
		},
		policy,
	);

	if (!gate.eligible) {
		const reasonCode = gate.reasonCode || 'NO_ELIGIBLE_PROVIDER';
		const fingerprint = decisionFingerprint({
			type: 'recovery_blocked',
			from: active,
			to: preferred,
			reasonCode,
		});
		if (isCooldownActive(policy, fingerprint, now)) {
			return {
				predictedAction: 'blocked',
				recognition: 'noop',
				reasonCode: 'COOLDOWN_ACTIVE',
				blockingReason: 'COOLDOWN_ACTIVE',
				selectedCandidate: preferred,
				eligibleProviders,
				from: active,
				to: preferred,
				warranted: true,
				fingerprint,
			};
		}
		return {
			predictedAction: 'blocked',
			recognition: 'recovery',
			reasonCode,
			blockingReason: reasonCode,
			selectedCandidate: preferred,
			eligibleProviders,
			from: active,
			to: preferred,
			warranted: true,
			fingerprint,
		};
	}

	// When requireHealthyPrimary is true, only Healthy preferred may auto/manual-recover.
	if (policy.recovery.requireHealthyPrimary && String(preferredView?.healthStatus) !== 'Healthy') {
		const reasonCode = healthTriggerReason(preferredView?.healthStatus);
		const fingerprint = decisionFingerprint({
			type: 'recovery_blocked',
			from: active,
			to: preferred,
			reasonCode,
		});
		if (isCooldownActive(policy, fingerprint, now)) {
			return {
				predictedAction: 'blocked',
				recognition: 'noop',
				reasonCode: 'COOLDOWN_ACTIVE',
				blockingReason: 'COOLDOWN_ACTIVE',
				selectedCandidate: preferred,
				eligibleProviders,
				from: active,
				to: preferred,
				warranted: true,
				fingerprint,
			};
		}
		return {
			predictedAction: 'blocked',
			recognition: 'recovery',
			reasonCode,
			blockingReason: reasonCode,
			selectedCandidate: preferred,
			eligibleProviders,
			from: active,
			to: preferred,
			warranted: true,
			fingerprint,
		};
	}

	const fingerprint = decisionFingerprint({
		type: 'recovery',
		from: active,
		to: preferred,
		reasonCode: 'RECOVERY_COMPLETED',
	});
	if (isCooldownActive(policy, fingerprint, now)) {
		return {
			predictedAction: 'noop',
			recognition: 'noop',
			reasonCode: 'COOLDOWN_ACTIVE',
			blockingReason: 'COOLDOWN_ACTIVE',
			selectedCandidate: preferred,
			eligibleProviders,
			from: active,
			to: preferred,
			warranted: true,
			fingerprint,
		};
	}

	return {
		predictedAction: 'recovery',
		recognition: 'recovery',
		reasonCode: 'RECOVERY_COMPLETED',
		blockingReason: null,
		selectedCandidate: preferred,
		eligibleProviders,
		from: active,
		to: preferred,
		warranted: true,
		fingerprint,
	};
}

export function buildSimulationResult(decision, activeProvider) {
	return {
		simulation: true,
		currentProvider: activeProvider,
		activeProvider,
		eligibleProviders: decision.eligibleProviders || [],
		selectedCandidate: decision.selectedCandidate,
		blockingReason: decision.blockingReason || null,
		reasonCode: decision.blockingReason || decision.reasonCode || null,
		predictedAction: decision.predictedAction,
	};
}
