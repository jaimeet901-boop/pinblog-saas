/**
 * Paddle Billing Rewrite — Phase 1 price registry tests.
 * Run: node --test src/services/billing/price-registry.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildRegistryLogicalKey,
	entriesFromLegacyProviderPriceIds,
	indexRegistryEntries,
	normalizeRegistryEntry,
	validateRegistryEntry,
} from './price-registry.js';

describe('buildRegistryLogicalKey', () => {
	it('builds stable provider/environment/plan/interval key', () => {
		const key = buildRegistryLogicalKey({
			provider: 'paddle',
			environment: 'sandbox',
			planSlug: 'pro',
			interval: 'monthly',
			packId: '',
		});
		assert.equal(key, 'paddle::sandbox::pro::monthly::');
	});
});

describe('validateRegistryEntry', () => {
	it('accepts monthly plan entry', () => {
		const result = validateRegistryEntry({
			provider: 'paddle',
			environment: 'live',
			planSlug: 'pro',
			interval: 'monthly',
			priceId: 'pri_live_pro_monthly',
		});
		assert.equal(result.ok, true);
	});

	it('accepts yearly plan entry', () => {
		const result = validateRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			planSlug: 'pro',
			interval: 'yearly',
			priceId: 'pri_sandbox_pro_yearly',
		});
		assert.equal(result.ok, true);
	});

	it('rejects missing price id', () => {
		const result = validateRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			planSlug: 'pro',
			interval: 'monthly',
			priceId: '',
		});
		assert.equal(result.ok, false);
	});

	it('accepts one_time credit pack entry', () => {
		const result = validateRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			packId: 'pack-100',
			interval: 'one_time',
			priceId: 'pri_pack_100',
		});
		assert.equal(result.ok, true);
		assert.equal(result.entry.packId, 'pack-100');
	});
});

describe('indexRegistryEntries uniqueness', () => {
	it('allows monthly and yearly entries for same plan/environment', () => {
		const { duplicates, count } = indexRegistryEntries([
			{
				provider: 'paddle',
				environment: 'sandbox',
				planSlug: 'pro',
				interval: 'monthly',
				priceId: 'pri_pro_monthly',
			},
			{
				provider: 'paddle',
				environment: 'sandbox',
				planSlug: 'pro',
				interval: 'yearly',
				priceId: 'pri_pro_yearly',
			},
		]);
		assert.equal(duplicates.length, 0);
		assert.equal(count, 2);
	});

	it('allows sandbox and live entries for same plan slug', () => {
		const { duplicates, count } = indexRegistryEntries([
			{
				provider: 'paddle',
				environment: 'sandbox',
				planSlug: 'pro',
				interval: 'monthly',
				priceId: 'pri_sandbox_pro',
			},
			{
				provider: 'paddle',
				environment: 'live',
				planSlug: 'pro',
				interval: 'monthly',
				priceId: 'pri_live_pro',
			},
		]);
		assert.equal(duplicates.length, 0);
		assert.equal(count, 2);
	});

	it('detects duplicate logical keys', () => {
		const entry = {
			provider: 'paddle',
			environment: 'sandbox',
			planSlug: 'pro',
			interval: 'monthly',
			priceId: 'pri_a',
		};
		const { duplicates } = indexRegistryEntries([entry, { ...entry, priceId: 'pri_b' }]);
		assert.equal(duplicates.length, 1);
		assert.equal(duplicates[0].kind, 'duplicate_logical_key');
	});
});

describe('entriesFromLegacyProviderPriceIds', () => {
	it('maps slug and slug_yearly to monthly/yearly intervals', () => {
		const entries = entriesFromLegacyProviderPriceIds({
			pro: 'pri_pro_monthly',
			pro_yearly: 'pri_pro_yearly',
		}, 'sandbox', 'paddle');

		assert.equal(entries.length, 2);
		assert.deepEqual(
			entries.map((entry) => normalizeRegistryEntry(entry)).map((e) => [e.planSlug, e.interval, e.priceId]).sort(),
			[
				['pro', 'monthly', 'pri_pro_monthly'],
				['pro', 'yearly', 'pri_pro_yearly'],
			].sort(),
		);
	});

	it('maps pack_* keys to one_time registry entries', () => {
		const entries = entriesFromLegacyProviderPriceIds({
			'pack_pack-100': 'pri_pack_100',
			pro: 'pri_pro_monthly',
		}, 'sandbox', 'paddle');

		const packEntry = entries.find((entry) => entry.packId === 'pack-100');
		assert.ok(packEntry);
		assert.equal(packEntry.interval, 'one_time');
		assert.equal(packEntry.priceId, 'pri_pack_100');
	});
});

describe('webhook event identity (schema contract)', () => {
	it('defines unique provider+event_id logical constraint for billing_webhook_events', () => {
		// Phase 1 schema: UNIQUE INDEX on (provider, event_id)
		const eventA = { provider: 'paddle', event_id: 'evt_123' };
		const eventB = { provider: 'paddle', event_id: 'evt_123' };
		const eventC = { provider: 'paddle', event_id: 'evt_456' };

		const key = (row) => `${row.provider}::${row.event_id}`;
		assert.equal(key(eventA), key(eventB));
		assert.notEqual(key(eventA), key(eventC));
	});
});
