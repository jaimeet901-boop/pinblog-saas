/**
 * Apply Admin-managed authentication providers into PocketBase users.oauth2.
 * Does not touch publishing OAuth (Pinterest / Facebook channel packs).
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import logger from '../../utils/logger.js';
import { listEnabledAuthenticationCredentials } from './credentials.js';
import { normalizeAuthOAuth2MappedFields } from './oauth2-mapped-fields.js';
import { planAuthenticationProvidersApply } from './apply-plan.js';

export { planAuthenticationProvidersApply } from './apply-plan.js';

function buildPocketBaseProvider(credentials) {
	let userInfoURL = credentials.userInfoURL || '';
	// PocketBase Google FetchAuthUser expects v3 JSON (sub, email_verified).
	if (credentials.id === 'google' && String(userInfoURL).includes('/oauth2/v2/userinfo')) {
		userInfoURL = 'https://www.googleapis.com/oauth2/v3/userinfo';
	}
	return {
		name: credentials.id,
		clientId: credentials.clientId,
		clientSecret: credentials.clientSecret,
		authURL: credentials.authURL || '',
		tokenURL: credentials.tokenURL || '',
		userInfoURL,
		displayName: credentials.displayName || credentials.id,
		pkce: credentials.pkce !== false,
	};
}

/**
 * Merge enabled auth providers into the users auth collection oauth2 config.
 * Preserves unrelated custom providers (not in AUTH_PROVIDER_IDS).
 *
 * @param {{ replaceManaged?: boolean }} [options]
 *   replaceManaged=true: Admin save/reset may replace managed providers even when none are enabled.
 *   replaceManaged=false (startup/seed): skip write when vault is unconfigured so existing Google is kept.
 */
export async function applyAuthenticationProvidersToPocketBase({ replaceManaged = false } = {}) {
	const users = await pocketbaseClient.collections.getOne('users');
	const existingOAuth2 = users?.oauth2 && typeof users.oauth2 === 'object' ? users.oauth2 : {};
	const existingProviders = Array.isArray(existingOAuth2.providers) ? existingOAuth2.providers : [];

	const enabled = await listEnabledAuthenticationCredentials();
	const managed = enabled.map(buildPocketBaseProvider);
	const plan = planAuthenticationProvidersApply({
		existingOAuth2: { ...existingOAuth2, providers: existingProviders },
		managedProviders: managed,
		replaceManaged,
	});

	if (plan.skipProviderWrite) {
		logger.info('PocketBase users.oauth2 apply skipped — Admin vault unconfigured, existing providers preserved', {
			existing: existingProviders.map((item) => item?.name).filter(Boolean),
		});
		return {
			skipped: true,
			managed: [],
			preserved: plan.preserved,
			enabled: plan.enabled,
		};
	}

	const oauth2 = {
		...existingOAuth2,
		enabled: plan.enabled,
		// Always normalize — never keep mappedFields.id = "id" (breaks Google signup).
		mappedFields: normalizeAuthOAuth2MappedFields(existingOAuth2.mappedFields),
		providers: plan.providers,
	};

	await pocketbaseClient.collections.update(users.id, { oauth2 });
	logger.info('PocketBase users.oauth2 updated from authentication providers', {
		managed: plan.managed,
		preserved: plan.preserved,
	});
	return {
		skipped: false,
		managed: plan.managed,
		preserved: plan.preserved,
		enabled: Boolean(oauth2.enabled),
	};
}
