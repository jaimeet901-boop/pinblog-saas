/**
 * Revenue aggregation (BP-3) — derives KPIs from existing runtime collections.
 * No second billing database. Uses official recognition priority.
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { listPlans } from '../plans.js';
import { listCreditPacks } from './payg.js';
import {
	addToBreakdown,
	emptySourceBreakdown,
	isRevenueEventType,
	mergeRecognitionSources,
	resolveRecognizedAmount,
} from './revenue-recognition.js';

function monthKey(date) {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseRange(query = {}) {
	const to = query.to ? new Date(query.to) : new Date();
	const from = query.from
		? new Date(query.from)
		: new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
	return {
		from: Number.isNaN(from.getTime()) ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1)) : from,
		to: Number.isNaN(to.getTime()) ? new Date() : to,
	};
}

async function loadCatalogMaps() {
	const [plans, packs] = await Promise.all([
		listPlans().catch(() => ({ items: [] })),
		listCreditPacks().catch(() => ({ items: [] })),
	]);
	const planMap = {};
	for (const plan of plans.items || []) {
		planMap[plan.slug] = {
			monthlyPrice: Number(plan.monthlyPrice ?? plan.price) || 0,
			yearlyPrice: Number(plan.yearlyPrice) || ((Number(plan.monthlyPrice ?? plan.price) || 0) * 12),
			name: plan.name,
		};
	}
	const packMap = {};
	for (const pack of packs.items || []) {
		packMap[pack.id] = {
			price: Number(pack.price) || 0,
			name: pack.name,
			currency: pack.currency || 'USD',
		};
	}
	return { plans: planMap, packs: packMap };
}

async function listBillingEventsInRange({ from, to, provider = '', pageSize = 100 } = {}) {
	const items = [];
	let page = 1;
	const maxPages = 50;
	const fromIso = from.toISOString();
	const toIso = to.toISOString();

	while (page <= maxPages) {
		const result = await pocketbaseClient.collection('billing_events').getList(page, pageSize, {
			filter: pocketbaseClient.filter('occurred_at >= {:from} && occurred_at <= {:to}', { from: fromIso, to: toIso }),
			sort: '-occurred_at',
			requestKey: null,
		}).catch(() => ({ items: [], totalPages: 0 }));

		items.push(...(result.items || []));
		if (!result.totalPages || page >= result.totalPages) break;
		page += 1;
	}

	if (!provider) return items;
	const code = String(provider).toLowerCase();
	return items.filter((row) => {
		const meta = row.metadata || {};
		return String(meta.providerSnapshot || meta.provider || '').toLowerCase() === code;
	});
}

async function listSubscriptionsSample(limit = 500) {
	const result = await pocketbaseClient.collection('workspace_subscriptions').getList(1, Math.min(500, limit), {
		expand: 'plan',
		requestKey: null,
	}).catch(() => ({ items: [] }));
	return result.items || [];
}

function monthlyValueFromSubscription(sub, catalog) {
	const plan = sub.expand?.plan;
	const slug = plan?.slug || '';
	const catalogPlan = catalog.plans[slug];
	const monthly = Number(plan?.monthly_price ?? catalogPlan?.monthlyPrice) || 0;
	const yearly = Number(plan?.yearly_price ?? catalogPlan?.yearlyPrice) || 0;
	// Prefer monthly; if only yearly known, normalize
	if (monthly > 0) return monthly;
	if (yearly > 0) return yearly / 12;
	return 0;
}

/**
 * Live MRR from current subscriptions (catalog-based live book).
 */
export async function computeLiveMrr() {
	const catalog = await loadCatalogMaps();
	const subs = await listSubscriptionsSample(500);
	let mrr = 0;
	let active = 0;
	let trialing = 0;
	let cancelled = 0;
	const sources = [];

	for (const sub of subs) {
		const status = String(sub.status || sub.billing_status || '').toLowerCase();
		if (status === 'trialing') trialing += 1;
		if (status === 'canceled' || status === 'cancelled' || status === 'expired') cancelled += 1;
		if (status !== 'active' && status !== 'trialing') continue;
		const value = monthlyValueFromSubscription(sub, catalog);
		if (value <= 0) continue;
		active += 1;
		mrr += value;
		sources.push('catalog_price');
	}

	return {
		liveMrr: Number(mrr.toFixed(2)),
		arr: Number((mrr * 12).toFixed(2)),
		activeSubscriptions: active,
		trialingSubscriptions: trialing,
		cancelledSubscriptions: cancelled,
		recognitionSource: mergeRecognitionSources(sources.length ? sources : ['unavailable']),
		book: 'live',
		label: 'Live MRR (catalog)',
		sampledSubscriptions: subs.length,
	};
}

/**
 * Historical period revenue from billing_events via official priority.
 */
export async function computePeriodRevenue(query = {}) {
	const { from, to } = parseRange(query);
	const catalog = await loadCatalogMaps();
	const events = await listBillingEventsInRange({ from, to, provider: query.provider || '' });
	const breakdown = emptySourceBreakdown();
	const sources = [];
	let revenue = 0;
	let recognizedEvents = 0;
	let unavailableEvents = 0;

	const byProvider = {};
	const byPlan = {};
	const byMonth = {};

	for (const event of events) {
		if (!isRevenueEventType(event.event_type)) continue;
		const recognized = resolveRecognizedAmount(event, catalog);
		sources.push(recognized.recognitionSource);
		addToBreakdown(breakdown, recognized.recognitionSource, recognized.amount || 0);

		if (recognized.recognitionSource === 'unavailable' || recognized.amount == null) {
			unavailableEvents += 1;
			continue;
		}

		recognizedEvents += 1;
		revenue += recognized.amount;

		const provider = recognized.provider || event.metadata?.provider || 'unknown';
		byProvider[provider] = byProvider[provider] || { provider, revenue: 0, count: 0 };
		byProvider[provider].revenue += recognized.amount;
		byProvider[provider].count += 1;

		const planSlug = recognized.planSlug || event.to_plan || 'unknown';
		byPlan[planSlug] = byPlan[planSlug] || { planSlug, revenue: 0, count: 0 };
		byPlan[planSlug].revenue += recognized.amount;
		byPlan[planSlug].count += 1;

		const occurred = new Date(event.occurred_at || event.created);
		const key = monthKey(Number.isNaN(occurred.getTime()) ? new Date() : occurred);
		byMonth[key] = byMonth[key] || { period: key, revenue: 0, count: 0 };
		byMonth[key].revenue += recognized.amount;
		byMonth[key].count += 1;
	}

	const providerItems = Object.values(byProvider).map((row) => ({
		...row,
		revenue: Number(row.revenue.toFixed(2)),
		share: revenue > 0 ? Number(((row.revenue / revenue) * 100).toFixed(2)) : 0,
	})).sort((a, b) => b.revenue - a.revenue);

	return {
		book: 'historical',
		label: 'Historical Revenue',
		from: from.toISOString(),
		to: to.toISOString(),
		revenue: Number(revenue.toFixed(2)),
		recognizedEvents,
		unavailableEvents,
		recognitionSource: mergeRecognitionSources(sources),
		recognitionSourceBreakdown: breakdown,
		byProvider: providerItems,
		byPlan: Object.values(byPlan).map((row) => ({
			...row,
			revenue: Number(row.revenue.toFixed(2)),
		})).sort((a, b) => b.revenue - a.revenue),
		byPeriod: Object.values(byMonth).sort((a, b) => a.period.localeCompare(b.period)).map((row) => ({
			...row,
			revenue: Number(row.revenue.toFixed(2)),
		})),
	};
}

export async function getRevenueSummary(query = {}) {
	const [live, historical] = await Promise.all([
		computeLiveMrr(),
		computePeriodRevenue(query),
	]);

	const { from, to } = parseRange(query);
	const events = await listBillingEventsInRange({ from, to });
	const newSubs = events.filter((e) => /activate|new_subscription|subscription_activated/i.test(String(e.event_type || ''))).length;
	const cancelled = events.filter((e) => /cancel/i.test(String(e.event_type || ''))).length;
	const failed = events.filter((e) => /fail|payment_failed/i.test(String(e.event_type || ''))).length;
	const refunds = events.filter((e) => /refund/i.test(String(e.event_type || ''))).length;

	return {
		liveMrr: live.liveMrr,
		arr: live.arr,
		liveMrrRecognitionSource: live.recognitionSource,
		liveBookLabel: live.label,
		historicalRevenue: historical.revenue,
		historicalRecognitionSource: historical.recognitionSource,
		historicalBookLabel: historical.label,
		recognitionSourceBreakdown: historical.recognitionSourceBreakdown,
		activeSubscriptions: live.activeSubscriptions,
		trialingSubscriptions: live.trialingSubscriptions,
		cancelledSubscriptions: live.cancelledSubscriptions,
		newSubscriptions: newSubs,
		cancelledInPeriod: cancelled,
		failedPayments: failed,
		refunds,
		from: historical.from,
		to: historical.to,
		providerShare: historical.byProvider,
	};
}

export async function getRevenueByProvider(query = {}) {
	const historical = await computePeriodRevenue(query);
	return {
		book: 'historical',
		recognitionSource: historical.recognitionSource,
		recognitionSourceBreakdown: historical.recognitionSourceBreakdown,
		items: historical.byProvider,
		from: historical.from,
		to: historical.to,
		totalRevenue: historical.revenue,
	};
}

export async function getRevenueByPlan(query = {}) {
	const historical = await computePeriodRevenue(query);
	return {
		book: 'historical',
		recognitionSource: historical.recognitionSource,
		recognitionSourceBreakdown: historical.recognitionSourceBreakdown,
		items: historical.byPlan,
		from: historical.from,
		to: historical.to,
		totalRevenue: historical.revenue,
	};
}

export async function getRevenueByPeriod(query = {}) {
	const historical = await computePeriodRevenue(query);
	return {
		book: 'historical',
		recognitionSource: historical.recognitionSource,
		recognitionSourceBreakdown: historical.recognitionSourceBreakdown,
		items: historical.byPeriod,
		from: historical.from,
		to: historical.to,
		totalRevenue: historical.revenue,
	};
}

export async function getRevenueTrends(query = {}) {
	const byPeriod = await getRevenueByPeriod(query);
	return {
		...byPeriod,
		series: byPeriod.items.map((item) => ({
			period: item.period,
			revenue: item.revenue,
			count: item.count,
		})),
	};
}

export async function getRevenueConversions(query = {}) {
	const { from, to } = parseRange(query);
	const events = await listBillingEventsInRange({ from, to });
	const checkouts = events.filter((e) => /checkout/i.test(String(e.event_type || e.message || ''))).length;
	const activations = events.filter((e) => /activate|subscription_activated/i.test(String(e.event_type || ''))).length;
	const rate = checkouts > 0 ? Number(((activations / checkouts) * 100).toFixed(2)) : null;
	return {
		from: from.toISOString(),
		to: to.toISOString(),
		checkoutSignals: checkouts,
		activations,
		conversionRatePercent: rate,
		recognitionSource: 'unavailable',
		note: 'Approximate from billing_events signals only — not a second payment ledger.',
	};
}
