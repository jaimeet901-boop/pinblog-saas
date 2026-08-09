import {
	entriesFromLegacyPriceMappings,
	entriesFromLegacyProviderPriceIds,
	normalizeRegistryEntry,
	PRICE_REGISTRY_COLLECTION,
	resolveRegistryEntryByPriceId,
	resolveRegistryEntryForPlan,
	resolveRegistryEntryForPack,
} from './price-registry.js';

async function resolvePocketbaseClient(override) {
	if (override) return override;
	const { default: pocketbaseClient } = await import('../../utils/pocketbaseClient.js');
	return pocketbaseClient;
}

export {
	resolveRegistryEntryByPriceId,
	resolveRegistryEntryForPlan,
	resolveRegistryEntryForPack,
} from './price-registry.js';

/**
 * When the registry collection has active rows for provider/environment,
 * Paddle runtime resolution treats it as authoritative over legacy priceIds.
 */
export function isRegistryAuthoritative(entries = []) {
	return Array.isArray(entries) && entries.length > 0;
}

export function resolvePaddleRuntimePlanPriceId(entries = [], { environment, planSlug, interval = 'monthly' } = {}) {
	if (!isRegistryAuthoritative(entries)) return '';
	return resolveRegistryEntryForPlan(entries, {
		provider: 'paddle',
		environment,
		planSlug,
		interval,
	})?.priceId || '';
}

export function resolvePaddleRuntimePackPriceId(entries = [], { environment, packId } = {}) {
	if (!isRegistryAuthoritative(entries)) return '';
	return resolveRegistryEntryForPack(entries, {
		provider: 'paddle',
		environment,
		packId,
	})?.priceId || '';
}

/**
 * Build in-memory registry entries from control-plane config (legacy + priceMappings).
 */
export function buildRegistryEntriesFromConfig(config = {}, environment = 'sandbox', provider = 'paddle') {
	const entries = [];

	if (config.priceMappings && typeof config.priceMappings === 'object') {
		entries.push(...entriesFromLegacyPriceMappings(config.priceMappings, environment, provider));
	}

	const priceIds = config.priceIds || config.prices || {};
	entries.push(...entriesFromLegacyProviderPriceIds(priceIds, environment, provider));

	const byKey = new Map();
	for (const entry of entries) {
		byKey.set(entry.logicalKey, entry);
	}
	return [...byKey.values()];
}

export async function loadRegistryEntries({ environment, provider = 'paddle', config = {}, client = null } = {}) {
	if (!client && process.env.NODE_ENV === 'test') {
		return buildRegistryEntriesFromConfig(config, environment, provider);
	}

	const pb = await resolvePocketbaseClient(client);
	try {
		const filter = pb.filter(
			'provider = {:provider} && environment = {:environment} && active = true',
			{ provider, environment },
		);
		const list = await pb.collection(PRICE_REGISTRY_COLLECTION).getFullList({
			filter,
			requestKey: null,
		}).catch(() => []);

		if (Array.isArray(list) && list.length > 0) {
			return list.map((row) => normalizeRegistryEntry({
				provider: row.provider,
				environment: row.environment,
				planSlug: row.plan_slug,
				packId: row.pack_id,
				interval: row.interval,
				priceId: row.price_id,
				active: row.active,
			}));
		}
	} catch {
		// Fall back to legacy config below.
	}

	return buildRegistryEntriesFromConfig(config, environment, provider);
}

