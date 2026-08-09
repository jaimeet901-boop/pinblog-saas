/**
 * Paddle Billing Rewrite — Phase 1 normalized price registry model.
 *
 * Authoritative conceptual key: provider + environment + plan_slug|pack_id + interval → price_id
 *
 * Phase 1: model/helpers only. Checkout still reads legacy providers.paddle.priceIds[{slug}].
 * Phase 2 will consume billing_price_registry collection and/or normalized platform_settings.
 */

import {
	BILLING_ENVIRONMENTS,
	REGISTRY_INTERVALS,
	REGISTRY_PROVIDERS,
} from './billing-model.js';

export { REGISTRY_INTERVALS, REGISTRY_PROVIDERS, BILLING_ENVIRONMENTS };

export const PRICE_REGISTRY_COLLECTION = 'billing_price_registry';

/**
 * @typedef {object} PriceRegistryEntry
 * @property {string} provider
 * @property {'sandbox'|'live'} environment
 * @property {string} [planSlug]
 * @property {string} [packId]
 * @property {'monthly'|'yearly'|'one_time'} interval
 * @property {string} priceId
 * @property {boolean} [active]
 */

export function buildRegistryLogicalKey(entry = {}) {
	const provider = String(entry.provider || '').trim().toLowerCase();
	const environment = String(entry.environment || '').trim().toLowerCase();
	const planSlug = String(entry.planSlug || entry.plan_slug || '').trim().toLowerCase();
	const packId = String(entry.packId || entry.pack_id || '').trim();
	const interval = String(entry.interval || '').trim().toLowerCase();
	return `${provider}::${environment}::${planSlug}::${interval}::${packId}`;
}

export function normalizeRegistryEntry(input = {}) {
	const provider = String(input.provider || '').trim().toLowerCase();
	const environment = String(input.environment || '').trim().toLowerCase();
	const planSlug = String(input.planSlug || input.plan_slug || '').trim().toLowerCase();
	const packId = String(input.packId || input.pack_id || '').trim();
	const interval = String(input.interval || '').trim().toLowerCase();
	const priceId = String(input.priceId || input.price_id || '').trim();
	const active = input.active !== false;

	return {
		provider,
		environment,
		planSlug,
		packId,
		interval,
		priceId,
		active,
		logicalKey: buildRegistryLogicalKey({
			provider,
			environment,
			planSlug,
			packId,
			interval,
		}),
	};
}

export function validateRegistryEntry(input = {}) {
	const entry = normalizeRegistryEntry(input);
	const errors = [];

	if (!REGISTRY_PROVIDERS.includes(entry.provider)) {
		errors.push({ code: 'invalid_provider', field: 'provider' });
	}
	if (!BILLING_ENVIRONMENTS.includes(entry.environment)) {
		errors.push({ code: 'invalid_environment', field: 'environment' });
	}
	if (!REGISTRY_INTERVALS.includes(entry.interval)) {
		errors.push({ code: 'invalid_interval', field: 'interval' });
	}
	if (!entry.priceId) {
		errors.push({ code: 'missing_price_id', field: 'priceId' });
	}

	const isPack = entry.interval === 'one_time';
	if (isPack && !entry.packId) {
		errors.push({ code: 'missing_pack_id', field: 'packId' });
	}
	if (!isPack && !entry.planSlug) {
		errors.push({ code: 'missing_plan_slug', field: 'planSlug' });
	}
	if (isPack && entry.planSlug) {
		errors.push({ code: 'pack_entry_must_not_include_plan_slug', field: 'planSlug' });
	}

	return {
		ok: errors.length === 0,
		entry,
		errors,
	};
}

/**
 * Index registry entries and detect duplicate logical keys or duplicate price IDs per provider/environment.
 * @param {PriceRegistryEntry[]} entries
 */
export function indexRegistryEntries(entries = []) {
	const byLogicalKey = new Map();
	const byPriceId = new Map();
	const duplicates = [];

	for (const raw of entries) {
		const validation = validateRegistryEntry(raw);
		if (!validation.ok) {
			duplicates.push({ kind: 'invalid_entry', errors: validation.errors, entry: raw });
			continue;
		}
		const { entry } = validation;

		if (byLogicalKey.has(entry.logicalKey)) {
			duplicates.push({
				kind: 'duplicate_logical_key',
				logicalKey: entry.logicalKey,
				entries: [byLogicalKey.get(entry.logicalKey), entry],
			});
		} else {
			byLogicalKey.set(entry.logicalKey, entry);
		}

		const priceKey = `${entry.provider}::${entry.environment}::${entry.priceId}`;
		const priceRefs = byPriceId.get(priceKey) || [];
		priceRefs.push(entry);
		byPriceId.set(priceKey, priceRefs);
	}

	for (const [priceKey, refs] of byPriceId.entries()) {
		if (refs.length > 1) {
			duplicates.push({ kind: 'duplicate_price_id', priceKey, entries: refs });
		}
	}

	return {
		byLogicalKey,
		duplicates,
		count: byLogicalKey.size,
	};
}

export function resolveRegistryEntryByPriceId(entries = [], { provider, environment, priceId } = {}) {
	const normalizedPriceId = String(priceId || '').trim();
	if (!normalizedPriceId) return null;

	return entries.find((entry) => (
		entry.provider === provider
		&& entry.environment === environment
		&& entry.priceId === normalizedPriceId
		&& entry.active !== false
	)) || null;
}

export function resolveRegistryEntryForPlan(entries = [], { provider, environment, planSlug, interval } = {}) {
	const slug = String(planSlug || '').trim().toLowerCase();
	const normalizedInterval = String(interval || 'monthly').trim().toLowerCase();

	return entries.find((entry) => (
		entry.provider === provider
		&& entry.environment === environment
		&& entry.planSlug === slug
		&& entry.interval === normalizedInterval
		&& entry.active !== false
	)) || null;
}

export function resolveRegistryEntryForPack(entries = [], { provider, environment, packId } = {}) {
	const id = String(packId || '').trim();
	if (!id) return null;

	return entries.find((entry) => (
		entry.provider === provider
		&& entry.environment === environment
		&& entry.packId === id
		&& entry.interval === 'one_time'
		&& entry.active !== false
	)) || null;
}

/**
 * Convert legacy platform_settings priceMappings + synced priceIds into normalized registry rows.
 * Does NOT persist or alter runtime config — helper for Phase 2 migration/sync.
 *
 * @param {object} priceMappings normalized priceMappings.plans
 * @param {'sandbox'|'live'} environment
 * @param {string} [provider='paddle']
 */
export function entriesFromLegacyPriceMappings(priceMappings = {}, environment = 'sandbox', provider = 'paddle') {
	const plans = priceMappings.plans && typeof priceMappings.plans === 'object'
		? priceMappings.plans
		: priceMappings;
	const out = [];

	for (const [slug, planMapping] of Object.entries(plans || {})) {
		const planSlug = String(slug || '').trim().toLowerCase();
		if (!planSlug || !planMapping || typeof planMapping !== 'object') continue;
		if (planMapping.status === 'inactive') continue;

		for (const interval of ['monthly', 'yearly']) {
			const cell = planMapping[interval] || {};
			const priceId = String(cell[provider] || '').trim();
			if (!priceId) continue;
			out.push(normalizeRegistryEntry({
				provider,
				environment,
				planSlug,
				interval,
				priceId,
				active: true,
			}));
		}
	}

	return out;
}

/**
 * Convert legacy synced providers.paddle.priceIds flat map into registry entries.
 * Legacy monthly keys: {slug}. Legacy yearly keys: {slug}_yearly.
 */
export function entriesFromLegacyProviderPriceIds(priceIds = {}, environment = 'sandbox', provider = 'paddle') {
	const out = [];
	for (const [key, priceId] of Object.entries(priceIds || {})) {
		const rawKey = String(key || '').trim().toLowerCase();
		const normalizedPriceId = String(priceId || '').trim();
		if (!rawKey || !normalizedPriceId) continue;

		if (rawKey.startsWith('pack_')) {
			out.push(normalizeRegistryEntry({
				provider,
				environment,
				packId: rawKey.slice('pack_'.length),
				interval: 'one_time',
				priceId: normalizedPriceId,
				active: true,
			}));
			continue;
		}

		if (rawKey.endsWith('_yearly')) {
			out.push(normalizeRegistryEntry({
				provider,
				environment,
				planSlug: rawKey.replace(/_yearly$/, ''),
				interval: 'yearly',
				priceId: normalizedPriceId,
				active: true,
			}));
			continue;
		}

		out.push(normalizeRegistryEntry({
			provider,
			environment,
			planSlug: rawKey,
			interval: 'monthly',
			priceId: normalizedPriceId,
			active: true,
		}));
	}
	return out;
}

/**
 * Convert normalized priceMappings (plans + packs) into registry rows for a provider/environment.
 */
export function entriesFromPriceMappings(mappings = {}, environment = 'sandbox', provider = 'paddle') {
	const entries = entriesFromLegacyPriceMappings(mappings, environment, provider);

	for (const [packId, packMapping] of Object.entries(mappings.packs || {})) {
		if (!packId || !packMapping || typeof packMapping !== 'object') continue;
		if (packMapping.status === 'inactive') continue;

		const cell = packMapping.oneTime || packMapping.one_time || {};
		const priceId = String(cell[provider] || '').trim();
		if (!priceId) continue;

		entries.push(normalizeRegistryEntry({
			provider,
			environment,
			packId: String(packId).trim(),
			interval: 'one_time',
			priceId,
			active: true,
		}));
	}

	const byKey = new Map();
	for (const entry of entries) {
		byKey.set(entry.logicalKey, entry);
	}
	return [...byKey.values()];
}
