/**
 * Pure merge/skip planner for Admin → PocketBase users.oauth2.
 * Kept free of PocketBase I/O so startup wipe protection can be unit-tested.
 */

import { AUTH_PROVIDER_IDS } from './catalog.js';

export function preservedCustomProviders(existingProviders = []) {
	return existingProviders.filter((provider) => {
		const name = String(provider?.name || '').trim().toLowerCase();
		return name && !AUTH_PROVIDER_IDS.includes(name);
	});
}

/**
 * Decide the next users.oauth2 provider list.
 * Startup/seed (replaceManaged=false) must not wipe existing Google when the
 * Admin vault has nothing configured. Admin save/reset passes replaceManaged=true.
 */
export function planAuthenticationProvidersApply({
	existingOAuth2 = {},
	managedProviders = [],
	replaceManaged = false,
} = {}) {
	const existingProviders = Array.isArray(existingOAuth2.providers) ? existingOAuth2.providers : [];
	const preserved = preservedCustomProviders(existingProviders);

	if (managedProviders.length === 0 && replaceManaged !== true) {
		return {
			skipProviderWrite: true,
			providers: existingProviders,
			enabled: Boolean(existingOAuth2.enabled),
			preserved: preserved.map((item) => item.name),
			managed: [],
		};
	}

	const nextProviders = [...preserved, ...managedProviders];
	return {
		skipProviderWrite: false,
		providers: nextProviders,
		enabled: nextProviders.length > 0 ? true : Boolean(existingOAuth2.enabled && preserved.length > 0),
		preserved: preserved.map((item) => item.name),
		managed: managedProviders.map((item) => item.name),
	};
}
