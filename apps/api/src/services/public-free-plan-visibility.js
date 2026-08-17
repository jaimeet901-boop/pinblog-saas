/**
 * Free plan public visibility — catalog / self-serve selection only.
 *
 * Does not mutate plans.active, plans.status, pricing, credits, or subscriptions.
 * Existing Free workspaces keep their plan; admin assign and cancel-to-Free are out of scope.
 */

export const FREE_PLAN_SLUG = 'free';

function planSlugOf(planOrItem) {
	if (!planOrItem || typeof planOrItem !== 'object') return '';
	return String(planOrItem.slug || '').trim().toLowerCase();
}

function readGeneral(settings) {
	if (!settings || typeof settings !== 'object') return {};
	if (settings.general && typeof settings.general === 'object') return settings.general;
	return {};
}

/**
 * Missing / non-false means visible (current behavior).
 * @param {unknown} settings platform settings object (`{ general: { ... } }`)
 * @returns {boolean}
 */
export function isPublicFreePlanVisible(settings) {
	return readGeneral(settings).publicFreePlanVisible !== false;
}

/**
 * Return a new catalog array. When hidden, omit only slug `free`.
 * Never mutates `items`.
 * @param {unknown[]} items
 * @param {unknown} settings
 * @returns {unknown[]}
 */
export function filterPublicPlanCatalog(items, settings) {
	const list = Array.isArray(items) ? items : [];
	if (isPublicFreePlanVisible(settings)) return list.slice();
	return list.filter((item) => planSlugOf(item) !== FREE_PLAN_SLUG);
}

/**
 * Block new self-serve activations of Free while it is hidden.
 * Already-Free → Free is allowed so checkout can keep PLAN_UNCHANGED.
 * @param {{ plan?: object, currentSlug?: string, settings?: unknown }} input
 */
export function assertFreePlanSelectable({ plan, currentSlug, settings } = {}) {
	if (isPublicFreePlanVisible(settings)) return;
	if (planSlugOf(plan) !== FREE_PLAN_SLUG) return;
	const current = String(currentSlug || '').trim().toLowerCase();
	if (current === FREE_PLAN_SLUG) return;

	const error = new Error('Plan not found or unavailable');
	error.status = 404;
	error.errorCode = 'PLAN_NOT_FOUND';
	throw error;
}
