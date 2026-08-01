/// <reference path="../pb_data/types.d.ts" />

/**
 * Configure OAuth2 login providers for the users auth collection.
 *
 * Authority:
 * - Preferred: Admin "Authentication Providers" (API applies users.oauth2 on save/startup).
 * - Fallback: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (and optional PINTEREST_*) env on PB boot.
 *
 * Publishing OAuth (Pinterest Hub / Facebook Hub) is unrelated — never configure those here.
 *
 * IMPORTANT:
 * - Must NOT run at module load time (DAO is not ready → nil panic).
 * - Must call e.next() first inside onBootstrap before any DB access.
 * - Failures are logged and swallowed so PocketBase always boots.
 */
onBootstrap((e) => {
	e.next();

	function getEnv(name) {
		return String($os.getenv(name) || '').trim();
	}

	function findCollectionSafe(nameOrId) {
		if (!nameOrId) {
			return null;
		}

		try {
			const collections = $app.findAllCollections();
			if (!collections || !collections.length) {
				return null;
			}

			for (let i = 0; i < collections.length; i += 1) {
				const collection = collections[i];
				if (!collection) {
					continue;
				}
				if (collection.name === nameOrId || collection.id === nameOrId) {
					return collection;
				}
			}
		} catch (_) {
			/* Collections DAO may still be unavailable */
		}

		try {
			return $app.findCollectionByNameOrId(nameOrId);
		} catch (_) {
			return null;
		}
	}

	function providerConfig({ name, clientId, clientSecret, authURL, tokenURL, userInfoURL, displayName }) {
		return {
			name,
			clientId,
			clientSecret,
			authURL,
			tokenURL,
			userInfoURL,
			displayName,
			pkce: true,
		};
	}

	/** Never map provider id → record primary key (Google IDs fail PB id validation). */
	function safeMappedFields(existing) {
		const current = existing && typeof existing === 'object' ? existing : {};
		const next = {
			id: '',
			name: current.name || 'name',
			username: current.username || 'username',
			avatarURL: current.avatarURL === 'avatarURL' ? 'avatar' : (current.avatarURL || 'avatar'),
		};
		return next;
	}

	try {
		const users = findCollectionSafe('users');
		if (!users) {
			$app.logger().info('Skipping OAuth2 setup: users collection does not exist yet');
			return;
		}

		const existingOAuth2 = users.oauth2 || {};
		const existingProviders = Array.isArray(existingOAuth2.providers) ? existingOAuth2.providers : [];
		const hasGoogle = existingProviders.some((provider) => provider && provider.name === 'google' && provider.clientId);
		const mappedFields = safeMappedFields(existingOAuth2.mappedFields);
		const mappedNeedsRepair = String(existingOAuth2?.mappedFields?.id || '') === 'id'
			|| String(existingOAuth2?.mappedFields?.avatarURL || '') === 'avatarURL';

		const GOOGLE_USERINFO_V3 = 'https://www.googleapis.com/oauth2/v3/userinfo';
		const providersNeedUserInfoRepair = existingProviders.some((provider) => (
			provider
			&& provider.name === 'google'
			&& String(provider.userInfoURL || '').includes('/oauth2/v2/userinfo')
		));

		// If Admin/API already configured Google, do not overwrite providers with empty env.
		// Still repair dangerous mappedFields and legacy Google userInfo v2 URL.
		if (hasGoogle) {
			if (mappedNeedsRepair || providersNeedUserInfoRepair) {
				const repairedProviders = existingProviders.map((provider) => {
					if (!provider || provider.name !== 'google') return provider;
					const url = String(provider.userInfoURL || '');
					if (url.includes('/oauth2/v2/userinfo') || !url) {
						return { ...provider, userInfoURL: GOOGLE_USERINFO_V3 };
					}
					return provider;
				});
				users.oauth2 = {
					...existingOAuth2,
					mappedFields,
					providers: repairedProviders,
				};
				$app.save(users);
				$app.logger().info('PocketBase OAuth2 Google config repaired', {
					mappedFields: mappedNeedsRepair,
					userInfoV3: providersNeedUserInfoRepair,
				});
			} else {
				$app.logger().info('PocketBase OAuth2 Google already configured — skipping env bootstrap');
			}
			return;
		}

		const providers = [];
		const googleClientId = getEnv('GOOGLE_CLIENT_ID');
		const googleClientSecret = getEnv('GOOGLE_CLIENT_SECRET');
		if (googleClientId && googleClientSecret) {
			providers.push(providerConfig({
				name: 'google',
				clientId: googleClientId,
				clientSecret: googleClientSecret,
				authURL: 'https://accounts.google.com/o/oauth2/v2/auth',
				tokenURL: 'https://oauth2.googleapis.com/token',
				userInfoURL: GOOGLE_USERINFO_V3,
				displayName: 'Google',
			}));
		}

		// Optional legacy env login provider (not Admin Authentication Providers catalog).
		const pinterestClientId = getEnv('PINTEREST_CLIENT_ID');
		const pinterestClientSecret = getEnv('PINTEREST_CLIENT_SECRET');
		const hasPinterestLogin = existingProviders.some((provider) => provider && provider.name === 'pinterest');
		if (!hasPinterestLogin && pinterestClientId && pinterestClientSecret) {
			providers.push(providerConfig({
				name: 'pinterest',
				clientId: pinterestClientId,
				clientSecret: pinterestClientSecret,
				authURL: 'https://www.pinterest.com/oauth/',
				tokenURL: 'https://api.pinterest.com/v5/oauth/token',
				userInfoURL: 'https://api.pinterest.com/v5/user_account',
				displayName: 'Pinterest',
			}));
		}

		if (providers.length === 0) {
			return;
		}

		const preservedProviders = existingProviders.filter((provider) => {
			if (!provider || !provider.name) return false;
			if (provider.name === 'google' && googleClientId) return false;
			if (provider.name === 'pinterest' && pinterestClientId) return false;
			return true;
		});

		users.oauth2 = {
			...existingOAuth2,
			enabled: true,
			mappedFields,
			providers: [...preservedProviders, ...providers],
		};

		$app.save(users);
		$app.logger().info('PocketBase OAuth2 providers configured from env fallback for users collection');
	} catch (error) {
		try {
			$app.logger().error('Failed to configure PocketBase OAuth2 providers', 'error', String(error?.message || error || ''));
		} catch (_) {
			/* Never block startup if logging also fails. */
		}
	}
});
