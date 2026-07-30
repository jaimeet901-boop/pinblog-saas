/**
 * Price Mapping Control Plane (BP-3).
 * Binds internal plans/packs to provider price IDs. Does not change BillingProvider.
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { listPlans } from '../plans.js';
import { listCreditPacks } from './payg.js';
import {
	getRawBillingPayload,
	invalidateBillingRequestCache,
	writeControlPlaneAudit,
} from './control-plane.js';
import {
	MAPPING_PROVIDERS,
	normalizePackMapping,
	normalizePlanMapping,
	normalizePriceMappings,
	validatePriceMappings,
} from './price-mapping-helpers.js';

export {
	normalizePriceMappings,
	validatePriceMappings,
	MAPPING_PROVIDERS,
} from './price-mapping-helpers.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

async function getSettingsRow() {
	return pocketbaseClient.collection('platform_settings').getFirstListItem(
		pocketbaseClient.filter('config_key = {:key}', { key: 'platform' }),
		{ requestKey: null },
	).catch(() => null);
}

async function persistMappings(nextMappings, actor = {}, { expectedUpdatedAt = null } = {}) {
	const row = await getSettingsRow();
	if (!row) throw httpError(500, 'Platform settings are not initialized.', 'SETTINGS_MISSING');
	if (expectedUpdatedAt && row.updated && String(row.updated) !== String(expectedUpdatedAt)) {
		throw httpError(409, 'Billing configuration changed. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
	}

	const payload = structuredClone(row.payload || {});
	payload.billing = payload.billing || {};
	payload.billing.priceMappings = nextMappings;

	const saved = await pocketbaseClient.collection('platform_settings').update(row.id, {
		config_key: 'platform',
		payload,
		version: row.version || 'v1',
		meta: {
			...(row.meta || {}),
			updatedBy: actor.email || actor.id || 'admin',
			updatedAt: new Date().toISOString(),
			billingControlPlane: true,
		},
	});
	invalidateBillingRequestCache();
	const { bumpWorkspaceConfigVersion } = await import('../workspace-config-bus.js');
	bumpWorkspaceConfigVersion('platform_settings');
	return {
		mappings: normalizePriceMappings(saved.payload?.billing?.priceMappings || nextMappings),
		updatedAt: saved.updated,
	};
}

async function loadCatalog() {
	const [plans, packs] = await Promise.all([
		listPlans().catch(() => ({ items: [] })),
		listCreditPacks().catch(() => ({ items: [] })),
	]);
	return {
		plans: (plans.items || []).map((plan) => ({
			slug: plan.slug,
			name: plan.name,
			monthlyPrice: Number(plan.monthlyPrice ?? plan.price) || 0,
			yearlyPrice: Number(plan.yearlyPrice) || 0,
			active: plan.active !== false && plan.status !== 'hidden' && plan.status !== 'deprecated',
			paid: (Number(plan.monthlyPrice ?? plan.price) || 0) > 0 || (Number(plan.yearlyPrice) || 0) > 0,
		})),
		packs: (packs.items || []).map((pack) => ({
			id: pack.id,
			name: pack.name,
			price: Number(pack.price) || 0,
			credits: Number(pack.credits) || 0,
			currency: pack.currency || 'USD',
			active: pack.active !== false,
		})),
	};
}

export async function getPriceMappingMatrix() {
	const [{ billing, updatedAt }, catalog] = await Promise.all([
		getRawBillingPayload(),
		loadCatalog(),
	]);
	const mappings = normalizePriceMappings(billing.priceMappings || {});
	for (const plan of catalog.plans) {
		if (!mappings.plans[plan.slug]) mappings.plans[plan.slug] = normalizePlanMapping({});
	}
	for (const pack of catalog.packs) {
		if (!mappings.packs[pack.id]) mappings.packs[pack.id] = normalizePackMapping({});
	}
	const validation = validatePriceMappings(mappings, catalog, {
		activeProvider: billing.provider || 'none',
	});
	return {
		mappings,
		catalog,
		activeProvider: billing.provider || 'none',
		validation: {
			result: validation.result,
			summary: validation.summary,
			diagnostics: validation.diagnostics,
		},
		providers: MAPPING_PROVIDERS,
		updatedAt,
	};
}

export async function updatePriceMappings(body = {}, actor = {}, requestMeta = {}) {
	const { billing } = await getRawBillingPayload();
	const incoming = normalizePriceMappings(body.mappings || body || {});
	incoming.updatedAt = new Date().toISOString();
	incoming.updatedBy = actor.email || actor.id || 'admin';
	incoming.meta = {
		...(billing.priceMappings?.meta || {}),
		...(incoming.meta || {}),
	};

	const catalog = await loadCatalog();
	const validation = validatePriceMappings(incoming, catalog, {
		activeProvider: billing.provider || 'none',
	});
	incoming.meta.lastValidatedAt = new Date().toISOString();
	incoming.meta.validationSummary = validation.summary;

	const saved = await persistMappings(incoming, actor, {
		expectedUpdatedAt: body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || null,
	});

	await writeControlPlaneAudit({
		action: 'billing.price_mapping.updated',
		message: 'Price mappings updated',
		provider: billing.provider || '',
		severity: 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before: { version: billing.priceMappings?.version || 1 },
		after: { version: 1, summary: validation.summary },
	});

	return {
		mappings: saved.mappings,
		validation: {
			result: validation.result,
			summary: validation.summary,
			diagnostics: validation.diagnostics,
		},
		updatedAt: saved.updatedAt,
	};
}

export async function validatePriceMappingsEndpoint(body = {}) {
	const { billing } = await getRawBillingPayload();
	const catalog = await loadCatalog();
	const mappings = normalizePriceMappings(body.mappings || billing.priceMappings || {});
	return validatePriceMappings(mappings, catalog, {
		activeProvider: billing.provider || 'none',
		requiredProviders: body.requiredProviders || null,
	});
}

export async function getPriceMappingGaps() {
	const matrix = await getPriceMappingMatrix();
	const diagnostics = matrix.validation.diagnostics || [];
	return {
		missing: diagnostics.filter((d) => d.code.startsWith('missing_')),
		duplicates: diagnostics.filter((d) => d.code === 'duplicate_price_id'),
		conflicts: diagnostics.filter((d) => d.code.includes('conflict')),
		inactive: diagnostics.filter((d) => d.code.startsWith('inactive_')),
		summary: matrix.validation.summary,
		updatedAt: matrix.updatedAt,
	};
}

export async function syncPriceMappingsToProviders(actor = {}, requestMeta = {}) {
	const { billing } = await getRawBillingPayload();
	const mappings = normalizePriceMappings(billing.priceMappings || {});
	const providers = structuredClone(billing.providers || {});

	for (const code of MAPPING_PROVIDERS) {
		providers[code] = providers[code] || {};
		if (code === 'lemonsqueezy') {
			providers[code].variantIds = { ...(providers[code].variantIds || {}) };
		} else {
			providers[code].priceIds = { ...(providers[code].priceIds || {}) };
		}
	}

	for (const [slug, plan] of Object.entries(mappings.plans)) {
		if (plan.status === 'inactive') continue;
		for (const interval of ['monthly', 'yearly']) {
			const cell = plan[interval] || {};
			const key = interval === 'yearly' ? `${slug}_yearly` : slug;
			if (cell.stripe) providers.stripe.priceIds[key] = cell.stripe;
			if (cell.paddle) providers.paddle.priceIds[key] = cell.paddle;
			if (cell.lemonsqueezy) providers.lemonsqueezy.variantIds[key] = cell.lemonsqueezy;
		}
	}
	for (const [packId, pack] of Object.entries(mappings.packs)) {
		if (pack.status === 'inactive') continue;
		const cell = pack.oneTime || {};
		const key = `pack_${packId}`;
		if (cell.stripe) providers.stripe.priceIds[key] = cell.stripe;
		if (cell.paddle) providers.paddle.priceIds[key] = cell.paddle;
		if (cell.lemonsqueezy) providers.lemonsqueezy.variantIds[key] = cell.lemonsqueezy;
	}

	mappings.meta = {
		...(mappings.meta || {}),
		lastSyncAt: new Date().toISOString(),
	};

	const row = await getSettingsRow();
	if (!row) throw httpError(500, 'Platform settings are not initialized.', 'SETTINGS_MISSING');
	if (requestMeta.expectedUpdatedAt && row.updated && String(row.updated) !== String(requestMeta.expectedUpdatedAt)) {
		throw httpError(409, 'Billing configuration changed. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
	}

	const payload = structuredClone(row.payload || {});
	payload.billing = payload.billing || {};
	payload.billing.providers = providers;
	payload.billing.priceMappings = mappings;

	const saved = await pocketbaseClient.collection('platform_settings').update(row.id, {
		config_key: 'platform',
		payload,
		version: row.version || 'v1',
		meta: {
			...(row.meta || {}),
			updatedBy: actor.email || actor.id || 'admin',
			updatedAt: new Date().toISOString(),
			billingControlPlane: true,
		},
	});
	invalidateBillingRequestCache();

	await writeControlPlaneAudit({
		action: 'billing.price_mapping.synced',
		message: 'Price mappings synced to provider runtime configuration',
		provider: billing.provider || '',
		severity: 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		after: { lastSyncAt: mappings.meta.lastSyncAt },
	});

	return {
		mappings: normalizePriceMappings(saved.payload?.billing?.priceMappings || mappings),
		syncedAt: mappings.meta.lastSyncAt,
		updatedAt: saved.updated,
	};
}
