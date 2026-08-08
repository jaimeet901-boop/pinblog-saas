import { BILLING_PROVIDERS } from './base.js';
import { NoneBillingProvider } from './none.js';
import { StripeBillingProvider } from './stripe.js';
import { PaddleBillingProvider } from './paddle.js';
import { LemonSqueezyBillingProvider } from './lemonsqueezy.js';
import { PayPalBillingProvider } from './paypal.js';
import { resolveProviderRuntimeConfig } from '../control-plane-helpers.js';
import { getRawBillingPayload } from '../control-plane.js';
import { getBillingRequestCache } from '../request-cache.js';

const PROVIDER_CTORS = {
	none: NoneBillingProvider,
	stripe: StripeBillingProvider,
	paddle: PaddleBillingProvider,
	lemonsqueezy: LemonSqueezyBillingProvider,
	paypal: PayPalBillingProvider,
};

export function normalizeProviderCode(value) {
	const code = String(value || 'none').trim().toLowerCase();
	return BILLING_PROVIDERS.includes(code) ? code : 'none';
}

async function buildBillingConfig() {
	const { billing } = await getRawBillingPayload().catch(() => ({ billing: {} }));
	const provider = normalizeProviderCode(billing.provider);

	const providers = {
		stripe: resolveProviderRuntimeConfig('stripe', billing.providers?.stripe || {}),
		paddle: resolveProviderRuntimeConfig('paddle', billing.providers?.paddle || {}),
		lemonsqueezy: resolveProviderRuntimeConfig('lemonsqueezy', billing.providers?.lemonsqueezy || {}),
		paypal: resolveProviderRuntimeConfig('paypal', billing.providers?.paypal || {}),
	};

	return {
		provider,
		checkoutEnabled: Boolean(billing.checkoutEnabled) && provider !== 'none',
		planEnforcementEnabled: Boolean(billing.planEnforcementEnabled),
		gracePeriodDays: Math.max(0, Number(billing.gracePeriodDays) || 3),
		autoRenew: billing.autoRenew !== false,
		autoResetCredits: billing.autoResetCredits !== false,
		webhookPath: billing.webhookPath || `/billing/webhooks/${provider}`,
		providers,
		raw: billing,
	};
}

/**
 * Resolve billing config for runtime.
 * Priority: encrypted Admin configuration → environment variables → provider defaults.
 * Reuses a per-request cache when runWithBillingRequestCache / middleware is active.
 */
export async function resolveBillingConfig() {
	const cache = getBillingRequestCache();
	if (cache) {
		if (!cache.resolvedConfigPromise) {
			cache.resolvedConfigPromise = buildBillingConfig();
		}
		return cache.resolvedConfigPromise;
	}
	return buildBillingConfig();
}

export async function getBillingProvider(overrideCode = null, options = {}) {
	const config = options.config || await resolveBillingConfig();
	const code = normalizeProviderCode(overrideCode || config.provider);
	const Ctor = PROVIDER_CTORS[code] || NoneBillingProvider;
	const providerConfig = code === 'none' ? {} : (config.providers?.[code] || {});
	return new Ctor(providerConfig);
}

export async function listBillingProviders(options = {}) {
	const config = options.config || await resolveBillingConfig();
	return BILLING_PROVIDERS.map((code) => {
		const Ctor = PROVIDER_CTORS[code];
		const instance = new Ctor(config.providers?.[code] || {});
		return {
			...instance.describe(),
			selected: config.provider === code,
		};
	});
}

export { BILLING_PROVIDERS, PROVIDER_CTORS };
