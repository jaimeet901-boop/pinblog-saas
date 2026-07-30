/**
 * Failover & Recovery Engine (BP-4).
 * Mutates platform default billing.provider only via Control Plane SWA.
 * Never migrates subscriptions or rewrites billing history.
 */

import {
	activateControlPlaneProvider,
	getRawBillingPayload,
	invalidateBillingRequestCache,
	writeControlPlaneAudit,
} from './control-plane.js';
import { validateProvider } from './validation-engine.js';
import { getBillingPermissions } from '../../middleware/billing-permissions.js';
import pocketbaseClient from '../../utils/pocketbaseClient.js';
import {
	FAILOVER_PROVIDER_CODES,
	FAILOVER_REASON_CODES,
	appendRecentEvent,
	buildSimulationResult,
	decideFailover,
	decideRecovery,
	decisionFingerprint,
	evaluateProviderEligibility,
	isCooldownActive,
	normalizeFailoverPolicy,
	defaultFailoverPolicy,
} from './failover-helpers.js';
import { withFailoverWriteLock } from './failover-lock.js';

export {
	FAILOVER_REASON_CODES,
	FAILOVER_PROVIDER_CODES,
	normalizeFailoverPolicy,
	defaultFailoverPolicy,
	decideFailover,
	decideRecovery,
} from './failover-helpers.js';

export { withFailoverWriteLock } from './failover-lock.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function normalizeProvider(value) {
	const code = String(value || 'none').trim().toLowerCase();
	if (code === 'none') return 'none';
	return FAILOVER_PROVIDER_CODES.includes(code) ? code : 'none';
}

async function getSettingsRow() {
	return pocketbaseClient.collection('platform_settings').getFirstListItem(
		pocketbaseClient.filter('config_key = {:key}', { key: 'platform' }),
		{ requestKey: null },
	).catch(() => null);
}

/**
 * Persist billing with optimistic concurrency.
 * expectedUpdatedAt is required for failover mutations (callers supply fresh stamp).
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

function suppressedDuplicateResponse({
	activeProvider,
	previousProvider,
	policy,
	decision,
	updatedAt,
}) {
	return decisionResponse({
		decision: {
			...decision,
			predictedAction: 'noop',
			recognition: 'noop',
			reasonCode: 'COOLDOWN_ACTIVE',
			blockingReason: 'COOLDOWN_ACTIVE',
		},
		activeProvider,
		previousProvider: previousProvider ?? activeProvider,
		policy,
		applied: false,
		dryRun: false,
		eventId: null,
		updatedAt,
	});
}

function buildViewsByCode(billing = {}) {
	const views = {};
	for (const code of FAILOVER_PROVIDER_CODES) {
		const raw = billing.providers?.[code] || {};
		const validation = validateProvider(code, raw, billing);
		const healthStatus = raw.healthSnapshot?.status
			|| (raw.enabled === false ? 'Offline' : 'Unknown');
		views[code] = {
			code,
			enabled: raw.enabled !== false,
			implemented: true,
			healthStatus,
			validationResult: validation.result,
		};
	}
	// PayPal is never an eligible failover target (not implemented).
	const paypalRaw = billing.providers?.paypal || {};
	views.paypal = {
		code: 'paypal',
		enabled: paypalRaw.enabled === true,
		implemented: false,
		healthStatus: 'Offline',
		validationResult: 'FAIL',
	};
	return views;
}

function decisionResponse({
	decision,
	activeProvider,
	previousProvider,
	policy,
	applied,
	dryRun,
	eventId = null,
	updatedAt = null,
}) {
	return {
		activeProvider,
		previousProvider: previousProvider ?? activeProvider,
		mode: policy.mode,
		autoFailoverEnabled: policy.autoFailoverEnabled,
		recognition: decision.recognition || 'noop',
		reasonCode: decision.reasonCode || null,
		healthAtDecision: {
			from: decision.from || null,
			to: decision.to || null,
		},
		applied: Boolean(applied),
		dryRun: Boolean(dryRun),
		eventId,
		selectedCandidate: decision.selectedCandidate || null,
		eligibleProviders: decision.eligibleProviders || [],
		predictedAction: decision.predictedAction,
		updatedAt,
		policy,
	};
}

async function recordDecision({
	billing,
	policy,
	decision,
	applied,
	actor,
	requestMeta,
	action,
	message,
	expectedUpdatedAt,
}) {
	const fingerprint = decision.fingerprint || decisionFingerprint({
		type: decision.recognition,
		from: decision.from,
		to: decision.to,
		reasonCode: decision.reasonCode,
	});

	// Skip duplicate audit + recentEvents when the same decision was just recorded.
	if (isCooldownActive(policy, fingerprint) && policy.lastDecision?.reasonCode === decision.reasonCode) {
		return {
			saved: { billing, updatedAt: expectedUpdatedAt || null },
			nextPolicy: policy,
			eventId: null,
			suppressed: true,
		};
	}

	const nextPolicy = appendRecentEvent(policy, {
		at: new Date().toISOString(),
		type: decision.recognition || decision.predictedAction,
		from: decision.from,
		to: decision.to,
		reasonCode: decision.reasonCode,
		applied,
		message,
		fingerprint,
	});

	const nextBilling = {
		...billing,
		failover: nextPolicy,
	};

	const saved = await persistBilling(nextBilling, actor, {
		expectedUpdatedAt: expectedUpdatedAt || requestMeta.expectedUpdatedAt || null,
		requireOptimistic: true,
	});

	const audit = await writeControlPlaneAudit({
		action,
		message,
		provider: decision.to || decision.from || normalizeProvider(saved.billing.provider),
		severity: applied && decision.predictedAction === 'failover' ? 'warn' : 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before: { provider: decision.from, failover: policy.lastDecision },
		after: {
			provider: normalizeProvider(saved.billing.provider),
			reasonCode: decision.reasonCode,
			applied,
			recognition: decision.recognition,
			to: decision.to,
			fingerprint,
		},
	});

	return { saved, nextPolicy, eventId: audit?.id || null, suppressed: false };
}

export async function getFailoverPolicy(adminUser = null) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const policy = normalizeFailoverPolicy(billing.failover || {});
	return {
		policy,
		activeProvider: normalizeProvider(billing.provider),
		updatedAt,
		reasonCodes: FAILOVER_REASON_CODES,
		permissions: adminUser ? getBillingPermissions(adminUser) : undefined,
	};
}

export async function updateFailoverPolicy(body = {}, actor = {}, requestMeta = {}) {
	return withFailoverWriteLock(async () => {
		const { billing, updatedAt } = await loadFreshBilling();
		const current = normalizeFailoverPolicy(billing.failover || {});
		const patch = body.policy && typeof body.policy === 'object' ? body.policy : body;
		const clientStamp = body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || null;
		const expectedUpdatedAt = clientStamp || updatedAt;

		if (clientStamp && updatedAt && String(clientStamp) !== String(updatedAt)) {
			throw httpError(409, 'Billing configuration changed. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
		}

		const next = normalizeFailoverPolicy({
			...current,
			...patch,
			lastDecision: patch.lastDecision !== undefined ? patch.lastDecision : current.lastDecision,
			recentEvents: patch.recentEvents !== undefined ? patch.recentEvents : current.recentEvents,
			recovery: {
				...current.recovery,
				...(patch.recovery && typeof patch.recovery === 'object' ? patch.recovery : {}),
			},
			eligibility: {
				...current.eligibility,
				...(patch.eligibility && typeof patch.eligibility === 'object' ? patch.eligibility : {}),
			},
			policyVersion: current.policyVersion,
		});

		const nextBilling = { ...billing, failover: next };
		const saved = await persistBilling(nextBilling, actor, {
			expectedUpdatedAt,
			requireOptimistic: true,
		});

		await writeControlPlaneAudit({
			action: 'billing.failover.policy_updated',
			message: 'Failover policy updated',
			provider: normalizeProvider(saved.billing.provider),
			severity: 'info',
			actor,
			ip: requestMeta.ip,
			userAgent: requestMeta.userAgent,
			before: { autoFailoverEnabled: current.autoFailoverEnabled, mode: current.mode },
			after: {
				autoFailoverEnabled: next.autoFailoverEnabled,
				mode: next.mode,
				priority: next.priority,
				preferredPrimary: next.preferredPrimary,
			},
		});

		return {
			policy: normalizeFailoverPolicy(saved.billing.failover || next),
			activeProvider: normalizeProvider(saved.billing.provider),
			updatedAt: saved.updatedAt,
		};
	});
}

export async function getFailoverStatus(adminUser = null) {
	const { billing, updatedAt } = await getRawBillingPayload();
	const policy = normalizeFailoverPolicy(billing.failover || {});
	const activeProvider = normalizeProvider(billing.provider);
	const viewsByCode = buildViewsByCode(billing);
	const decision = decideFailover({ activeProvider, viewsByCode, policy });
	const recovery = decideRecovery({ activeProvider, viewsByCode, policy, explicit: false });

	return {
		activeProvider,
		mode: policy.mode,
		forcedProvider: policy.forcedProvider,
		autoFailoverEnabled: policy.autoFailoverEnabled,
		preferredPrimary: policy.preferredPrimary,
		priority: policy.priority,
		eligibleProviders: decision.eligibleProviders,
		nextEligible: decision.selectedCandidate,
		lastDecision: policy.lastDecision,
		recentEvents: policy.recentEvents,
		predictedFailover: decision.predictedAction,
		predictedRecovery: recovery.predictedAction,
		updatedAt,
		policy,
		permissions: adminUser ? getBillingPermissions(adminUser) : undefined,
	};
}

/**
 * Simulation Mode — never writes configuration, audit, or billing.provider.
 */
export async function simulateFailover(body = {}) {
	const { billing } = await getRawBillingPayload();
	const policy = normalizeFailoverPolicy(billing.failover || {});
	const activeProvider = normalizeProvider(billing.provider);
	const viewsByCode = buildViewsByCode(billing);
	const intent = String(body.intent || 'failover').toLowerCase();

	const decision = intent === 'recovery'
		? decideRecovery({ activeProvider, viewsByCode, policy, explicit: true })
		: decideFailover({
			activeProvider,
			viewsByCode,
			policy,
			forceAuto: Boolean(body.forceAuto),
		});

	return buildSimulationResult(decision, activeProvider);
}

export async function evaluateFailover(body = {}, actor = {}, requestMeta = {}) {
	const dryRun = body.dryRun !== false && body.apply !== true;
	if (dryRun) {
		const { billing } = await getRawBillingPayload();
		const policy = normalizeFailoverPolicy(billing.failover || {});
		const activeProvider = normalizeProvider(billing.provider);
		const viewsByCode = buildViewsByCode(billing);
		const decision = decideFailover({ activeProvider, viewsByCode, policy });
		return decisionResponse({
			decision,
			activeProvider,
			previousProvider: activeProvider,
			policy,
			applied: false,
			dryRun: true,
		});
	}

	return withFailoverWriteLock(async () => {
		const { billing, updatedAt } = await loadFreshBilling();
		const policy = normalizeFailoverPolicy(billing.failover || {});
		const activeProvider = normalizeProvider(billing.provider);
		const viewsByCode = buildViewsByCode(billing);
		const decision = decideFailover({ activeProvider, viewsByCode, policy });

		if (decision.predictedAction !== 'failover' || !decision.to) {
			if (decision.predictedAction === 'blocked' && decision.reasonCode) {
				if (isCooldownActive(policy, decision.fingerprint)) {
					return suppressedDuplicateResponse({
						activeProvider,
						previousProvider: activeProvider,
						policy,
						decision,
						updatedAt,
					});
				}
				const { saved, nextPolicy, eventId, suppressed } = await recordDecision({
					billing,
					policy,
					decision,
					applied: false,
					actor,
					requestMeta,
					action: 'billing.failover.blocked',
					message: `Failover blocked: ${decision.reasonCode}`,
					expectedUpdatedAt: updatedAt,
				});
				if (suppressed) {
					return suppressedDuplicateResponse({
						activeProvider,
						previousProvider: activeProvider,
						policy: nextPolicy,
						decision,
						updatedAt: saved.updatedAt,
					});
				}
				return decisionResponse({
					decision,
					activeProvider: normalizeProvider(saved.billing.provider),
					previousProvider: activeProvider,
					policy: nextPolicy,
					applied: false,
					dryRun: false,
					eventId,
					updatedAt: saved.updatedAt,
				});
			}
			return decisionResponse({
				decision,
				activeProvider,
				previousProvider: activeProvider,
				policy,
				applied: false,
				dryRun: false,
				updatedAt,
			});
		}

		return executeFailoverLocked({
			provider: decision.to,
			reasonCode: decision.reasonCode,
			fromDecision: decision,
		}, actor, requestMeta, { billing, updatedAt, policy, activeProvider, viewsByCode });
	});
}

/**
 * Public execute entry — acquires single-flight then delegates.
 */
export async function executeFailover(body = {}, actor = {}, requestMeta = {}) {
	return withFailoverWriteLock(async () => {
		const fresh = await loadFreshBilling();
		const policy = normalizeFailoverPolicy(fresh.billing.failover || {});
		const activeProvider = normalizeProvider(fresh.billing.provider);
		const viewsByCode = buildViewsByCode(fresh.billing);
		return executeFailoverLocked(body, actor, requestMeta, {
			billing: fresh.billing,
			updatedAt: fresh.updatedAt,
			policy,
			activeProvider,
			viewsByCode,
		});
	});
}

async function executeFailoverLocked(body, actor, requestMeta, ctx) {
	let { billing, updatedAt, policy, activeProvider, viewsByCode } = ctx;

	let decision = body.fromDecision || decideFailover({
		activeProvider,
		viewsByCode,
		policy,
		forceAuto: true,
	});

	// Re-bind decision to fresh state (ignore stale fromDecision provider/from).
	decision = {
		...decision,
		from: activeProvider,
		eligibleProviders: decideFailover({
			activeProvider,
			viewsByCode,
			policy,
			forceAuto: true,
		}).eligibleProviders,
	};

	const target = normalizeProvider(body.provider || decision.to || decision.selectedCandidate);

	if (target && target !== 'none' && activeProvider === target) {
		return suppressedDuplicateResponse({
			activeProvider,
			previousProvider: activeProvider,
			policy,
			decision: {
				...decision,
				to: target,
				selectedCandidate: target,
				fingerprint: decisionFingerprint({
					type: 'failover',
					from: activeProvider,
					to: target,
					reasonCode: decision.reasonCode || 'MANUAL_OVERRIDE',
				}),
			},
			updatedAt,
		});
	}

	if (!target || target === 'none') {
		decision = {
			...decision,
			predictedAction: 'blocked',
			recognition: 'failover',
			reasonCode: 'NO_ELIGIBLE_PROVIDER',
			blockingReason: 'NO_ELIGIBLE_PROVIDER',
			to: null,
			selectedCandidate: null,
			fingerprint: decisionFingerprint({
				type: 'failover_blocked',
				from: activeProvider,
				to: null,
				reasonCode: 'NO_ELIGIBLE_PROVIDER',
			}),
		};
		if (isCooldownActive(policy, decision.fingerprint)) {
			return suppressedDuplicateResponse({
				activeProvider,
				previousProvider: activeProvider,
				policy,
				decision,
				updatedAt,
			});
		}
		const { saved, nextPolicy, eventId, suppressed } = await recordDecision({
			billing,
			policy,
			decision,
			applied: false,
			actor,
			requestMeta,
			action: 'billing.failover.blocked',
			message: 'Failover blocked: no eligible provider',
			expectedUpdatedAt: updatedAt,
		});
		if (suppressed) {
			return suppressedDuplicateResponse({
				activeProvider,
				previousProvider: activeProvider,
				policy: nextPolicy,
				decision,
				updatedAt: saved.updatedAt,
			});
		}
		return decisionResponse({
			decision,
			activeProvider: normalizeProvider(saved.billing.provider),
			previousProvider: activeProvider,
			policy: nextPolicy,
			applied: false,
			dryRun: false,
			eventId,
			updatedAt: saved.updatedAt,
		});
	}

	const eligibility = evaluateProviderEligibility(viewsByCode[target], policy);
	if (!eligibility.eligible) {
		const blocked = {
			predictedAction: 'blocked',
			recognition: 'failover',
			reasonCode: eligibility.reasonCode || 'NO_ELIGIBLE_PROVIDER',
			blockingReason: eligibility.reasonCode || 'NO_ELIGIBLE_PROVIDER',
			selectedCandidate: null,
			eligibleProviders: decision.eligibleProviders || [],
			from: activeProvider,
			to: target,
			fingerprint: decisionFingerprint({
				type: 'failover_blocked',
				from: activeProvider,
				to: target,
				reasonCode: eligibility.reasonCode || 'NO_ELIGIBLE_PROVIDER',
			}),
		};
		if (isCooldownActive(policy, blocked.fingerprint)) {
			return suppressedDuplicateResponse({
				activeProvider,
				previousProvider: activeProvider,
				policy,
				decision: blocked,
				updatedAt,
			});
		}
		const { saved, nextPolicy, eventId, suppressed } = await recordDecision({
			billing,
			policy,
			decision: blocked,
			applied: false,
			actor,
			requestMeta,
			action: 'billing.failover.blocked',
			message: `Failover to ${target} blocked: ${blocked.reasonCode}`,
			expectedUpdatedAt: updatedAt,
		});
		if (suppressed) {
			return suppressedDuplicateResponse({
				activeProvider,
				previousProvider: activeProvider,
				policy: nextPolicy,
				decision: blocked,
				updatedAt: saved.updatedAt,
			});
		}
		return decisionResponse({
			decision: blocked,
			activeProvider: normalizeProvider(saved.billing.provider),
			previousProvider: activeProvider,
			policy: nextPolicy,
			applied: false,
			dryRun: false,
			eventId,
			updatedAt: saved.updatedAt,
		});
	}

	const reasonCode = isFailoverReason(body.reasonCode)
		? body.reasonCode
		: (decision.reasonCode || 'MANUAL_OVERRIDE');
	const appliedFingerprint = decisionFingerprint({
		type: 'failover',
		from: activeProvider,
		to: target,
		reasonCode,
	});
	if (isCooldownActive(policy, appliedFingerprint)) {
		return suppressedDuplicateResponse({
			activeProvider,
			previousProvider: activeProvider,
			policy,
			decision: {
				...decision,
				to: target,
				selectedCandidate: target,
				reasonCode,
				fingerprint: appliedFingerprint,
			},
			updatedAt,
		});
	}

	// SWA activate with OCC stamp — never bypasses BP-2 validation.
	await activateControlPlaneProvider(target, actor, {
		...requestMeta,
		expectedUpdatedAt: updatedAt,
	});

	const after = await loadFreshBilling();
	const afterPolicy = normalizeFailoverPolicy(after.billing.failover || policy);
	const appliedDecision = {
		predictedAction: 'failover',
		recognition: 'failover',
		reasonCode,
		blockingReason: null,
		selectedCandidate: target,
		eligibleProviders: decision.eligibleProviders || [],
		from: activeProvider,
		to: target,
		fingerprint: appliedFingerprint,
	};

	if (isCooldownActive(afterPolicy, appliedFingerprint)) {
		return suppressedDuplicateResponse({
			activeProvider: normalizeProvider(after.billing.provider),
			previousProvider: activeProvider,
			policy: afterPolicy,
			decision: appliedDecision,
			updatedAt: after.updatedAt,
		});
	}

	const { saved, nextPolicy, eventId, suppressed } = await recordDecision({
		billing: after.billing,
		policy: afterPolicy,
		decision: appliedDecision,
		applied: true,
		actor,
		requestMeta,
		action: 'billing.failover.executed',
		message: `Failover ${activeProvider} → ${target} (${appliedDecision.reasonCode})`,
		expectedUpdatedAt: after.updatedAt,
	});
	if (suppressed) {
		return suppressedDuplicateResponse({
			activeProvider: normalizeProvider(saved.billing?.provider || after.billing.provider),
			previousProvider: activeProvider,
			policy: nextPolicy,
			decision: appliedDecision,
			updatedAt: saved.updatedAt,
		});
	}

	return decisionResponse({
		decision: appliedDecision,
		activeProvider: normalizeProvider(saved.billing.provider),
		previousProvider: activeProvider,
		policy: nextPolicy,
		applied: true,
		dryRun: false,
		eventId,
		updatedAt: saved.updatedAt,
	});
}

function isFailoverReason(value) {
	return FAILOVER_REASON_CODES.includes(String(value || ''));
}

export async function recoverFailover(body = {}, actor = {}, requestMeta = {}) {
	const dryRun = body.dryRun === true;
	if (dryRun) {
		const { billing } = await getRawBillingPayload();
		const policy = normalizeFailoverPolicy(billing.failover || {});
		const activeProvider = normalizeProvider(billing.provider);
		const viewsByCode = buildViewsByCode(billing);
		const decision = decideRecovery({
			activeProvider,
			viewsByCode,
			policy,
			explicit: true,
		});
		return decisionResponse({
			decision,
			activeProvider,
			previousProvider: activeProvider,
			policy,
			applied: false,
			dryRun: true,
		});
	}

	return withFailoverWriteLock(async () => {
		const { billing, updatedAt } = await loadFreshBilling();
		const policy = normalizeFailoverPolicy(billing.failover || {});
		const activeProvider = normalizeProvider(billing.provider);
		const viewsByCode = buildViewsByCode(billing);
		const decision = decideRecovery({
			activeProvider,
			viewsByCode,
			policy,
			explicit: true,
		});

		if (decision.predictedAction !== 'recovery' || !decision.to) {
			if (decision.predictedAction === 'blocked') {
				if (isCooldownActive(policy, decision.fingerprint)) {
					return suppressedDuplicateResponse({
						activeProvider,
						previousProvider: activeProvider,
						policy,
						decision,
						updatedAt,
					});
				}
				const { saved, nextPolicy, eventId, suppressed } = await recordDecision({
					billing,
					policy,
					decision,
					applied: false,
					actor,
					requestMeta,
					action: 'billing.failover.recovery_blocked',
					message: `Recovery blocked: ${decision.reasonCode}`,
					expectedUpdatedAt: updatedAt,
				});
				if (suppressed) {
					return suppressedDuplicateResponse({
						activeProvider,
						previousProvider: activeProvider,
						policy: nextPolicy,
						decision,
						updatedAt: saved.updatedAt,
					});
				}
				return decisionResponse({
					decision,
					activeProvider: normalizeProvider(saved.billing.provider),
					previousProvider: activeProvider,
					policy: nextPolicy,
					applied: false,
					dryRun: false,
					eventId,
					updatedAt: saved.updatedAt,
				});
			}
			return decisionResponse({
				decision,
				activeProvider,
				previousProvider: activeProvider,
				policy,
				applied: false,
				dryRun: false,
				updatedAt,
			});
		}

		if (activeProvider === decision.to) {
			return suppressedDuplicateResponse({
				activeProvider,
				previousProvider: activeProvider,
				policy,
				decision,
				updatedAt,
			});
		}

		if (isCooldownActive(policy, decision.fingerprint)) {
			return suppressedDuplicateResponse({
				activeProvider,
				previousProvider: activeProvider,
				policy,
				decision,
				updatedAt,
			});
		}

		await activateControlPlaneProvider(decision.to, actor, {
			...requestMeta,
			expectedUpdatedAt: updatedAt,
		});

		const after = await loadFreshBilling();
		const afterPolicy = normalizeFailoverPolicy(after.billing.failover || policy);
		const appliedDecision = {
			...decision,
			reasonCode: 'RECOVERY_COMPLETED',
			blockingReason: null,
			predictedAction: 'recovery',
			recognition: 'recovery',
			fingerprint: decisionFingerprint({
				type: 'recovery',
				from: activeProvider,
				to: decision.to,
				reasonCode: 'RECOVERY_COMPLETED',
			}),
		};

		if (isCooldownActive(afterPolicy, appliedDecision.fingerprint)) {
			return suppressedDuplicateResponse({
				activeProvider: normalizeProvider(after.billing.provider),
				previousProvider: activeProvider,
				policy: afterPolicy,
				decision: appliedDecision,
				updatedAt: after.updatedAt,
			});
		}

		const { saved, nextPolicy, eventId, suppressed } = await recordDecision({
			billing: after.billing,
			policy: afterPolicy,
			decision: appliedDecision,
			applied: true,
			actor,
			requestMeta,
			action: 'billing.failover.recovered',
			message: `Recovery ${activeProvider} → ${decision.to} (RECOVERY_COMPLETED)`,
			expectedUpdatedAt: after.updatedAt,
		});
		if (suppressed) {
			return suppressedDuplicateResponse({
				activeProvider: normalizeProvider(saved.billing?.provider || after.billing.provider),
				previousProvider: activeProvider,
				policy: nextPolicy,
				decision: appliedDecision,
				updatedAt: saved.updatedAt,
			});
		}

		return decisionResponse({
			decision: appliedDecision,
			activeProvider: normalizeProvider(saved.billing.provider),
			previousProvider: activeProvider,
			policy: nextPolicy,
			applied: true,
			dryRun: false,
			eventId,
			updatedAt: saved.updatedAt,
		});
	});
}

export async function overrideFailover(body = {}, actor = {}, requestMeta = {}) {
	return withFailoverWriteLock(async () => {
		const { billing, updatedAt } = await loadFreshBilling();
		const policy = normalizeFailoverPolicy(billing.failover || {});
		const activeProvider = normalizeProvider(billing.provider);
		const mode = String(body.mode || '').toLowerCase();
		const clientStamp = body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || null;
		if (clientStamp && updatedAt && String(clientStamp) !== String(updatedAt)) {
			throw httpError(409, 'Billing configuration changed. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
		}
		const expectedUpdatedAt = clientStamp || updatedAt;

		if (mode === 'force') {
			const target = normalizeProvider(body.provider);
			if (!FAILOVER_PROVIDER_CODES.includes(target)) {
				throw httpError(422, 'Forced provider must be a configurable billing provider.', 'INVALID_PROVIDER');
			}
			const viewsByCode = buildViewsByCode(billing);
			const view = viewsByCode[target];
			if (view.enabled === false) {
				throw httpError(422, 'Cannot force a disabled provider.', 'PROVIDER_DISABLED');
			}

			let stamp = expectedUpdatedAt;
			if (activeProvider !== target) {
				await activateControlPlaneProvider(target, actor, {
					...requestMeta,
					expectedUpdatedAt: stamp,
				});
				const afterActivate = await loadFreshBilling();
				stamp = afterActivate.updatedAt;
				Object.assign(billing, afterActivate.billing);
			}

			const next = normalizeFailoverPolicy({
				...(billing.failover || policy),
				mode: 'manual_force',
				forcedProvider: target,
				autoFailoverEnabled: false,
			});
			const message = `Forced active provider to ${target}`;
			const decision = {
				predictedAction: 'noop',
				recognition: 'override',
				reasonCode: 'MANUAL_OVERRIDE',
				from: activeProvider,
				to: target,
				selectedCandidate: target,
				eligibleProviders: [],
				fingerprint: decisionFingerprint({
					type: 'override',
					from: activeProvider,
					to: target,
					reasonCode: 'MANUAL_OVERRIDE',
				}),
			};
			const recorded = appendRecentEvent(next, {
				...decision,
				applied: true,
				message,
				reasonCode: 'MANUAL_OVERRIDE',
			});
			const saved = await persistBilling({ ...billing, failover: recorded }, actor, {
				expectedUpdatedAt: stamp,
				requireOptimistic: true,
			});
			await writeControlPlaneAudit({
				action: 'billing.failover.override',
				message,
				provider: target,
				severity: 'warn',
				actor,
				ip: requestMeta.ip,
				userAgent: requestMeta.userAgent,
				before: { provider: activeProvider, mode: policy.mode },
				after: { provider: target, mode: 'manual_force', reasonCode: 'MANUAL_OVERRIDE' },
			});
			return decisionResponse({
				decision: { ...decision, reasonCode: 'MANUAL_OVERRIDE' },
				activeProvider: normalizeProvider(saved.billing.provider),
				previousProvider: activeProvider,
				policy: recorded,
				applied: true,
				dryRun: false,
				updatedAt: saved.updatedAt,
			});
		}

		let next;
		let message;
		if (mode === 'automatic' || body.resumeAutomatic === true) {
			next = normalizeFailoverPolicy({
				...policy,
				mode: 'automatic',
				forcedProvider: null,
				autoFailoverEnabled: body.autoFailoverEnabled !== undefined
					? Boolean(body.autoFailoverEnabled)
					: policy.autoFailoverEnabled,
			});
			message = 'Resumed automatic failover mode';
		} else if (body.autoFailoverEnabled !== undefined || mode === 'disable_auto') {
			next = normalizeFailoverPolicy({
				...policy,
				autoFailoverEnabled: mode === 'disable_auto' ? false : Boolean(body.autoFailoverEnabled),
			});
			message = next.autoFailoverEnabled ? 'Automatic failover enabled' : 'Automatic failover disabled';
		} else {
			throw httpError(400, 'Override requires mode force|automatic or autoFailoverEnabled.', 'INVALID_OVERRIDE');
		}

		const decision = {
			predictedAction: 'noop',
			recognition: 'override',
			reasonCode: 'MANUAL_OVERRIDE',
			from: activeProvider,
			to: activeProvider,
			selectedCandidate: null,
			eligibleProviders: [],
			fingerprint: decisionFingerprint({
				type: 'override',
				from: activeProvider,
				to: activeProvider,
				reasonCode: 'MANUAL_OVERRIDE',
			}),
		};

		const recorded = appendRecentEvent(next, {
			...decision,
			applied: true,
			message,
			reasonCode: 'MANUAL_OVERRIDE',
		});

		const saved = await persistBilling({ ...billing, failover: recorded }, actor, {
			expectedUpdatedAt,
			requireOptimistic: true,
		});

		await writeControlPlaneAudit({
			action: 'billing.failover.override',
			message,
			provider: activeProvider,
			severity: 'warn',
			actor,
			ip: requestMeta.ip,
			userAgent: requestMeta.userAgent,
			before: { mode: policy.mode, autoFailoverEnabled: policy.autoFailoverEnabled },
			after: {
				mode: recorded.mode,
				autoFailoverEnabled: recorded.autoFailoverEnabled,
				reasonCode: 'MANUAL_OVERRIDE',
			},
		});

		return decisionResponse({
			decision,
			activeProvider: normalizeProvider(saved.billing.provider),
			previousProvider: activeProvider,
			policy: recorded,
			applied: true,
			dryRun: false,
			updatedAt: saved.updatedAt,
		});
	});
}

export async function listFailoverEvents(query = {}) {
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));

	const parts = [
		'(service = "billing-control-plane" || ui_category = "Billing Admin")',
		'(action ~ "billing.failover")',
	];

	const result = await pocketbaseClient.collection('audit_logs').getList(page, perPage, {
		filter: parts.join(' && '),
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));

	const { billing } = await getRawBillingPayload();
	const policy = normalizeFailoverPolicy(billing.failover || {});

	return {
		items: (result.items || []).map((row) => ({
			id: row.id,
			timestamp: row.occurred_at || row.created,
			action: row.action,
			message: row.message,
			provider: row.provider,
			administrator: row.actor_label || '—',
			reasonCode: row.metadata?.after?.reasonCode || null,
			metadata: row.metadata || {},
		})),
		recentEvents: policy.recentEvents,
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		reasonCodes: FAILOVER_REASON_CODES,
	};
}

/**
 * Optional post health-check hook (no worker). Called from admin routes only.
 */
export async function maybeAutoEvaluateAfterHealthCheck(actor = {}, requestMeta = {}) {
	const { billing } = await getRawBillingPayload();
	const policy = normalizeFailoverPolicy(billing.failover || {});
	if (!policy.autoOnHealthCheck || !policy.autoFailoverEnabled || policy.mode === 'manual_force') {
		return null;
	}
	return evaluateFailover({ apply: true, dryRun: false }, actor, {
		...requestMeta,
	});
}
