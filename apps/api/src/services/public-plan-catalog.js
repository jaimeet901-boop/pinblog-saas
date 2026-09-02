/**
 * Public pricing catalog — read-only projection of live PocketBase plans.
 * Single source of truth: listPlans() / mapPlanDto() in plans.js.
 */

import { listPlans } from './plans.js';
import { getPlatformSettings } from './platform-settings.js';
import { filterPublicPlanCatalog } from './public-free-plan-visibility.js';
import { isPaidPublicPlan, toPublicPlanDto } from './public-plan-projection.js';

export { isPaidPublicPlan, toPublicPlanDto } from './public-plan-projection.js';

/**
 * Active paid plans for anonymous pricing page consumers.
 */
export async function getPublicPricingCatalog() {
	const [{ items }, platform] = await Promise.all([
		listPlans(),
		getPlatformSettings().catch(() => null),
	]);
	const visibilitySettings = platform?.settings || {};

	const filtered = filterPublicPlanCatalog(
		(items || []).filter((item) => item.active),
		visibilitySettings,
	)
		.filter(isPaidPublicPlan)
		.sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0));

	return {
		items: filtered.map(toPublicPlanDto),
	};
}
