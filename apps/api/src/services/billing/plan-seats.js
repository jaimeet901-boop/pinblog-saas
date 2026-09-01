/**
 * Resolve workspace seat limits from authoritative plan.limits.teamMembers.
 */

const ENTERPRISE_UNLIMITED = 999999;

function readTeamMembersLimit(plan = {}) {
	const limits = plan?.limits && typeof plan.limits === 'object' ? plan.limits : {};
	const raw = Number(limits.teamMembers);
	if (!Number.isFinite(raw) || raw < 1) return null;
	return Math.floor(raw);
}

/**
 * Seat limit for a plan record (catalog / PocketBase plans collection).
 * @param {object} plan
 * @returns {number}
 */
export function resolvePlanSeatLimit(plan = {}) {
	const fromLimits = readTeamMembersLimit(plan);
	if (fromLimits != null) return fromLimits;
	return 1;
}

export function isEnterpriseUnlimitedSeatLimit(seats) {
	return Number(seats) >= ENTERPRISE_UNLIMITED;
}

/**
 * Normal plan assignment — seats follow plan teamMembers (not member count).
 * @param {object} plan
 * @returns {number}
 */
export function seatsForPlanAssignment(plan = {}) {
	return resolvePlanSeatLimit(plan);
}

/**
 * Admin override path — explicit seats allowed, floored at activeMemberCount
 * so we never create a destructive limit below current usage.
 * @param {object} plan
 * @param {{ adminOverrideSeats?: number|string|null, activeMemberCount?: number }} [options]
 * @returns {number}
 */
export function seatsForAdminPlanAssignment(plan = {}, {
	adminOverrideSeats = null,
	activeMemberCount = 0,
} = {}) {
	const override = Number(adminOverrideSeats);
	const used = Math.max(0, Math.floor(Number(activeMemberCount) || 0));
	if (Number.isFinite(override) && override >= 1) {
		return Math.max(Math.floor(override), used);
	}
	return seatsForPlanAssignment(plan);
}

/**
 * One-time reconciliation — align stale subscription.seats to plan limit.
 * Does not preserve stale values above plan limit (unless documented admin override
 * is passed via options.preserveSeatsWhenHigher).
 * @param {object} plan
 * @param {{ currentSeats?: number, preserveSeatsWhenHigher?: boolean }} [options]
 * @returns {number|null} null when plan cannot be resolved
 */
export function seatsForReconciliation(plan = {}, {
	currentSeats = null,
	preserveSeatsWhenHigher = false,
} = {}) {
	if (!plan || typeof plan !== 'object') return null;
	const planLimit = resolvePlanSeatLimit(plan);
	const current = Number(currentSeats);
	if (preserveSeatsWhenHigher && Number.isFinite(current) && current > planLimit) {
		return Math.floor(current);
	}
	return planLimit;
}

export { ENTERPRISE_UNLIMITED };
