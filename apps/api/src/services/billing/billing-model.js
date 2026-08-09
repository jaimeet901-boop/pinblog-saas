/**
 * Paddle Billing Rewrite — Phase 1 billing model constants and validators.
 *
 * Schema-only foundation. Runtime checkout/webhook behavior is unchanged in Phase 1.
 */

export const PLAN_BILLING_TYPES = Object.freeze(['free', 'paid']);

export const BILLING_INTERVALS = Object.freeze(['monthly', 'yearly']);

export const BILLING_ENVIRONMENTS = Object.freeze(['sandbox', 'live']);

export const ACTIVATION_SOURCES = Object.freeze([
	'paddle_webhook',
	'admin_override',
	'free',
	'seed',
	'scheduler',
]);

export const BILLING_SOURCES = Object.freeze([
	'paddle',
	'admin_override',
	'free',
	'seed',
	'system',
]);

export const REGISTRY_INTERVALS = Object.freeze(['monthly', 'yearly', 'one_time']);

export const REGISTRY_PROVIDERS = Object.freeze(['stripe', 'paddle', 'lemonsqueezy', 'paypal']);

export const WEBHOOK_EVENT_STATUSES = Object.freeze([
	'received',
	'processing',
	'processed',
	'failed',
	'ignored',
	'duplicate',
]);

/** Known paid catalog slugs — used when price fields are zero to avoid classifying paid plans as free. */
export const PAID_CATALOG_SLUGS = Object.freeze(['starter', 'pro', 'business', 'enterprise']);

function isAllowed(value, allowed) {
	return allowed.includes(String(value || '').trim());
}

/**
 * Infer billing_type for seeding, DTO display, and verification fallbacks only.
 * Do NOT use for checkout/change paid-vs-free gates — use resolveAuthoritativePlanBillingType().
 */
export function resolveBillingTypeFromPlan(plan = {}) {
	const slug = String(plan.slug || '').trim().toLowerCase();
	const monthly = Number(plan.monthly_price ?? plan.monthlyPrice) || 0;
	const yearly = Number(plan.yearly_price ?? plan.yearlyPrice) || 0;

	if (slug === 'free') return 'free';
	if (monthly > 0 || yearly > 0) return 'paid';
	if (PAID_CATALOG_SLUGS.includes(slug)) return 'paid';
	return 'free';
}

/**
 * Authoritative billing type for checkout/change gates (Phase 4.1).
 * Uses plans.billing_type only — no price, slug, or credit inference.
 * Fail-closed when missing or invalid.
 */
export function resolveAuthoritativePlanBillingType(plan = {}) {
	const raw = plan.billing_type ?? plan.billingType;
	if (raw == null || String(raw).trim() === '') {
		return { ok: false, error: 'missing_plan_billing_type' };
	}
	return validatePlanBillingType(String(raw).trim());
}

/**
 * Whether a plan requires paid provider checkout (Phase 4.1).
 * Returns { ok, requiresPaidCheckout, billingType } or { ok: false, error }.
 */
export function planRequiresPaidCheckout(plan = {}) {
	const resolved = resolveAuthoritativePlanBillingType(plan);
	if (!resolved.ok) {
		return resolved;
	}
	return {
		ok: true,
		requiresPaidCheckout: resolved.value === 'paid',
		billingType: resolved.value,
	};
}

export function validatePlanBillingType(value) {
	if (!isAllowed(value, PLAN_BILLING_TYPES)) {
		return { ok: false, error: 'invalid_plan_billing_type', value };
	}
	return { ok: true, value };
}

export function validateBillingInterval(value, { allowEmpty = true } = {}) {
	const normalized = String(value || '').trim().toLowerCase();
	if (!normalized) {
		return allowEmpty ? { ok: true, value: '' } : { ok: false, error: 'missing_billing_interval' };
	}
	if (!isAllowed(normalized, BILLING_INTERVALS)) {
		return { ok: false, error: 'invalid_billing_interval', value: normalized };
	}
	return { ok: true, value: normalized };
}

export function validateBillingEnvironment(value, { allowEmpty = true } = {}) {
	const normalized = String(value || '').trim();
	if (!normalized) {
		return allowEmpty ? { ok: true, value: '' } : { ok: false, error: 'missing_billing_environment' };
	}
	if (!isAllowed(normalized, BILLING_ENVIRONMENTS)) {
		return { ok: false, error: 'invalid_billing_environment', value: normalized };
	}
	return { ok: true, value: normalized };
}

export function validateActivationSource(value, { allowEmpty = true } = {}) {
	const normalized = String(value || '').trim();
	if (!normalized) {
		return allowEmpty ? { ok: true, value: '' } : { ok: false, error: 'missing_activation_source' };
	}
	if (!isAllowed(normalized, ACTIVATION_SOURCES)) {
		return { ok: false, error: 'invalid_activation_source', value: normalized };
	}
	return { ok: true, value: normalized };
}

export function validateBillingSource(value, { allowEmpty = true } = {}) {
	const normalized = String(value || '').trim();
	if (!normalized) {
		return allowEmpty ? { ok: true, value: '' } : { ok: false, error: 'missing_billing_source' };
	}
	if (!isAllowed(normalized, BILLING_SOURCES)) {
		return { ok: false, error: 'invalid_billing_source', value: normalized };
	}
	return { ok: true, value: normalized };
}

/**
 * Derive explicit billing_environment from control-plane Paddle config (model only — Phase 1).
 * Does NOT replace runtime API host selection.
 */
export function deriveBillingEnvironmentFromPaddleConfig(config = {}) {
	if (config.sandbox === true || process.env.PADDLE_SANDBOX === '1') {
		return 'sandbox';
	}
	if (config.mode === 'live') return 'live';
	if (config.mode === 'test') return 'sandbox';
	return '';
}
