#!/usr/bin/env node
/**
 * PayPal Sandbox catalog sync — list / verify / create monthly subscription plans.
 *
 * READ credentials from environment only (never commit secrets):
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE=sandbox
 *
 * Usage (from apps/api):
 *   node scripts/paypal-sandbox-catalog.mjs --dry-run
 *   node scripts/paypal-sandbox-catalog.mjs --create-missing
 *
 * Does NOT touch Live mode. Aborts if PAYPAL_MODE=live unless --force-live (blocked).
 */
import { PLAN_SEED_CATALOG } from '../src/services/plan-catalog.js';
import { resolvePayPalApiBase } from '../src/services/billing/providers/paypal.js';

const HTTP_TIMEOUT_MS = 20000;
const KNOWN_PLAN_IDS = Object.freeze({
	starter: 'P-8MW88604366870048NJ35YUI',
	pro: 'P-6E353972W0980984BNJ36Q7A',
});

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || !args.has('--create-missing');
const mode = String(process.env.PAYPAL_MODE || 'sandbox').trim().toLowerCase();

if (mode === 'live' && !args.has('--force-live')) {
	console.error('ERROR: Refusing to run against PayPal Live. Set PAYPAL_MODE=sandbox.');
	process.exit(1);
}

const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim();
const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
if (!clientId || !clientSecret) {
	console.error('ERROR: Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in environment.');
	process.exit(1);
}

const apiBase = resolvePayPalApiBase(mode === 'live' ? 'live' : 'sandbox');

const paidPlans = PLAN_SEED_CATALOG
	.filter((plan) => Number(plan.monthly_price) > 0)
	.map((plan) => ({
		slug: plan.slug,
		name: plan.name,
		planName: `${plan.name} Monthly`,
		monthlyPrice: Number(plan.monthly_price),
		currency: plan.currency || 'USD',
		knownPlanId: KNOWN_PLAN_IDS[plan.slug] || '',
	}));

async function paypalFetch(path, options = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
	try {
		const response = await fetch(`${apiBase}${path}`, { ...options, signal: controller.signal });
		const data = await response.json().catch(() => ({}));
		return { response, data };
	} finally {
		clearTimeout(timer);
	}
}

async function getAccessToken() {
	const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
	const { response, data } = await paypalFetch('/v1/oauth2/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${credentials}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: 'grant_type=client_credentials',
	});
	if (!response.ok || !data?.access_token) {
		throw new Error(data?.error_description || data?.message || `OAuth failed (${response.status})`);
	}
	return data.access_token;
}

async function listAllPlans(accessToken) {
	const plans = [];
	let page = 1;
	let totalPages = 1;
	while (page <= totalPages) {
		const { response, data } = await paypalFetch(
			`/v1/billing/plans?page_size=20&page=${page}&total_required=true`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: 'application/json',
				},
			},
		);
		if (!response.ok) {
			throw new Error(data?.message || `List plans failed (${response.status})`);
		}
		plans.push(...(Array.isArray(data?.plans) ? data.plans : []));
		totalPages = Number(data?.total_pages) || 1;
		page += 1;
	}
	return plans;
}

async function getPlanDetails(accessToken, planId) {
	const { response, data } = await paypalFetch(
		`/v1/billing/plans/${encodeURIComponent(planId)}`,
		{
			method: 'GET',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: 'application/json',
			},
		},
	);
	if (!response.ok) {
		throw new Error(data?.message || `Get plan ${planId} failed (${response.status})`);
	}
	return data;
}

function extractMonthlyPrice(plan) {
	const cycle = Array.isArray(plan?.billing_cycles) ? plan.billing_cycles[0] : null;
	const value = cycle?.pricing_scheme?.fixed_price?.value;
	const currency = cycle?.pricing_scheme?.fixed_price?.currency_code || 'USD';
	const totalCycles = cycle?.total_cycles;
	return {
		value: value != null ? Number(value) : null,
		currency,
		unlimited: totalCycles === 0,
		status: plan?.status || '',
		name: plan?.name || '',
	};
}

function matchesCatalog(planDetails, catalogEntry) {
	const price = extractMonthlyPrice(planDetails);
	if (price.value !== catalogEntry.monthlyPrice) return false;
	if (price.currency !== catalogEntry.currency) return false;
	if (!price.unlimited) return false;
	const normalizedName = String(planDetails?.name || '').trim().toLowerCase();
	const expected = catalogEntry.planName.toLowerCase();
	return normalizedName === expected || normalizedName.includes(catalogEntry.slug);
}

async function createProduct(accessToken, catalogEntry) {
	const { response, data } = await paypalFetch('/v1/catalogs/products', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			name: `PinBlog ${catalogEntry.name}`,
			description: `${catalogEntry.planName} subscription`,
			type: 'SERVICE',
			category: 'SOFTWARE',
		}),
	});
	if (!response.ok) {
		throw new Error(data?.message || `Create product failed (${response.status})`);
	}
	return data.id;
}

async function createPlan(accessToken, catalogEntry, productId) {
	const price = catalogEntry.monthlyPrice.toFixed(2);
	const { response, data } = await paypalFetch('/v1/billing/plans', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			product_id: productId,
			name: catalogEntry.planName,
			description: `${catalogEntry.planName} — $${catalogEntry.monthlyPrice}/mo`,
			billing_cycles: [{
				frequency: { interval_unit: 'MONTH', interval_count: 1 },
				tenure_type: 'REGULAR',
				sequence: 1,
				total_cycles: 0,
				pricing_scheme: {
					fixed_price: {
						value: price,
						currency_code: catalogEntry.currency,
					},
				},
			}],
			payment_preferences: {
				auto_bill_outstanding: true,
				setup_fee_failure_action: 'CONTINUE',
				payment_failure_threshold: 3,
			},
		}),
	});
	if (!response.ok) {
		throw new Error(data?.message || `Create plan failed (${response.status})`);
	}
	return data.id;
}

async function activatePlan(accessToken, planId) {
	const { response, data } = await paypalFetch(
		`/v1/billing/plans/${encodeURIComponent(planId)}/activate`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
		},
	);
	if (!response.ok && response.status !== 422) {
		throw new Error(data?.message || `Activate plan ${planId} failed (${response.status})`);
	}
}

const accessToken = await getAccessToken();
const listedPlans = await listAllPlans(accessToken);
const report = {
	mode: mode === 'live' ? 'live' : 'sandbox',
	dryRun,
	applicationPlans: paidPlans,
	discovered: [],
	actions: [],
	mapping: {},
};

for (const catalogEntry of paidPlans) {
	let matched = null;
	let matchedDetails = null;

	if (catalogEntry.knownPlanId) {
		try {
			const details = await getPlanDetails(accessToken, catalogEntry.knownPlanId);
			if (matchesCatalog(details, catalogEntry)) {
				matched = catalogEntry.knownPlanId;
				matchedDetails = details;
			} else {
				report.actions.push({
					slug: catalogEntry.slug,
					action: 'known_id_mismatch',
					planId: catalogEntry.knownPlanId,
					details: extractMonthlyPrice(details),
				});
			}
		} catch (error) {
			report.actions.push({
				slug: catalogEntry.slug,
				action: 'known_id_lookup_failed',
				planId: catalogEntry.knownPlanId,
				error: error.message,
			});
		}
	}

	if (!matched) {
		for (const summary of listedPlans) {
			const details = summary?.id ? await getPlanDetails(accessToken, summary.id) : summary;
			if (matchesCatalog(details, catalogEntry)) {
				matched = details.id;
				matchedDetails = details;
				break;
			}
		}
	}

	if (matched && matchedDetails) {
		const price = extractMonthlyPrice(matchedDetails);
		report.discovered.push({
			slug: catalogEntry.slug,
			planId: matched,
			name: matchedDetails.name,
			status: price.status,
			monthlyPrice: price.value,
			currency: price.currency,
			unlimited: price.unlimited,
			source: catalogEntry.knownPlanId === matched ? 'known_id' : 'search',
		});
		report.mapping[catalogEntry.slug] = matched;
		continue;
	}

	if (dryRun) {
		report.actions.push({
			slug: catalogEntry.slug,
			action: 'would_create',
			planName: catalogEntry.planName,
			monthlyPrice: catalogEntry.monthlyPrice,
		});
		continue;
	}

	const productId = await createProduct(accessToken, catalogEntry);
	const planId = await createPlan(accessToken, catalogEntry, productId);
	await activatePlan(accessToken, planId);
	const details = await getPlanDetails(accessToken, planId);
	const price = extractMonthlyPrice(details);
	report.actions.push({
		slug: catalogEntry.slug,
		action: 'created',
		planId,
		productId,
		status: price.status,
	});
	report.discovered.push({
		slug: catalogEntry.slug,
		planId,
		name: details.name,
		status: price.status,
		monthlyPrice: price.value,
		currency: price.currency,
		unlimited: price.unlimited,
		source: 'created',
	});
	report.mapping[catalogEntry.slug] = planId;
}

report.recommendedPlatformSettings = {
	defaultPlanId: report.mapping.starter || KNOWN_PLAN_IDS.starter,
	planIds: report.mapping,
};

console.log(JSON.stringify(report, null, 2));
