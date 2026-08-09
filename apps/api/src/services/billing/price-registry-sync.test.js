/**
 * Phase 3.5 — billing_price_registry admin sync tests.
 * Run: node --test src/services/billing/price-registry-sync.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildDesiredRegistryEntries,
	resolveProviderRegistryEnvironment,
	syncPriceRegistryFromMappings,
} from './price-registry-sync.js';
import {
	entriesFromPriceMappings,
	normalizeRegistryEntry,
	resolveRegistryEntryForPack,
} from './price-registry.js';
import {
	isRegistryAuthoritative,
	resolvePaddleRuntimePackPriceId,
	resolvePaddleRuntimePlanPriceId,
} from './price-registry-resolver.js';
import {
	resolveCheckoutPaddlePackPriceId,
	resolveCheckoutPaddlePriceId,
} from './providers/paddle-webhook-helpers.js';

const sandboxMappings = {
	plans: {
		pro: {
			status: 'active',
			monthly: { paddle: 'pri_pro_monthly', stripe: 'price_stripe_pro_m' },
			yearly: { paddle: 'pri_pro_yearly', stripe: 'price_stripe_pro_y' },
		},
		starter: {
			status: 'inactive',
			monthly: { paddle: 'pri_starter_monthly' },
		},
	},
	packs: {
		'pack-100': {
			status: 'active',
			oneTime: { paddle: 'pri_pack_100', stripe: 'price_stripe_pack_100' },
		},
		'pack-500': {
			status: 'inactive',
			oneTime: { paddle: 'pri_pack_500' },
		},
	},
};

function createMockRegistryClient(initialRows = []) {
	const store = new Map(initialRows.map((row) => [row.id, { ...row }]));
	let seq = store.size + 1;

	return {
		filter: (template) => template,
		collection(name) {
			if (name !== 'billing_price_registry') throw new Error(`unexpected collection ${name}`);
			return {
				async getFullList({ filter: _filter }) {
					const rows = [...store.values()];
					if (String(_filter || '').includes('sandbox')) {
						return rows.filter((row) => row.environment === 'sandbox');
					}
					if (String(_filter || '').includes('live')) {
						return rows.filter((row) => row.environment === 'live');
					}
					return rows;
				},
				async create(body) {
					const id = `reg_${seq++}`;
					const row = { id, ...body };
					store.set(id, row);
					return row;
				},
				async update(id, body) {
					const existing = store.get(id);
					const next = { ...existing, ...body };
					store.set(id, next);
					return next;
				},
			};
		},
		_store: store,
	};
}

describe('buildDesiredRegistryEntries', () => {
	it('includes monthly Paddle plan mapping', () => {
		const rows = buildDesiredRegistryEntries(sandboxMappings, {
			provider: 'paddle',
			environment: 'sandbox',
		}).filter((row) => row.valid);

		const proMonthly = rows.find((row) => row.entry.planSlug === 'pro' && row.entry.interval === 'monthly');
		assert.equal(proMonthly?.entry.priceId, 'pri_pro_monthly');
	});

	it('includes yearly Paddle plan mapping', () => {
		const rows = buildDesiredRegistryEntries(sandboxMappings, {
			provider: 'paddle',
			environment: 'sandbox',
		}).filter((row) => row.valid);

		const proYearly = rows.find((row) => row.entry.planSlug === 'pro' && row.entry.interval === 'yearly');
		assert.equal(proYearly?.entry.priceId, 'pri_pro_yearly');
	});

	it('includes one_time credit pack mapping', () => {
		const rows = buildDesiredRegistryEntries(sandboxMappings, {
			provider: 'paddle',
			environment: 'sandbox',
		}).filter((row) => row.valid);

		const pack = rows.find((row) => row.entry.packId === 'pack-100');
		assert.equal(pack?.entry.interval, 'one_time');
		assert.equal(pack?.entry.priceId, 'pri_pack_100');
	});

	it('skips inactive plan and pack mappings', () => {
		const rows = buildDesiredRegistryEntries(sandboxMappings, {
			provider: 'paddle',
			environment: 'sandbox',
		}).filter((row) => row.valid);

		assert.equal(rows.some((row) => row.entry.planSlug === 'starter'), false);
		assert.equal(rows.some((row) => row.entry.packId === 'pack-500'), false);
	});
});

describe('resolveProviderRegistryEnvironment', () => {
	it('resolves Paddle sandbox environment', () => {
		const result = resolveProviderRegistryEnvironment('paddle', { sandbox: true, mode: 'test' });
		assert.equal(result.ok, true);
		assert.equal(result.environment, 'sandbox');
	});

	it('fails closed on Paddle sandbox/live conflict', () => {
		const result = resolveProviderRegistryEnvironment('paddle', { sandbox: true, mode: 'live' });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_environment_conflict_sandbox_and_live');
	});

	it('keeps sandbox and live mappings separate via environment field', () => {
		const sandboxEntries = entriesFromPriceMappings(sandboxMappings, 'sandbox', 'paddle');
		const liveEntries = entriesFromPriceMappings(sandboxMappings, 'live', 'paddle');
		assert.equal(sandboxEntries[0].environment, 'sandbox');
		assert.equal(liveEntries[0].environment, 'live');
	});
});

describe('syncPriceRegistryFromMappings upsert/idempotency', () => {
	it('creates registry rows on first sync', async () => {
		const client = createMockRegistryClient();
		const result = await syncPriceRegistryFromMappings({
			mappings: sandboxMappings,
			paddleConfig: { sandbox: true, mode: 'test' },
			actor: { id: 'admin_1' },
			client,
		});

		assert.equal(result.ok, true);
		assert.equal(result.summary.created, 3);
		assert.equal(client._store.size, 3);
	});

	it('is idempotent on repeated sync', async () => {
		const client = createMockRegistryClient();
		await syncPriceRegistryFromMappings({
			mappings: sandboxMappings,
			paddleConfig: { sandbox: true, mode: 'test' },
			client,
		});
		const second = await syncPriceRegistryFromMappings({
			mappings: sandboxMappings,
			paddleConfig: { sandbox: true, mode: 'test' },
			client,
		});

		assert.equal(second.summary.created, 0);
		assert.equal(second.summary.updated, 0);
		assert.equal(second.summary.unchanged, 3);
		assert.equal(client._store.size, 3);
	});

	it('updates existing logical entry when price_id changes', async () => {
		const client = createMockRegistryClient();
		await syncPriceRegistryFromMappings({
			mappings: sandboxMappings,
			paddleConfig: { sandbox: true, mode: 'test' },
			client,
		});

		const changedMappings = structuredClone(sandboxMappings);
		changedMappings.plans.pro.monthly.paddle = 'pri_pro_monthly_v2';

		const result = await syncPriceRegistryFromMappings({
			mappings: changedMappings,
			paddleConfig: { sandbox: true, mode: 'test' },
			client,
		});

		assert.equal(result.summary.updated, 1);
		const proMonthly = [...client._store.values()].find((row) => row.plan_slug === 'pro' && row.interval === 'monthly');
		assert.equal(proMonthly.price_id, 'pri_pro_monthly_v2');
	});

	it('deactivates registry rows when mapping becomes inactive/removed', async () => {
		const client = createMockRegistryClient();
		await syncPriceRegistryFromMappings({
			mappings: sandboxMappings,
			paddleConfig: { sandbox: true, mode: 'test' },
			client,
		});

		const reducedMappings = {
			plans: {
				pro: {
					status: 'active',
					monthly: { paddle: 'pri_pro_monthly' },
					yearly: { paddle: 'pri_pro_yearly' },
				},
			},
			packs: {},
		};

		const result = await syncPriceRegistryFromMappings({
			mappings: reducedMappings,
			paddleConfig: { sandbox: true, mode: 'test' },
			client,
		});

		assert.equal(result.summary.deactivated, 1);
		const packRow = [...client._store.values()].find((row) => row.pack_id === 'pack-100');
		assert.equal(packRow.active, false);
	});

	it('fails closed on Paddle environment conflict', async () => {
		const client = createMockRegistryClient();
		await assert.rejects(
			() => syncPriceRegistryFromMappings({
				mappings: sandboxMappings,
				paddleConfig: { sandbox: true, mode: 'live' },
				client,
			}),
			(err) => err.status === 422 && err.errorCode === 'REGISTRY_SYNC_ENVIRONMENT_CONFLICT',
		);
	});
});

describe('Paddle runtime registry source of truth', () => {
	const registryEntries = [
		normalizeRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			planSlug: 'pro',
			interval: 'monthly',
			priceId: 'pri_registry_pro',
		}),
		normalizeRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			packId: 'pack-100',
			interval: 'one_time',
			priceId: 'pri_registry_pack',
		}),
	];

	const legacyConfig = {
		priceIds: {
			pro: 'pri_legacy_pro',
			'pack_pack-100': 'pri_legacy_pack',
		},
	};

	it('prefers registry over legacy for plan checkout', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfig, {
			registryEntries,
			environment: 'sandbox',
			interval: 'monthly',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_registry_pro');
		assert.equal(result.source, 'registry');
	});

	it('resolves yearly registry row for plan checkout (Phase 3.8)', () => {
		const entriesWithYearly = [
			...registryEntries,
			normalizeRegistryEntry({
				provider: 'paddle',
				environment: 'sandbox',
				planSlug: 'pro',
				interval: 'yearly',
				priceId: 'pri_registry_pro_yearly',
			}),
		];
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfig, {
			registryEntries: entriesWithYearly,
			environment: 'sandbox',
			interval: 'yearly',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_registry_pro_yearly');
		assert.equal(result.planSlug, 'pro');
		assert.equal(result.source, 'registry');
	});

	it('prefers registry over legacy for pack checkout', () => {
		const result = resolveCheckoutPaddlePackPriceId('pack-100', legacyConfig, {
			registryEntries,
			environment: 'sandbox',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_registry_pack');
		assert.equal(result.source, 'registry');
	});

	it('falls back to legacy when registry is empty', () => {
		const result = resolveCheckoutPaddlePriceId('pro', legacyConfig, {
			registryEntries: [],
			environment: 'sandbox',
		});
		assert.equal(result.ok, true);
		assert.equal(result.priceId, 'pri_legacy_pro');
		assert.equal(result.source, 'legacy');
	});

	it('resolveRegistryEntryForPack works on synced-style entries (Phase 3.4 compat)', () => {
		const entry = resolveRegistryEntryForPack(registryEntries, {
			provider: 'paddle',
			environment: 'sandbox',
			packId: 'pack-100',
		});
		assert.equal(entry.priceId, 'pri_registry_pack');
	});

	it('legacy Stripe mappings are not affected by Paddle registry helpers', () => {
		assert.equal(isRegistryAuthoritative(registryEntries), true);
		assert.equal(resolvePaddleRuntimePlanPriceId(registryEntries, {
			environment: 'sandbox',
			planSlug: 'pro',
		}), 'pri_registry_pro');
		assert.equal(resolvePaddleRuntimePackPriceId([], {
			environment: 'sandbox',
			packId: 'pack-100',
		}), '');
	});
});

describe('admin sync endpoint contract shape', () => {
	it('syncPriceRegistryFromMappings returns provider summary for admin response', async () => {
		const client = createMockRegistryClient();
		const result = await syncPriceRegistryFromMappings({
			mappings: sandboxMappings,
			paddleConfig: { sandbox: true, mode: 'test' },
			actor: { email: 'admin@example.com' },
			client,
		});

		assert.equal(result.ok, true);
		assert.ok(result.syncedAt);
		assert.equal(result.providers[0].provider, 'paddle');
		assert.equal(result.providers[0].environment, 'sandbox');
		assert.equal(typeof result.summary.created, 'number');
	});
});
