import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../../utils/secretCrypto.js';
import {
	PAYPAL_PLAN_ID_SLUGS,
	normalizePayPalPlanIds,
	resolveProviderRuntimeConfig,
	sanitizeBillingForPublic,
	stripControlPlaneBillingWrites,
	toPublicBillingConfig,
	publicProviderConfig,
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

test('sanitizeBillingForPublic redacts disasterRecovery backup ciphertext', () => {
	const publicBilling = sanitizeBillingForPublic({
		provider: 'stripe',
		providers: {
			stripe: { mode: 'test', secretKeyCipher: 'enc:v1:live', secretKeySet: true },
		},
		disasterRecovery: {
			policyVersion: 1,
			backups: [{
				id: 'drb_1',
				manifest: { policyVersion: 1, manifestVersion: 1 },
				payload: {
					providers: {
						stripe: { mode: 'test', secretKeyCipher: 'enc:v1:backup', secretKeySet: true },
					},
				},
			}],
			checkpoints: { preRestore: null },
		},
	});
	const backupStripe = publicBilling.disasterRecovery.backups[0].payload.providers.stripe;
	assert.equal(backupStripe.secretKeyCipher, undefined);
	assert.equal(backupStripe.secretKeySet, true);
	assert.equal(publicBilling.disasterRecovery.backups[0].payloadRedacted, true);
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

test('normalizePayPalPlanIds trims and removes empty slugs', () => {
	const normalized = normalizePayPalPlanIds({
		starter: ' P-STARTER ',
		pro: '',
		business: 'P-BUSINESS',
	}, { starter: 'old', enterprise: 'P-ENT' });
	assert.equal(normalized.starter, 'P-STARTER');
	assert.equal(normalized.business, 'P-BUSINESS');
	assert.equal(normalized.enterprise, 'P-ENT');
	assert.equal(normalized.pro, undefined);
});

test('publicProviderConfig exposes paypal planIds without secrets', () => {
	const config = publicProviderConfig('paypal', {
		mode: 'test',
		enabled: true,
		clientId: 'client_test',
		defaultPlanId: 'P-STARTER',
		planIds: {
			starter: 'P-STARTER',
			pro: 'P-PRO',
		},
		clientSecretCipher: 'enc:v1:secret',
		clientSecretSet: true,
	});
	assert.deepEqual(config.planIds, { starter: 'P-STARTER', pro: 'P-PRO' });
	assert.equal(config.defaultPlanId, 'P-STARTER');
	assert.equal(config.clientSecretSet, true);
	assert.equal(config.clientSecret, undefined);
	assert.deepEqual(PAYPAL_PLAN_ID_SLUGS, ['starter', 'pro', 'business', 'enterprise']);
});

test('resolveProviderRuntimeConfig passes through paypal planIds', () => {
	const resolved = resolveProviderRuntimeConfig('paypal', {
		mode: 'test',
		planIds: { pro: 'P-PRO' },
		defaultPlanId: 'P-STARTER',
	});
	assert.equal(resolved.planIds.pro, 'P-PRO');
	assert.equal(resolved.defaultPlanId, 'P-STARTER');
});
