/**
 * Shared subscription plan-card mapping — used by SubscriptionPage and UpgradeModal.
 * Plan prices/features come from GET /workspace/v1/subscription (payload.plans).
 */

/** Shown when API catalog does not yet include these tiers (same as SubscriptionPage). */
export const PLACEHOLDER_PLANS = Object.freeze([
	{
		id: 'business',
		name: 'Business',
		price: null,
		monthlyPrice: null,
		yearlyPrice: null,
		credits: 'Custom',
		items: ['Higher volume credits', 'Multi-brand workspaces', 'Advanced analytics', 'Priority onboarding'],
		popular: false,
		placeholder: true,
	},
	{
		id: 'enterprise',
		name: 'Enterprise',
		price: null,
		monthlyPrice: null,
		yearlyPrice: null,
		credits: 'Custom',
		items: ['Custom SLAs', 'SSO & security controls', 'Dedicated success manager', 'Custom integrations'],
		popular: false,
		placeholder: true,
	},
]);

export function planItemsFromDto(plan = {}) {
	const limits = plan.limits || {};
	return [
		`${limits.articlesPerMonth >= 999999 ? 'Unlimited' : (limits.articlesPerMonth || plan.credits || 0)} articles / month`,
		`${limits.wordpressSites >= 999999 ? 'Unlimited' : (limits.wordpressSites || 1)} website${(limits.wordpressSites || 1) === 1 ? '' : 's'}`,
		`${limits.imagesPerMonth >= 999999 ? 'Unlimited' : (limits.imagesPerMonth || 0)} images`,
		plan.support || 'Support included',
	];
}

export function formatUsd(amount) {
	const value = Number(amount);
	if (!Number.isFinite(value)) return '$0';
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0,
	}).format(value);
}

export function mapPlanCard(plan) {
	const monthlyPrice = Number(plan.monthlyPrice ?? plan.price);
	const yearlyPrice = Number(plan.yearlyPrice);
	return {
		id: plan.slug || plan.id,
		planId: plan.id,
		name: plan.name,
		monthlyPrice: Number.isFinite(monthlyPrice) ? monthlyPrice : 0,
		yearlyPrice: Number.isFinite(yearlyPrice) ? yearlyPrice : 0,
		price: Number.isFinite(monthlyPrice) ? monthlyPrice : 0,
		credits: plan.credits,
		popular: Boolean(plan.highlight),
		items: planItemsFromDto(plan),
		placeholder: false,
		features: plan.features || {},
	};
}

export function planPriceDisplay(plan, billingInterval = 'monthly') {
	if (plan?.placeholder) {
		return { amountLabel: 'Custom', periodLabel: '' };
	}
	const monthlyPrice = plan?.monthlyPrice ?? plan?.price;
	const yearlyPrice = plan?.yearlyPrice;
	if (monthlyPrice == null && yearlyPrice == null) {
		return { amountLabel: 'Custom', periodLabel: '' };
	}
	const amount = billingInterval === 'yearly'
		? (Number(yearlyPrice) || Number(monthlyPrice) || 0)
		: (Number(monthlyPrice) || 0);
	return {
		amountLabel: formatUsd(amount),
		periodLabel: billingInterval === 'yearly' ? '/yr' : '/mo',
	};
}

/**
 * Merge API plan cards with Business/Enterprise placeholders when missing.
 * @param {Array} mappedPlans — already mapPlanCard()'d
 */
export function mergePlanCardsWithPlaceholders(mappedPlans = []) {
	const list = Array.isArray(mappedPlans) ? mappedPlans : [];
	const seen = new Set(list.map((plan) => String(plan.id || '').toLowerCase()));
	const extras = PLACEHOLDER_PLANS.filter((plan) => !seen.has(String(plan.id).toLowerCase()));
	return [...list, ...extras];
}

/**
 * Paid upgrade candidates for the modal (exclude Free + current plan).
 * Ensures Pro is marked Most Popular when API highlight is absent.
 */
export function buildUpgradeModalPlanCards(rawPlans = [], { currentPlanSlug = 'free' } = {}) {
	const current = String(currentPlanSlug || 'free').trim().toLowerCase();
	const mapped = (Array.isArray(rawPlans) ? rawPlans : [])
		.map(mapPlanCard)
		.filter((plan) => {
			const id = String(plan.id || '').trim().toLowerCase();
			if (!id || id === 'free') return false;
			if (id === current) return false;
			return true;
		});

	const merged = mergePlanCardsWithPlaceholders(mapped).filter((plan) => {
		const id = String(plan.id || '').trim().toLowerCase();
		return id && id !== 'free' && id !== current;
	});

	const hasPopular = merged.some((plan) => plan.popular);
	if (hasPopular) return merged;

	return merged.map((plan) => (
		String(plan.id).toLowerCase() === 'pro'
			? { ...plan, popular: true }
			: plan
	));
}

/**
 * Paid plan cards for the public /pricing page (live catalog only — no placeholders).
 */
export function buildPublicPricingPlanCards(rawPlans = []) {
	const mapped = (Array.isArray(rawPlans) ? rawPlans : [])
		.map(mapPlanCard)
		.filter((plan) => {
			const id = String(plan.id || '').trim().toLowerCase();
			return id && id !== 'free' && !plan.placeholder;
		});

	const hasPopular = mapped.some((plan) => plan.popular);
	if (hasPopular) return mapped;

	return mapped.map((plan) => (
		String(plan.id).toLowerCase() === 'pro'
			? { ...plan, popular: true }
			: plan
	));
}

/**
 * Start the same checkout used by SubscriptionPage.
 * @returns {Promise<{ status: string, checkoutUrl?: string, payload?: object, message?: string, errorCode?: string, httpStatus?: number }>}
 */
export async function startSubscriptionCheckout({
	planSlug,
	billingInterval = 'monthly',
	fetchFn,
} = {}) {
	const slug = String(planSlug || '').trim();
	if (!slug) {
		return { status: 'error', message: 'Plan is required' };
	}
	if (typeof fetchFn !== 'function') {
		return { status: 'error', message: 'Checkout client is unavailable' };
	}

	const origin = typeof window !== 'undefined' ? window.location.origin : '';
	const response = await fetchFn('/workspace/v1/subscription/checkout', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			planSlug: slug,
			billingInterval,
			successUrl: origin ? `${origin}/app/subscription?checkout=success` : '',
			cancelUrl: origin ? `${origin}/app/subscription?checkout=cancel` : '',
		}),
	});
	const payload = await response.json().catch(() => ({}));

	if (!response.ok) {
		return {
			status: 'error',
			httpStatus: response.status,
			errorCode: payload.errorCode || '',
			message: payload.message || 'Could not start billing',
			payload,
		};
	}

	if (payload.status === 'billing_unavailable') {
		return { status: 'billing_unavailable', payload, message: payload.message };
	}
	if (payload.status === 'activated') {
		return { status: 'activated', payload };
	}
	if (payload.status === 'checkout_pending') {
		const checkoutUrl = payload.checkoutUrl || payload.checkout?.checkoutUrl || '';
		return {
			status: checkoutUrl ? 'checkout_pending' : 'checkout_unavailable',
			checkoutUrl: checkoutUrl || undefined,
			payload,
			message: payload.message,
		};
	}
	if (payload.status === 'checkout_unavailable') {
		return { status: 'checkout_unavailable', payload, message: payload.message };
	}

	return { status: 'billing_unavailable', payload, message: payload.message };
}
