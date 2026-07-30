import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../../utils/secretCrypto.js';
import {
	resolveProviderRuntimeConfig,
	sanitizeBillingForPublic,
	stripControlPlaneBillingWrites,
	toPublicBillingConfig,
} from './control-plane-helpers.js';
import { getBillingRequestCache, runWithBillingRequestCache } from './request-cache.js';

test('resolveProviderRuntimeConfig prefers decrypted admin secrets over empty config', () => {
	process.env.PB_ENCRYPTION_KEY = process.env.PB_ENCRYPTION_KEY || 'bp1-test-encryption-key-32bytes!!';
	const cipher = encryptSecret('sk_test_admin_priority');
	const resolved = resolveProviderRuntimeConfig('stripe', {
		mode: 'test',
		secretKeyCipher: cipher,
		secretKeySet: true,
		webhookSecretCipher: encryptSecret('whsec_test'),
		webhookSecretSet: true,
	});
	assert.equal(resolved.secretKey, 'sk_test_admin_priority');
	assert.equal(resolved.webhookSecret, 'whsec_test');
	assert.equal(resolved.mode, 'test');
});

test('sanitizeBillingForPublic never exposes ciphertext or plaintext secrets', () => {
	const publicBilling = sanitizeBillingForPublic({
		provider: 'stripe',
		checkoutEnabled: true,
		providers: {
			stripe: {
				secretKey: 'sk_live_should_not_leak',
				secretKeyCipher: 'enc:v1:fake',
				webhookSecret: 'whsec_should_not_leak',
				secretKeySet: true,
				webhookSecretSet: true,
				mode: 'live',
			},
		},
	});
	const stripe = publicBilling.providers.stripe;
	assert.equal(stripe.secretKeySet, true);
	assert.equal(stripe.webhookSecretSet, true);
	assert.equal(stripe.secretKey, undefined);
	assert.equal(stripe.secretKeyCipher, undefined);
	assert.equal(stripe.webhookSecret, undefined);
	assert.equal(stripe.mode, 'live');
});

test('stripControlPlaneBillingWrites preserves current provider authority fields', () => {
	const incoming = {
		billing: {
			provider: 'paddle',
			checkoutEnabled: true,
			providers: { stripe: { secretKey: 'hack' } },
			gracePeriodDays: 9,
			planEnforcementEnabled: true,
		},
		credits: { defaultFreeCredits: 10 },
	};
	const current = {
		provider: 'stripe',
		checkoutEnabled: false,
		providers: { stripe: { secretKeyCipher: 'enc:v1:keep' } },
		gracePeriodDays: 3,
	};
	const safe = stripControlPlaneBillingWrites(incoming, current);
	assert.equal(safe.billing.provider, 'stripe');
	assert.equal(safe.billing.checkoutEnabled, false);
	assert.deepEqual(safe.billing.providers, current.providers);
	assert.equal(safe.billing.gracePeriodDays, 9);
	assert.equal(safe.billing.planEnforcementEnabled, true);
	assert.equal(safe.credits.defaultFreeCredits, 10);
});

test('toPublicBillingConfig strips decrypted secrets and raw ciphertext from API DTOs', () => {
	const publicConfig = toPublicBillingConfig({
		provider: 'stripe',
		checkoutEnabled: true,
		planEnforcementEnabled: false,
		gracePeriodDays: 3,
		autoRenew: true,
		autoResetCredits: true,
		webhookPath: '/billing/webhooks/stripe',
		providers: {
			stripe: {
				mode: 'live',
				secretKey: 'sk_live_leaked',
				webhookSecret: 'whsec_leaked',
			},
		},
		raw: {
			providers: {
				stripe: { secretKeyCipher: 'enc:v1:should-not-appear' },
			},
		},
	});
	assert.equal(publicConfig.provider, 'stripe');
	assert.equal(publicConfig.providers.stripe.secretKeySet, true);
	assert.equal(publicConfig.providers.stripe.webhookSecretSet, true);
	assert.equal(publicConfig.providers.stripe.secretKey, undefined);
	assert.equal(publicConfig.providers.stripe.webhookSecret, undefined);
	assert.equal(publicConfig.raw, undefined);
	assert.equal(publicConfig.providers.stripe.secretKeyCipher, undefined);
});

test('toPublicBillingConfig and sanitizeBillingForPublic share the same provider masking rules', () => {
	const inputProviders = {
		stripe: {
			mode: 'test',
			secretKey: 'sk_test_x',
			webhookSecretCipher: 'enc:v1:abc',
			webhookSecretSet: true,
			publishableKey: 'pk_test_ok',
		},
	};
	const fromSanitize = sanitizeBillingForPublic({ providers: inputProviders }).providers.stripe;
	const fromPublic = toPublicBillingConfig({ provider: 'stripe', providers: inputProviders }).providers.stripe;
	assert.equal(fromSanitize.secretKeySet, fromPublic.secretKeySet);
	assert.equal(fromSanitize.webhookSecretSet, fromPublic.webhookSecretSet);
	assert.equal(fromSanitize.publishableKey, fromPublic.publishableKey);
	assert.equal(fromSanitize.secretKey, undefined);
	assert.equal(fromPublic.secretKey, undefined);
});

test('billing request cache is request-scoped and not global', async () => {
	assert.equal(getBillingRequestCache(), null);
	await runWithBillingRequestCache(async () => {
		const cache = getBillingRequestCache();
		assert.ok(cache);
		cache.resolvedConfigPromise = Promise.resolve({ provider: 'stripe' });
		const again = getBillingRequestCache();
		assert.equal(await again.resolvedConfigPromise.then((c) => c.provider), 'stripe');
	});
	assert.equal(getBillingRequestCache(), null);
});
