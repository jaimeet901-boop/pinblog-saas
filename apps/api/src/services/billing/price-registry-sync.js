import {
	buildRegistryLogicalKey,
	entriesFromPriceMappings,
	normalizeRegistryEntry,
	PRICE_REGISTRY_COLLECTION,
	validateRegistryEntry,
} from './price-registry.js';
import { MAPPING_PROVIDERS } from './price-mapping-helpers.js';
import { deriveEffectivePaddleEnvironment } from './providers/paddle-environment.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/**
 * Resolve registry environment for a billing provider config.
 * Paddle uses strict deriveEffectivePaddleEnvironment (fail-closed on conflict).
 */
export function resolveProviderRegistryEnvironment(provider, providerConfig = {}) {
	if (provider === 'paddle') {
		return deriveEffectivePaddleEnvironment(providerConfig);
	}

	const mode = String(providerConfig.mode || '').trim().toLowerCase();
	if (mode === 'live') return { ok: true, environment: 'live' };
	if (mode === 'test' || mode === 'sandbox') return { ok: true, environment: 'sandbox' };
	if (providerConfig.sandbox === true) return { ok: true, environment: 'sandbox' };

	return { ok: false, error: `${provider}_environment_unconfigured`, skipped: true };
}

/**
 * Build desired registry rows from normalized price mappings for one provider/environment.
 */
export function buildDesiredRegistryEntries(mappings = {}, { provider, environment } = {}) {
	const entries = entriesFromPriceMappings(mappings, environment, provider);
	const validated = [];

	for (const entry of entries) {
		const result = validateRegistryEntry(entry);
		if (!result.ok) {
			validated.push({ entry, valid: false, errors: result.errors });
			continue;
		}
		validated.push({ entry: result.entry, valid: true, errors: [] });
	}

	return validated;
}

function registryRowBody(entry, { notes = '', active = true } = {}) {
	return {
		provider: entry.provider,
		environment: entry.environment,
		plan_slug: entry.planSlug || '',
		pack_id: entry.packId || '',
		interval: entry.interval,
		price_id: entry.priceId,
		active: active !== false,
		notes: String(notes || '').slice(0, 500),
	};
}

function rowToLogicalKey(row = {}) {
	return buildRegistryLogicalKey({
		provider: row.provider,
		environment: row.environment,
		planSlug: row.plan_slug || row.planSlug || '',
		packId: row.pack_id || row.packId || '',
		interval: row.interval,
	});
}

/**
 * Upsert billing_price_registry rows from price mappings (idempotent).
 * @param {object} [options.client] — PocketBase client override (tests)
 */
export async function syncPriceRegistryFromMappings({
	mappings,
	providers = {},
	paddleConfig = {},
	providersToSync = ['paddle'],
	actor = {},
	client = null,
} = {}) {
	const pb = client || (await import('../../utils/pocketbaseClient.js')).default;
	const normalizedMappings = mappings?.plans || mappings?.packs
		? mappings
		: { plans: {}, packs: {} };

	const providerResults = [];
	let totalCreated = 0;
	let totalUpdated = 0;
	let totalDeactivated = 0;
	let totalUnchanged = 0;

	for (const provider of providersToSync) {
		if (!MAPPING_PROVIDERS.includes(provider)) {
			providerResults.push({
				provider,
				ok: false,
				error: 'unsupported_provider',
			});
			continue;
		}

		const providerConfig = provider === 'paddle'
			? (paddleConfig || providers?.paddle || {})
			: (providers?.[provider] || {});

		const envResult = resolveProviderRegistryEnvironment(provider, providerConfig);
		if (!envResult.ok) {
			if (provider === 'paddle') {
				throw httpError(422, envResult.error, 'REGISTRY_SYNC_ENVIRONMENT_CONFLICT');
			}
			providerResults.push({
				provider,
				ok: false,
				skipped: true,
				error: envResult.error,
			});
			continue;
		}

		const environment = envResult.environment;
		const desired = buildDesiredRegistryEntries(normalizedMappings, { provider, environment });
		const invalid = desired.filter((row) => !row.valid);
		if (invalid.length > 0) {
			throw httpError(422, 'Invalid registry entries derived from mappings', 'REGISTRY_SYNC_VALIDATION_FAILED');
		}

		const desiredEntries = desired.map((row) => ({
			...row.entry,
			notes: `synced from priceMappings by ${actor.email || actor.id || 'admin'}`,
		}));
		const desiredKeys = new Set(desiredEntries.map((entry) => entry.logicalKey));

		const filter = pb.filter(
			'provider = {:provider} && environment = {:environment}',
			{ provider, environment },
		);
		const existingRows = await pb.collection(PRICE_REGISTRY_COLLECTION).getFullList({
			filter,
			requestKey: null,
		}).catch(() => []);

		const existingByKey = new Map();
		for (const row of existingRows) {
			existingByKey.set(rowToLogicalKey(row), row);
		}

		let created = 0;
		let updated = 0;
		let unchanged = 0;
		let deactivated = 0;

		for (const entry of desiredEntries) {
			const body = registryRowBody(entry, { notes: entry.notes, active: true });
			const existing = existingByKey.get(entry.logicalKey);

			if (!existing) {
				await pb.collection(PRICE_REGISTRY_COLLECTION).create(body);
				created += 1;
				continue;
			}

			const needsUpdate = existing.price_id !== body.price_id
				|| existing.active !== true
				|| String(existing.notes || '') !== body.notes;

			if (!needsUpdate) {
				unchanged += 1;
				continue;
			}

			await pb.collection(PRICE_REGISTRY_COLLECTION).update(existing.id, body);
			updated += 1;
		}

		for (const [logicalKey, row] of existingByKey.entries()) {
			if (desiredKeys.has(logicalKey)) continue;
			if (row.active === false) continue;

			await pb.collection(PRICE_REGISTRY_COLLECTION).update(row.id, {
				active: false,
				notes: String(row.notes || '').slice(0, 400) + ' [deactivated: mapping removed/inactive]',
			});
			deactivated += 1;
		}

		totalCreated += created;
		totalUpdated += updated;
		totalDeactivated += deactivated;
		totalUnchanged += unchanged;

		providerResults.push({
			provider,
			ok: true,
			environment,
			created,
			updated,
			deactivated,
			unchanged,
			total: desiredEntries.length,
		});
	}

	return {
		ok: true,
		providers: providerResults,
		summary: {
			created: totalCreated,
			updated: totalUpdated,
			deactivated: totalDeactivated,
			unchanged: totalUnchanged,
		},
		syncedAt: new Date().toISOString(),
	};
}

export { registryRowBody, rowToLogicalKey };
