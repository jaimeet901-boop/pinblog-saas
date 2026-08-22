/**
 * Free-plan website slot — quota gate (not a Feature Catalog key).
 * Paid plans are never blocked here; do not read limits.wordpressSites.
 */

import { featureLockedError } from './plan-access-guard.js';

export const FREE_PLAN_WEBSITE_FEATURE_KEY = 'websites';

export function isFreePlanSlug(slug) {
	return String(slug || '').trim().toLowerCase() === 'free';
}

/**
 * Whether a Free workspace would gain a second active website.
 * @param {{ planSlug?: string, activeCount?: number, targetAlreadyActive?: boolean }} input
 * @returns {boolean}
 */
export function shouldBlockFreePlanSecondWebsite({
	planSlug,
	activeCount = 0,
	targetAlreadyActive = false,
} = {}) {
	if (!isFreePlanSlug(planSlug)) return false;
	if (targetAlreadyActive) return false;
	return Number(activeCount) >= 1;
}

export function freePlanSecondWebsiteLockedError() {
	return featureLockedError(
		{
			visible: true,
			enabled: false,
			locked: true,
			missingKeys: [],
			dependencyChain: [],
			requiredKeys: [FREE_PLAN_WEBSITE_FEATURE_KEY],
		},
		{
			featureKey: FREE_PLAN_WEBSITE_FEATURE_KEY,
			message: 'Adding another website requires a plan upgrade.',
		},
	);
}
