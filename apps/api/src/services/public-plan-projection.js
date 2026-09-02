/**
 * Safe public plan DTO projection — no PocketBase / listPlans dependency.
 */

import { FREE_PLAN_SLUG } from './public-free-plan-visibility.js';

function planSlugOf(plan = {}) {
	return String(plan.slug || '').trim().toLowerCase();
}

/**
 * Paid tiers suitable for the public pricing page (excludes Free / $0).
 * @param {object} plan — mapPlanDto output
 */
export function isPaidPublicPlan(plan = {}) {
	const slug = planSlugOf(plan);
	if (!slug || slug === FREE_PLAN_SLUG) return false;
	if (!plan.active) return false;
	const monthly = Number(plan.monthlyPrice ?? plan.price) || 0;
	const yearly = Number(plan.yearlyPrice) || 0;
	return monthly > 0 || yearly > 0;
}

/**
 * Safe marketing projection — no internal IDs, stats, or billing rules.
 * @param {object} plan — mapPlanDto output
 */
export function toPublicPlanDto(plan = {}) {
	const limits = plan.limits && typeof plan.limits === 'object' ? plan.limits : {};
	return {
		slug: plan.slug,
		name: plan.name,
		description: plan.description || '',
		monthlyPrice: Number(plan.monthlyPrice ?? plan.price) || 0,
		yearlyPrice: Number(plan.yearlyPrice) || 0,
		currency: plan.currency || 'USD',
		credits: Number(plan.credits) || 0,
		highlight: Boolean(plan.highlight),
		support: plan.support || '',
		publishingLimits: plan.publishingLimits || '',
		aiFeatures: plan.aiFeatures || '',
		imageLimits: plan.imageLimits || '',
		refillPolicy: plan.refillPolicy || '',
		limits: {
			articlesPerMonth: limits.articlesPerMonth,
			imagesPerMonth: limits.imagesPerMonth,
			wordpressSites: limits.wordpressSites,
			teamMembers: limits.teamMembers,
		},
	};
}
