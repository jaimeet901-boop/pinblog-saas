import { BILLING_PROVIDERS } from './base.js';
import { NoneBillingProvider } from './none.js';
import { StripeBillingProvider } from './stripe.js';
import { PaddleBillingProvider } from './paddle.js';
import { LemonSqueezyBillingProvider } from './lemonsqueezy.js';
import { getPlatformSettings } from '../../platform-settings.js';

const PROVIDER_CTORS = {
	none: NoneBillingProvider,
	stripe: StripeBillingProvider,
	paddle: PaddleBillingProvider,
	lemonsqueezy: LemonSqueezyBillingProvider,
};

export function normalizeProviderCode(value) {
	const code = String(value || 'none').trim().toLowerCase();
	return BILLING_PROVIDERS.includes(code) ? code : 'none';
}

export async function resolveBillingConfig() {
	const { settings } = await getPlatformSettings().catch(() => ({ settings: null }));
	const billing = settings?.billing || {};
	const provider = normalizeProviderCode(billing.provider);
	return {
		provider,
		checkoutEnabled: Boolean(billing.checkoutEnabled) && provider !== 'none',
		planEnforcementEnabled: Boolean(billing.planEnforcementEnabled),
		gracePeriodDays: Math.max(0, Number(billing.gracePeriodDays) || 3),
		autoRenew: billing.autoRenew !== false,
		autoResetCredits: billing.autoResetCredits !== false,
		webhookPath: billing.webhookPath || `/billing/webhooks/${provider}`,
		providers: {
			stripe: billing.providers?.stripe || {},
			paddle: billing.providers?.paddle || {},
			lemonsqueezy: billing.providers?.lemonsqueezy || {},
		},
		raw: billing,
	};
}

export async function getBillingProvider(overrideCode = null) {
	const config = await resolveBillingConfig();
	const code = normalizeProviderCode(overrideCode || config.provider);
	const Ctor = PROVIDER_CTORS[code] || NoneBillingProvider;
	const providerConfig = code === 'none' ? {} : (config.providers?.[code] || {});
	return new Ctor(providerConfig);
}

export async function listBillingProviders() {
	const config = await resolveBillingConfig();
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
