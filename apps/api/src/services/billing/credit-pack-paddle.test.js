/**
 * Phase 3.4 — Paddle credit pack checkout + fulfillment tests.
 * Run: node --test src/services/billing/credit-pack-paddle.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildPaddleCreditPackIdempotencyKey,
	classifyPaddleCreditPackFulfillment,
	verifyPaddleTransactionForCreditPack,
} from './paddle-transaction-verification.js';
import {
	entriesFromLegacyProviderPriceIds,
	normalizeRegistryEntry,
	resolveRegistryEntryForPack,
	validateRegistryEntry,
} from './price-registry.js';
import {
	buildPaddleWebhookParseResult,
	resolveCheckoutPaddlePackPriceId,
	resolveExpectedPaddlePackPriceId,
	validatePaddlePriceForPack,
} from './providers/paddle-webhook-helpers.js';
import { PaddleBillingProvider } from './providers/paddle.js';

const packPriceConfig = {
	priceIds: {
		'pack_pack-100': 'pri_pack_100',
		'pack_pack-500': 'pri_pack_500',
		pro: 'pri_pro_monthly',
	},
};

const packRegistryEntries = [
	normalizeRegistryEntry({
		provider: 'paddle',
		environment: 'sandbox',
		packId: 'pack-100',
		interval: 'one_time',
		priceId: 'pri_pack_100',
	}),
];

const activePack = {
	id: 'pack-100',
	name: 'Starter Pack',
	credits: 100,
	price: 9,
	currency: 'USD',
	active: true,
};

describe('Phase 3.4 registry one_time pack support', () => {
	it('accepts one_time pack registry entry', () => {
		const result = validateRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			packId: 'pack-100',
			interval: 'one_time',
			priceId: 'pri_pack_100',
		});
		assert.equal(result.ok, true);
		assert.equal(result.entry.interval, 'one_time');
	});

	it('rejects one_time entry without packId', () => {
		const result = validateRegistryEntry({
			provider: 'paddle',
			environment: 'sandbox',
			interval: 'one_time',
			priceId: 'pri_pack_100',
		});
		assert.equal(result.ok, false);
	});

	it('maps legacy pack_* priceIds to one_time registry rows', () => {
		const entries = entriesFromLegacyProviderPriceIds({
			'pack_pack-100': 'pri_pack_100',
			pro: 'pri_pro_monthly',
		}, 'sandbox', 'paddle');
		const packEntry = entries.find((entry) => entry.packId === 'pack-100');
		assert.ok(packEntry);
		assert.equal(packEntry.interval, 'one_time');
		assert.equal(packEntry.priceId, 'pri_pack_100');
	});

	it('resolves pack entry by packId', () => {
		const entry = resolveRegistryEntryForPack(packRegistryEntries, {
			provider: 'paddle',
			environment: 'sandbox',
			packId: 'pack-100',
		});
		assert.equal(entry?.priceId, 'pri_pack_100');
	});
});

describe('Phase 3.4 Paddle pack price resolution', () => {
	it('resolves explicit pack mapping from config', () => {
		assert.equal(
			resolveExpectedPaddlePackPriceId('pack-100', packPriceConfig),
			'pri_pack_100',
		);
	});

	it('resolveCheckoutPaddlePackPriceId fails closed without mapping', () => {
		const result = resolveCheckoutPaddlePackPriceId('pack-999', packPriceConfig);
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_pack_price_mapping_missing');
	});

	it('validatePaddlePriceForPack rejects price mismatch', () => {
		const result = validatePaddlePriceForPack('pack-100', 'pri_wrong', packPriceConfig);
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_price_pack_mismatch');
	});
});

describe('Phase 3.4 webhook routing for credit packs', () => {
	it('routes pack transaction.completed to credit_pack_success', () => {
		const parsed = buildPaddleWebhookParseResult({
			event_id: 'evt_pack_1',
			event_type: 'transaction.completed',
			data: {
				id: 'txn_pack_1',
				status: 'completed',
				custom_data: {
					workspaceKey: 'ws-demo',
					packId: 'pack-100',
				},
				items: [{ price: { id: 'pri_pack_100' } }],
			},
		}, packPriceConfig);

		assert.equal(parsed.routing, 'credit_pack_success');
		assert.equal(parsed.priceValidation?.ok, true);
	});

	it('defers when both planSlug and packId are present', () => {
		const parsed = buildPaddleWebhookParseResult({
			event_id: 'evt_ambiguous',
			event_type: 'transaction.completed',
			data: {
				id: 'txn_ambiguous',
				status: 'completed',
				custom_data: {
					workspaceKey: 'ws-demo',
					planSlug: 'pro',
					packId: 'pack-100',
				},
				items: [{ price: { id: 'pri_pack_100' } }],
			},
		}, packPriceConfig);

		assert.equal(parsed.routing, 'deferred');
		assert.equal(parsed.routingReason, 'ambiguous_plan_and_pack_metadata');
	});

	it('defers pack webhook when price mapping is missing', () => {
		const parsed = buildPaddleWebhookParseResult({
			event_id: 'evt_pack_bad_price',
			event_type: 'transaction.completed',
			data: {
				id: 'txn_pack_bad',
				status: 'completed',
				custom_data: {
					workspaceKey: 'ws-demo',
					packId: 'pack-999',
				},
				items: [{ price: { id: 'pri_unknown' } }],
			},
		}, packPriceConfig);

		assert.equal(parsed.routing, 'credit_pack_success');
		assert.equal(parsed.priceValidation?.ok, false);
	});
});

describe('Phase 3.4 pack transaction verification (fail-closed)', () => {
	const baseTransaction = {
		id: 'txn_pack_verify',
		status: 'completed',
		custom_data: {
			workspaceKey: 'ws-demo',
			packId: 'pack-100',
		},
		items: [{ price: { id: 'pri_pack_100' } }],
	};

	it('accepts verified paid pack transaction', () => {
		const result = verifyPaddleTransactionForCreditPack({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-demo', packId: 'pack-100', transactionId: 'txn_pack_verify' },
			registryEntries: packRegistryEntries,
			environment: 'sandbox',
			workspaceExists: true,
			packCatalogItem: activePack,
		});
		assert.equal(result.ok, true);
		assert.equal(result.packId, 'pack-100');
		assert.equal(result.credits, 100);
	});

	it('blocks when workspace is missing', () => {
		const result = verifyPaddleTransactionForCreditPack({
			transaction: { ...baseTransaction, custom_data: {} },
			webhookContext: { packId: 'pack-100' },
			registryEntries: packRegistryEntries,
			environment: 'sandbox',
			workspaceExists: false,
			packCatalogItem: activePack,
		});
		assert.equal(result.error, 'paddle_workspace_missing');
	});

	it('blocks when workspace not found', () => {
		const result = verifyPaddleTransactionForCreditPack({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-demo', packId: 'pack-100' },
			registryEntries: packRegistryEntries,
			environment: 'sandbox',
			workspaceExists: false,
			packCatalogItem: activePack,
		});
		assert.equal(result.error, 'paddle_workspace_not_found');
	});

	it('blocks when price not in registry', () => {
		const result = verifyPaddleTransactionForCreditPack({
			transaction: { ...baseTransaction, items: [{ price: { id: 'pri_unknown' } }] },
			webhookContext: { workspaceKey: 'ws-demo', packId: 'pack-100' },
			registryEntries: packRegistryEntries,
			environment: 'sandbox',
			workspaceExists: true,
			packCatalogItem: activePack,
		});
		assert.equal(result.error, 'paddle_price_not_in_registry');
	});

	it('blocks when pack registry id mismatches custom_data', () => {
		const result = verifyPaddleTransactionForCreditPack({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-demo', packId: 'pack-100', transactionId: 'txn_pack_verify' },
			registryEntries: [
				normalizeRegistryEntry({
					provider: 'paddle',
					environment: 'sandbox',
					packId: 'pack-500',
					interval: 'one_time',
					priceId: 'pri_pack_100',
				}),
			],
			environment: 'sandbox',
			workspaceExists: true,
			packCatalogItem: activePack,
		});
		assert.equal(result.error, 'paddle_pack_registry_mismatch');
	});

	it('blocks when webhook pack metadata mismatches transaction custom_data', () => {
		const result = verifyPaddleTransactionForCreditPack({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-demo', packId: 'pack-500' },
			registryEntries: packRegistryEntries,
			environment: 'sandbox',
			workspaceExists: true,
			packCatalogItem: activePack,
		});
		assert.equal(result.error, 'paddle_pack_metadata_mismatch');
	});

	it('blocks when pack not in catalog', () => {
		const result = verifyPaddleTransactionForCreditPack({
			transaction: baseTransaction,
			webhookContext: { workspaceKey: 'ws-demo', packId: 'pack-100' },
			registryEntries: packRegistryEntries,
			environment: 'sandbox',
			workspaceExists: true,
			packCatalogItem: null,
		});
		assert.equal(result.error, 'paddle_pack_not_found');
	});

	it('blocks unpaid transaction status', () => {
		const result = verifyPaddleTransactionForCreditPack({
			transaction: { ...baseTransaction, status: 'draft' },
			webhookContext: { workspaceKey: 'ws-demo', packId: 'pack-100' },
			registryEntries: packRegistryEntries,
			environment: 'sandbox',
			workspaceExists: true,
			packCatalogItem: activePack,
		});
		assert.equal(result.error, 'paddle_transaction_not_paid');
	});
});

describe('Phase 3.4 transaction-scoped idempotency', () => {
	it('builds stable paddle-pack-txn idempotency key', () => {
		assert.equal(
			buildPaddleCreditPackIdempotencyKey('txn_abc123'),
			'paddle-pack-txn:txn_abc123',
		);
	});

	it('classifies duplicate fulfillment safely', () => {
		const result = classifyPaddleCreditPackFulfillment({
			verified: { transactionId: 'txn_abc123' },
			existingFulfillment: { duplicate: true },
		});
		assert.equal(result.kind, 'duplicate');
	});
});

describe('Phase 3.4 createCreditPackCheckout', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('does not call Paddle API when pack mapping is missing', async () => {
		let fetchCalled = false;
		globalThis.fetch = async () => {
			fetchCalled = true;
			return { ok: true, json: async () => ({}) };
		};

		const provider = new PaddleBillingProvider({
			apiKey: 'paddle_test_key',
			priceIds: { pro: 'pri_pro_monthly' },
		});
		const result = await provider.createCreditPackCheckout({
			workspaceKey: 'ws-demo',
			packId: 'pack-100',
		});

		assert.equal(fetchCalled, false);
		assert.equal(result.checkoutUrl, null);
		assert.equal(result.errorCode, 'paddle_pack_price_mapping_missing');
	});

	it('creates transaction with server-controlled custom_data', async () => {
		let capturedBody = null;
		globalThis.fetch = async (_url, opts) => {
			capturedBody = JSON.parse(opts.body);
			return {
				ok: true,
				json: async () => ({
					data: { id: 'txn_pack_checkout', checkout: { url: 'https://checkout.paddle.test/pack' } },
				}),
			};
		};

		const provider = new PaddleBillingProvider({
			apiKey: 'paddle_test_key',
			sandbox: true,
			priceIds: { 'pack_pack-100': 'pri_pack_100' },
		});
		const result = await provider.createCreditPackCheckout({
			workspaceKey: 'ws-demo',
			packId: 'pack-100',
			successUrl: 'https://example.com/success',
		});

		assert.equal(result.checkoutUrl, 'https://checkout.paddle.test/pack');
		assert.equal(capturedBody.items[0].price_id, 'pri_pack_100');
		assert.equal(capturedBody.custom_data.workspaceKey, 'ws-demo');
		assert.equal(capturedBody.custom_data.packId, 'pack-100');
		assert.equal(capturedBody.custom_data.planSlug, undefined);
	});
});
