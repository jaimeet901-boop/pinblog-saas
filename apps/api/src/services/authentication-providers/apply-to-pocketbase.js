/**
 * Apply Admin-managed authentication providers into PocketBase users.oauth2.
 * Does not touch publishing OAuth (Pinterest / Facebook channel packs).
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import logger from '../../utils/logger.js';
import { AUTH_PROVIDER_IDS } from './catalog.js';
import { listEnabledAuthenticationCredentials } from './credentials.js';

function buildPocketBaseProvider(credentials) {
	return {
		name: credentials.id,
		clientId: credentials.clientId,
		clientSecret: credentials.clientSecret,
		authURL: credentials.authURL || '',
		tokenURL: credentials.tokenURL || '',
		userInfoURL: credentials.userInfoURL || '',
		displayName: credentials.displayName || credentials.id,
		pkce: credentials.pkce !== false,
	};
}

/**
 * Merge enabled auth providers into the users auth collection oauth2 config.
 * Preserves unrelated custom providers (not in AUTH_PROVIDER_IDS).
 */
export async function applyAuthenticationProvidersToPocketBase() {
	const users = await pocketbaseClient.collections.getOne('users');
	const existingOAuth2 = users?.oauth2 && typeof users.oauth2 === 'object' ? users.oauth2 : {};
	const existingProviders = Array.isArray(existingOAuth2.providers) ? existingOAuth2.providers : [];

	const preserved = existingProviders.filter((provider) => {
		const name = String(provider?.name || '').trim().toLowerCase();
		return name && !AUTH_PROVIDER_IDS.includes(name);
	});

	const enabled = await listEnabledAuthenticationCredentials();
	const managed = enabled.map(buildPocketBaseProvider);

	const nextProviders = [...preserved, ...managed];
	const oauth2 = {
		...existingOAuth2,
		enabled: nextProviders.length > 0 ? true : Boolean(existingOAuth2.enabled && preserved.length > 0),
		mappedFields: existingOAuth2.mappedFields || {
			id: 'id',
			name: 'name',
			username: 'username',
			avatarURL: 'avatarURL',
		},
		providers: nextProviders,
	};

	await pocketbaseClient.collections.update(users.id, { oauth2 });
	logger.info('PocketBase users.oauth2 updated from authentication providers', {
		managed: managed.map((item) => item.name),
		preserved: preserved.map((item) => item.name),
	});
	return {
		managed: managed.map((item) => item.name),
		preserved: preserved.map((item) => item.name),
		enabled: Boolean(oauth2.enabled),
	};
}
