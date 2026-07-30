/**
 * Pure Price Mapping helpers (no PocketBase side effects).
 */

export const MAPPING_PROVIDERS = Object.freeze(['stripe', 'paddle', 'lemonsqueezy']);
export const PLAN_INTERVALS = Object.freeze(['monthly', 'yearly', 'trial']);

export function emptyProviderIds() {
	return { stripe: '', paddle: '', lemonsqueezy: '' };
}

export function normalizeProviderMap(input = {}) {
	const out = emptyProviderIds();
	for (const code of MAPPING_PROVIDERS) {
		out[code] = String(input?.[code] || '').trim();
	}
	return out;
}

export function normalizePlanMapping(input = {}) {
	return {
		status: input.status === 'inactive' ? 'inactive' : 'active',
		monthly: normalizeProviderMap(input.monthly),
		yearly: normalizeProviderMap(input.yearly),
		trial: normalizeProviderMap(input.trial),
	};
}

export function normalizePackMapping(input = {}) {
	return {
		status: input.status === 'inactive' ? 'inactive' : 'active',
		oneTime: normalizeProviderMap(input.oneTime || input.one_time || {}),
	};
}

export function normalizePriceMappings(raw = {}) {
	const plansIn = raw.plans && typeof raw.plans === 'object' ? raw.plans : {};
	const packsIn = raw.packs && typeof raw.packs === 'object' ? raw.packs : {};
	const plans = {};
	const packs = {};
	for (const [slug, value] of Object.entries(plansIn)) {
		const key = String(slug || '').trim().toLowerCase();
		if (!key) continue;
		plans[key] = normalizePlanMapping(value || {});
	}
	for (const [packId, value] of Object.entries(packsIn)) {
		const key = String(packId || '').trim();
		if (!key) continue;
		packs[key] = normalizePackMapping(value || {});
	}
	return {
		version: 1,
		updatedAt: raw.updatedAt || null,
		updatedBy: raw.updatedBy || '',
		plans,
		packs,
		meta: {
			lastValidatedAt: raw.meta?.lastValidatedAt || null,
			lastSyncAt: raw.meta?.lastSyncAt || null,
			validationSummary: raw.meta?.validationSummary || null,
		},
	};
}

function collectIdIndex(mappings) {
	const index = new Map();
	const add = (provider, id, ref) => {
		const value = String(id || '').trim();
		if (!value) return;
		const mapKey = `${provider}::${value}`;
		const list = index.get(mapKey) || [];
		list.push(ref);
		index.set(mapKey, list);
	};

	for (const [slug, plan] of Object.entries(mappings.plans || {})) {
		if (plan.status === 'inactive') continue;
		for (const interval of PLAN_INTERVALS) {
			const cell = plan[interval] || {};
			for (const provider of MAPPING_PROVIDERS) {
				add(provider, cell[provider], { kind: 'plan', key: slug, interval, provider });
			}
		}
	}
	for (const [packId, pack] of Object.entries(mappings.packs || {})) {
		if (pack.status === 'inactive') continue;
		const cell = pack.oneTime || {};
		for (const provider of MAPPING_PROVIDERS) {
			add(provider, cell[provider], { kind: 'pack', key: packId, interval: 'one_time', provider });
		}
	}
	return index;
}

export function validatePriceMappings(mappingsInput, catalog, { activeProvider = 'none', requiredProviders = null } = {}) {
	const mappings = normalizePriceMappings(mappingsInput);
	const diagnostics = [];
	const required = requiredProviders || (
		activeProvider && activeProvider !== 'none' ? [activeProvider] : []
	);

	const index = collectIdIndex(mappings);
	for (const [mapKey, refs] of index.entries()) {
		if (refs.length > 1) {
			const [, priceId] = mapKey.split('::');
			diagnostics.push({
				code: 'duplicate_price_id',
				severity: 'error',
				message: `Provider price ID "${priceId}" is mapped more than once.`,
				refs,
			});
		}
	}

	for (const plan of catalog.plans || []) {
		if (!plan.active || !plan.paid) continue;
		const mapping = mappings.plans[plan.slug] || normalizePlanMapping({});
		if (mapping.status === 'inactive') {
			diagnostics.push({
				code: 'inactive_plan_mapping',
				severity: 'warn',
				message: `Paid plan "${plan.slug}" mapping is inactive.`,
				field: plan.slug,
			});
			continue;
		}
		for (const provider of required) {
			if (!MAPPING_PROVIDERS.includes(provider)) continue;
			if (!mapping.monthly?.[provider]) {
				diagnostics.push({
					code: 'missing_monthly_mapping',
					severity: 'error',
					message: `Missing ${provider} monthly mapping for plan "${plan.slug}".`,
					provider,
					planSlug: plan.slug,
					interval: 'monthly',
				});
			}
		}
		for (const provider of MAPPING_PROVIDERS) {
			if (required.includes(provider)) continue;
			if (!mapping.monthly?.[provider]) {
				diagnostics.push({
					code: 'missing_optional_mapping',
					severity: 'warn',
					message: `No ${provider} monthly mapping for plan "${plan.slug}".`,
					provider,
					planSlug: plan.slug,
					interval: 'monthly',
				});
			}
		}
	}

	for (const pack of catalog.packs || []) {
		if (!pack.active) continue;
		const mapping = mappings.packs[pack.id] || normalizePackMapping({});
		if (mapping.status === 'inactive') {
			diagnostics.push({
				code: 'inactive_pack_mapping',
				severity: 'warn',
				message: `Credit pack "${pack.id}" mapping is inactive.`,
				field: pack.id,
			});
			continue;
		}
		for (const provider of required) {
			if (!MAPPING_PROVIDERS.includes(provider)) continue;
			if (!mapping.oneTime?.[provider]) {
				diagnostics.push({
					code: 'missing_pack_mapping',
					severity: 'error',
					message: `Missing ${provider} one-time mapping for pack "${pack.id}".`,
					provider,
					packId: pack.id,
					interval: 'one_time',
				});
			}
		}
	}

	for (const [slug, plan] of Object.entries(mappings.plans || {})) {
		for (const provider of MAPPING_PROVIDERS) {
			const monthly = plan.monthly?.[provider];
			const yearly = plan.yearly?.[provider];
			if (monthly && yearly && monthly === yearly) {
				diagnostics.push({
					code: 'interval_conflict',
					severity: 'error',
					message: `Plan "${slug}" uses the same ${provider} ID for monthly and yearly.`,
					provider,
					planSlug: slug,
				});
			}
		}
	}

	const hasError = diagnostics.some((d) => d.severity === 'error');
	const hasWarn = diagnostics.some((d) => d.severity === 'warn');
	const result = hasError ? 'FAIL' : hasWarn ? 'WARNING' : 'PASS';
	const summary = {
		result,
		missing: diagnostics.filter((d) => d.code.startsWith('missing_')).length,
		duplicates: diagnostics.filter((d) => d.code === 'duplicate_price_id').length,
		conflicts: diagnostics.filter((d) => d.code.includes('conflict')).length,
		inactive: diagnostics.filter((d) => d.code.startsWith('inactive_')).length,
		total: diagnostics.length,
	};

	return { result, summary, diagnostics, mappings };
}
