/**
 * PR-09 — Paddle-only credit pack purchase UI tests.
 * Run: node --test src/lib/__tests__/creditPackPurchase.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CREDIT_PACK_CHECKOUT_CANCEL_PATH,
	CREDIT_PACK_CHECKOUT_SUCCESS_PATH,
	CREDIT_PACK_PURCHASE_PATH,
	CREDIT_PACKS_PATH,
	PAYPAL_CREDIT_PACK_UNAVAILABLE_MESSAGE,
	buildCreditPackPurchaseBody,
	canBuyCreditPack,
	creditPackPurchaseHiddenReason,
	listCreditPackItems,
	resolveCreditPackCheckoutUrl,
} from '../creditPackPurchase.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(
	path.resolve(here, '../../pages/app/SubscriptionPage.jsx'),
	'utf8',
);

const catalog = {
	enabled: true,
	items: [
		{ id: 'pack-100', name: 'Starter Pack', credits: 100, price: 9, currency: 'USD', active: true },
		{ id: 'pack-500', name: 'Growth Pack', credits: 500, price: 29, currency: 'USD', active: true },
		{ id: '', name: 'Broken', credits: 10, price: 1, active: true },
		{ id: 'pack-zero', name: 'Zero', credits: 0, price: 0, active: true },
	],
};

describe('PR-09 credit pack catalog', () => {
	it('renders existing creditPacks.items and drops invalid rows', () => {
		const items = listCreditPackItems(catalog);
		assert.deepEqual(items.map((pack) => pack.id), ['pack-100', 'pack-500']);
		assert.equal(listCreditPackItems(null).length, 0);
		assert.equal(listCreditPackItems({ items: [] }).length, 0);
	});
});

describe('PR-09 Buy visibility', () => {
	it('shows Buy only when billing.provider is paddle and checkoutEnabled is true', () => {
		assert.equal(canBuyCreditPack({ provider: 'paddle', checkoutEnabled: true }), true);
		assert.equal(creditPackPurchaseHiddenReason({ provider: 'paddle', checkoutEnabled: true }), '');
	});

	it('hides Buy when checkout is disabled', () => {
		assert.equal(canBuyCreditPack({ provider: 'paddle', checkoutEnabled: false }), false);
		assert.equal(
			creditPackPurchaseHiddenReason({ provider: 'paddle', checkoutEnabled: false }),
			'checkout_disabled',
		);
	});

	it('hides Buy for Stripe and Lemon Squeezy', () => {
		assert.equal(canBuyCreditPack({ provider: 'stripe', checkoutEnabled: true }), false);
		assert.equal(canBuyCreditPack({ provider: 'lemonsqueezy', checkoutEnabled: true }), false);
		assert.equal(creditPackPurchaseHiddenReason({ provider: 'stripe', checkoutEnabled: true }), 'hidden');
		assert.equal(creditPackPurchaseHiddenReason({ provider: 'lemonsqueezy', checkoutEnabled: true }), 'hidden');
	});

	it('does not expose PayPal as a Buy action', () => {
		assert.equal(canBuyCreditPack({ provider: 'paypal', checkoutEnabled: true }), false);
		assert.equal(creditPackPurchaseHiddenReason({ provider: 'paypal', checkoutEnabled: true }), 'paypal_stub');
		assert.equal(
			PAYPAL_CREDIT_PACK_UNAVAILABLE_MESSAGE,
			'PayPal credit-pack checkout is not enabled in this milestone.',
		);
	});
});

describe('PR-09 purchase request', () => {
	it('posts to the existing packs purchase endpoint with packId and return URLs', () => {
		assert.equal(CREDIT_PACKS_PATH, '/workspace/v1/credits/packs');
		assert.equal(CREDIT_PACK_PURCHASE_PATH, '/workspace/v1/credits/packs/purchase');
		assert.deepEqual(
			buildCreditPackPurchaseBody('pack-100', 'https://seodeva.com'),
			{
				packId: 'pack-100',
				successUrl: 'https://seodeva.com/app/subscription?checkout=success',
				cancelUrl: 'https://seodeva.com/app/subscription?checkout=cancel',
			},
		);
		assert.equal(CREDIT_PACK_CHECKOUT_SUCCESS_PATH, '/app/subscription?checkout=success');
		assert.equal(CREDIT_PACK_CHECKOUT_CANCEL_PATH, '/app/subscription?checkout=cancel');
	});

	it('rejects null, empty, and non-http checkout URLs and never treats them as success', () => {
		assert.equal(resolveCreditPackCheckoutUrl({
			status: 'checkout_pending',
			checkoutUrl: null,
		}).ok, false);
		assert.equal(resolveCreditPackCheckoutUrl({
			status: 'checkout_pending',
			checkout: { checkoutUrl: null },
		}).ok, false);
		assert.equal(resolveCreditPackCheckoutUrl({
			status: 'checkout_pending',
			checkoutUrl: '',
		}).ok, false);
		assert.equal(resolveCreditPackCheckoutUrl({
			status: 'checkout_pending',
			checkoutUrl: 'javascript:alert(1)',
		}).ok, false);
		assert.equal(resolveCreditPackCheckoutUrl({
			status: 'provider_required',
			checkoutUrl: 'https://checkout.paddle.test/pack',
		}).ok, false);
		assert.deepEqual(resolveCreditPackCheckoutUrl({
			status: 'checkout_pending',
			checkout: { checkoutUrl: 'https://checkout.paddle.test/pack' },
		}), { ok: true, checkoutUrl: 'https://checkout.paddle.test/pack' });
	});
});

describe('PR-09 SubscriptionPage wiring', () => {
	it('lists packs, purchases via the existing POST, and preserves cancel UI', () => {
		assert.match(pageSource, /CREDIT_PACKS_PATH/);
		assert.match(pageSource, /CREDIT_PACK_PURCHASE_PATH/);
		assert.match(pageSource, /listCreditPackItems/);
		assert.match(pageSource, /canBuyCreditPack\(billing\)/);
		assert.match(pageSource, /buildCreditPackPurchaseBody/);
		assert.match(pageSource, /resolveCreditPackCheckoutUrl/);
		assert.match(pageSource, /SUBSCRIPTION_CANCEL_PATH/);
		assert.match(pageSource, /canShowSubscriptionCancel\(subscription\)/);
		assert.equal(/atPeriodEnd:\s*false/.test(pageSource), false);
	});

	it('does not treat a null checkoutUrl as a successful purchase', () => {
		assert.match(pageSource, /resolveCreditPackCheckoutUrl\(payload\)/);
		assert.equal(/window\.location\.assign\(\s*payload\.checkoutUrl/.test(pageSource), false);
	});
});
