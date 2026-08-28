/**
 * Template access helpers — lock state comes ONLY from the backend `access` object.
 * Do not infer lock from premium flags, tier labels, or requiredFeatureKeys.
 */

import { isPlanFeatureEnabled } from './planFeatures.js';
export {
	formatFeatureKeyLabel,
	formatMissingFeatureLabels,
	resolveLockedFeatureIdentity,
} from './lockedFeatureIdentity.js';

/**
 * @param {unknown} templateOrAccess
 * @returns {{ visible: boolean, enabled: boolean, locked: boolean, missingKeys: string[], dependencyChain: string[] } | null}
 */
export function getTemplateAccess(templateOrAccess) {
	const access = templateOrAccess?.access && typeof templateOrAccess.access === 'object'
		? templateOrAccess.access
		: (templateOrAccess && typeof templateOrAccess === 'object'
			&& ('locked' in templateOrAccess || 'enabled' in templateOrAccess)
			? templateOrAccess
			: null);
	if (!access || typeof access !== 'object') return null;
	return {
		visible: Boolean(access.visible),
		enabled: Boolean(access.enabled),
		locked: Boolean(access.locked ?? (access.visible && !access.enabled)),
		missingKeys: Array.isArray(access.missingKeys) ? [...access.missingKeys] : [],
		dependencyChain: Array.isArray(access.dependencyChain) ? [...access.dependencyChain] : [],
	};
}

/**
 * Backend is source of truth. Locked when access.locked (or visible && !enabled).
 * Missing access object → not locked (backward compatible / ungated templates).
 * @param {object} template
 * @returns {boolean}
 */
export function isTemplateAccessLocked(template) {
	const access = getTemplateAccess(template);
	if (!access) return false;
	return Boolean(access.locked || (access.visible && !access.enabled));
}

/**
 * @param {object} template
 * @returns {boolean}
 */
export function isTemplateAccessEnabled(template) {
	const access = getTemplateAccess(template);
	if (!access) return true;
	return Boolean(access.enabled);
}

/**
 * Pick the cheapest active plan (by monthlyPrice) that grants all missing keys.
 * Returns null when no suggestion is available.
 *
 * @param {Array<{ slug?: string, id?: string, name?: string, monthlyPrice?: number, price?: number, features?: object }>} plans
 * @param {string[]} missingKeys
 * @param {{ currentPlanSlug?: string }} [options]
 * @returns {{ slug: string, name: string, monthlyPrice: number } | null}
 */
export function suggestUpgradePlan(plans, missingKeys = [], options = {}) {
	const keys = [...new Set((missingKeys || []).map((k) => String(k || '').trim()).filter(Boolean))];
	if (!keys.length || !Array.isArray(plans) || !plans.length) return null;

	const current = String(options.currentPlanSlug || '').trim().toLowerCase();
	const candidates = plans
		.filter((plan) => plan && typeof plan === 'object')
		.filter((plan) => {
			const slug = String(plan.slug || plan.id || '').trim().toLowerCase();
			if (!slug || slug === current) return false;
			return keys.every((key) => isPlanFeatureEnabled(plan.features, key));
		})
		.map((plan) => ({
			slug: String(plan.slug || plan.id || '').trim(),
			name: String(plan.name || plan.slug || plan.id || 'Plan'),
			monthlyPrice: Number(plan.monthlyPrice ?? plan.price) || 0,
		}))
		.filter((plan) => plan.slug)
		.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

	return candidates[0] || null;
}

/**
 * Detect FEATURE_LOCKED from API error payloads / thrown errors.
 * @param {unknown} errorOrPayload
 * @returns {boolean}
 */
export function isFeatureLockedError(errorOrPayload) {
	if (!errorOrPayload || typeof errorOrPayload !== 'object') return false;
	const code = String(errorOrPayload.errorCode || errorOrPayload.code || '').toUpperCase();
	if (code === 'FEATURE_LOCKED') return true;
	return Boolean(errorOrPayload.access && typeof errorOrPayload.access === 'object');
}
