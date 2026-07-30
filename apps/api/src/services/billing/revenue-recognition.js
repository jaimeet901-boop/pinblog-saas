/**
 * Revenue recognition (BP-3) — official amount priority + additive snapshots.
 * Does not redesign billing_events. Snapshots live in metadata.
 */

export const RECOGNITION_SOURCES = Object.freeze([
	'event_snapshot',
	'provider_amount',
	'catalog_price',
	'unavailable',
	'mixed',
]);

const REVENUE_EVENT_TYPES = new Set([
	'activate',
	'renew',
	'upgrade',
	'downgrade',
	'topup',
	'purchase',
	'credit_pack',
	'pack_purchase',
	'fulfill',
	'subscription_activated',
	'subscription_renewed',
	'payment_succeeded',
]);

export function isRevenueEventType(eventType) {
	const type = String(eventType || '').toLowerCase();
	if (REVENUE_EVENT_TYPES.has(type)) return true;
	if (type.includes('renew') || type.includes('topup') || type.includes('purchase')) return true;
	if (type.includes('upgrade') || type.includes('activate') && !type.includes('deactivate')) return true;
	return false;
}

function finiteAmount(value) {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Build additive snapshot fields for NEW billing event metadata.
 * Never overwrites existing snapshot keys.
 */
export function buildRevenueSnapshotMetadata({
	amount,
	currency = 'USD',
	interval = 'monthly',
	plan = null,
	pack = null,
	provider = '',
	existingMetadata = {},
} = {}) {
	const meta = { ...(existingMetadata || {}) };
	const amountSnapshot = finiteAmount(amount);
	if (amountSnapshot != null && meta.amountSnapshot == null) {
		meta.amountSnapshot = amountSnapshot;
	}
	if (meta.currencySnapshot == null && currency) {
		meta.currencySnapshot = String(currency).slice(0, 8).toUpperCase();
	}
	if (meta.intervalSnapshot == null && interval) {
		meta.intervalSnapshot = String(interval).slice(0, 32);
	}
	if (meta.planSnapshot == null && (plan || pack)) {
		meta.planSnapshot = plan
			? {
				id: plan.id || '',
				slug: plan.slug || plan.code || '',
				name: plan.name || plan.slug || '',
			}
			: {
				id: pack.id || '',
				slug: pack.id || '',
				name: pack.name || pack.id || '',
				kind: 'pack',
			};
	}
	if (meta.providerSnapshot == null && provider) {
		meta.providerSnapshot = String(provider).trim().toLowerCase();
	}
	return meta;
}

function catalogAmountForEvent(event, catalog) {
	const meta = event?.metadata || {};
	const slug = meta.planSnapshot?.slug
		|| event?.to_plan
		|| meta.toPlan
		|| meta.planSlug
		|| '';
	const packId = meta.planSnapshot?.kind === 'pack'
		? (meta.planSnapshot.slug || meta.planSnapshot.id)
		: (meta.packId || '');
	const interval = meta.intervalSnapshot || meta.interval || 'monthly';

	if (packId && catalog?.packs?.[packId]) {
		return finiteAmount(catalog.packs[packId].price);
	}
	const plan = catalog?.plans?.[slug];
	if (!plan) return null;
	if (interval === 'yearly') return finiteAmount(plan.yearlyPrice ?? (Number(plan.monthlyPrice) || 0) * 12);
	if (interval === 'one_time') return finiteAmount(plan.monthlyPrice);
	return finiteAmount(plan.monthlyPrice);
}

/**
 * Official recognition priority:
 * 1 event snapshot → 2 provider amount → 3 catalog → 4 unavailable
 */
export function resolveRecognizedAmount(event, catalog = null) {
	const meta = event?.metadata && typeof event.metadata === 'object' ? event.metadata : {};

	const snapshot = finiteAmount(meta.amountSnapshot);
	if (snapshot != null) {
		return {
			amount: snapshot,
			currency: meta.currencySnapshot || meta.currency || 'USD',
			interval: meta.intervalSnapshot || meta.interval || 'unknown',
			planSlug: meta.planSnapshot?.slug || event?.to_plan || '',
			provider: meta.providerSnapshot || meta.provider || '',
			recognitionSource: 'event_snapshot',
		};
	}

	const providerAmount = finiteAmount(
		meta.providerAmount ?? meta.chargedAmount ?? meta.amount,
	);
	if (providerAmount != null) {
		return {
			amount: providerAmount,
			currency: meta.currencySnapshot || meta.currency || 'USD',
			interval: meta.intervalSnapshot || meta.interval || 'unknown',
			planSlug: meta.planSnapshot?.slug || event?.to_plan || '',
			provider: meta.providerSnapshot || meta.provider || '',
			recognitionSource: 'provider_amount',
		};
	}

	const catalogAmount = catalogAmountForEvent(event, catalog);
	if (catalogAmount != null) {
		return {
			amount: catalogAmount,
			currency: meta.currencySnapshot || meta.currency || 'USD',
			interval: meta.intervalSnapshot || meta.interval || 'monthly',
			planSlug: meta.planSnapshot?.slug || event?.to_plan || '',
			provider: meta.providerSnapshot || meta.provider || '',
			recognitionSource: 'catalog_price',
		};
	}

	return {
		amount: null,
		currency: meta.currencySnapshot || meta.currency || 'USD',
		interval: meta.intervalSnapshot || meta.interval || 'unknown',
		planSlug: meta.planSnapshot?.slug || event?.to_plan || '',
		provider: meta.providerSnapshot || meta.provider || '',
		recognitionSource: 'unavailable',
	};
}

export function mergeRecognitionSources(sources = []) {
	const set = new Set(sources.filter(Boolean));
	if (set.size === 0) return 'unavailable';
	if (set.size === 1) return [...set][0];
	if (set.has('unavailable') && set.size === 1) return 'unavailable';
	const meaningful = [...set].filter((s) => s !== 'unavailable');
	if (meaningful.length === 0) return 'unavailable';
	if (meaningful.length === 1) return meaningful[0];
	return 'mixed';
}

export function emptySourceBreakdown() {
	return {
		event_snapshot: 0,
		provider_amount: 0,
		catalog_price: 0,
		unavailable: 0,
	};
}

export function addToBreakdown(breakdown, source, amount = 0) {
	const key = RECOGNITION_SOURCES.includes(source) && source !== 'mixed' ? source : 'unavailable';
	breakdown[key] = (Number(breakdown[key]) || 0) + (Number(amount) || 0);
	return breakdown;
}
