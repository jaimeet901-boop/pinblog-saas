/**
 * Feature Access Module — single backend authority for evaluating plan feature access.
 *
 * Evaluates only at the core module layer. HTTP enforcement lives in plan-access-guard.js.
 * Do not read plan.features for permission decisions outside evaluateFeatureAccess*.
 *
 * Flow:
 * 1. Resolve active plan features (caller / subscription helper)
 * 2. Normalize features
 * 3. Load Feature Catalog entry
 * 4. Expand transitive dependencies
 * 5. Admin bypass
 * 6. Return { visible, enabled, locked, missingKeys, dependencyChain }
 */

import {
	getFeatureCatalogEntry,
	getFeatureDependencyClosure,
	hasFeatureCatalogKey,
} from './feature-catalog.js';
import { isFeatureEnabled, normalizeFeatures } from './plan-features.js';

/**
 * Platform admin bypass (users.role === 'admin').
 * @param {unknown} userOrRole
 * @returns {boolean}
 */
export function isPlatformAdmin(userOrRole) {
	if (userOrRole == null) return false;
	const role = typeof userOrRole === 'string'
		? userOrRole
		: (userOrRole.role ?? userOrRole?.record?.role ?? '');
	return String(role || '').toLowerCase() === 'admin';
}

/**
 * @typedef {object} FeatureAccessResult
 * @property {boolean} visible
 * @property {boolean} enabled
 * @property {boolean} locked
 * @property {string[]} missingKeys
 * @property {string[]} dependencyChain
 */

/**
 * @param {{ visible: boolean, enabled: boolean, missingKeys?: string[], dependencyChain?: string[] }} partial
 * @returns {FeatureAccessResult}
 */
function buildAccessResult({ visible, enabled, missingKeys = [], dependencyChain = [] }) {
	const isVisible = Boolean(visible);
	const isEnabled = Boolean(enabled);
	return {
		visible: isVisible,
		enabled: isEnabled,
		locked: isVisible && !isEnabled,
		missingKeys: [...missingKeys],
		dependencyChain: [...dependencyChain],
	};
}

/**
 * Evaluate access for a feature key against plan features.
 * Pure — no PocketBase / HTTP side effects.
 *
 * @param {object} input
 * @param {string} input.featureKey
 * @param {unknown} [input.features] plan.features (booleans or { enabled })
 * @param {boolean} [input.isPlatformAdmin]
 * @param {object} [hooks] optional test hooks
 * @returns {FeatureAccessResult}
 */
export function evaluateFeatureAccess(input = {}, hooks = {}) {
	const featureKey = String(input.featureKey || '').trim();
	const resolveClosure = hooks.getFeatureDependencyClosure || getFeatureDependencyClosure;
	const resolveEntry = hooks.getFeatureCatalogEntry || getFeatureCatalogEntry;

	if (!featureKey) {
		return buildAccessResult({
			visible: false,
			enabled: false,
			missingKeys: [],
			dependencyChain: [],
		});
	}

	if (!hasFeatureCatalogKey(featureKey)) {
		// Unknown keys fail closed.
		return buildAccessResult({
			visible: false,
			enabled: false,
			missingKeys: [featureKey],
			dependencyChain: [],
		});
	}

	const entry = resolveEntry(featureKey);
	const visibleWhenLocked = entry?.defaultVisibleWhenLocked !== false;

	if (input.isPlatformAdmin) {
		let dependencyChain = [];
		try {
			dependencyChain = resolveClosure(featureKey);
		} catch {
			dependencyChain = [featureKey];
		}
		return buildAccessResult({
			visible: true,
			enabled: true,
			missingKeys: [],
			dependencyChain,
		});
	}

	let dependencyChain;
	try {
		dependencyChain = resolveClosure(featureKey);
	} catch {
		// Cycle or corrupt dependency graph — fail closed.
		return buildAccessResult({
			visible: visibleWhenLocked,
			enabled: false,
			missingKeys: [featureKey],
			dependencyChain: [],
		});
	}

	const normalized = normalizeFeatures(input.features || {}, { validate: false });
	const missingKeys = dependencyChain.filter((key) => !isFeatureEnabled(normalized, key));
	const enabled = missingKeys.length === 0;
	const visible = enabled ? true : visibleWhenLocked;

	return buildAccessResult({
		visible,
		enabled,
		missingKeys,
		dependencyChain,
	});
}

/**
 * Convenience: evaluate using a plan DTO from mapPlanDto / getSubscriptionPlan.
 * @param {object|null|undefined} plan
 * @param {string} featureKey
 * @param {{ isPlatformAdmin?: boolean, user?: unknown }} [options]
 * @returns {FeatureAccessResult}
 */
export function evaluateFeatureAccessForPlan(plan, featureKey, options = {}) {
	return evaluateFeatureAccess({
		featureKey,
		features: plan?.features,
		isPlatformAdmin: options.isPlatformAdmin ?? isPlatformAdmin(options.user),
	});
}

/**
 * Resolve the active plan for a workspace subscription (existing SoT path).
 * Dynamic import keeps unit tests free of PocketBase boot.
 * @param {object|null|undefined} subscription
 * @returns {Promise<object|null>}
 */
export async function resolveActivePlan(subscription) {
	const { getSubscriptionPlan } = await import('./workspace-context.js');
	return getSubscriptionPlan(subscription);
}

/**
 * Evaluate access for a workspace subscription.
 * @param {object|null|undefined} subscription
 * @param {string} featureKey
 * @param {{ isPlatformAdmin?: boolean, user?: unknown }} [options]
 * @returns {Promise<FeatureAccessResult>}
 */
export async function evaluateFeatureAccessForSubscription(subscription, featureKey, options = {}) {
	const plan = await resolveActivePlan(subscription);
	return evaluateFeatureAccessForPlan(plan, featureKey, options);
}

/**
 * Evaluate access using Express req (workspace subscription + optional admin user).
 * Does not throw / block — evaluation only.
 * @param {object} req
 * @param {string} featureKey
 * @returns {Promise<FeatureAccessResult>}
 */
export async function evaluateFeatureAccessForRequest(req, featureKey) {
	const user = req?.adminUser || req?.pocketbaseUser || null;
	const explicitAdmin = req?.isPlatformAdmin;
	return evaluateFeatureAccessForSubscription(req?.workspaceSubscription, featureKey, {
		user,
		isPlatformAdmin: explicitAdmin != null ? Boolean(explicitAdmin) : undefined,
	});
}
