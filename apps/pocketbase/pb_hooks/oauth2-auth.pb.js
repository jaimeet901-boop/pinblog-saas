/// <reference path="../pb_data/types.d.ts" />

function getEnv(name) {
	return String($os.getenv(name) || '').trim();
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

function configureUsersOAuth2() {
	const users = $app.findCollectionByNameOrId('users');
	if (!users) {
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
			userInfoURL: 'https://www.googleapis.com/oauth2/v2/userinfo',
			displayName: 'Google',
		}));
	}

	const pinterestClientId = getEnv('PINTEREST_CLIENT_ID');
	const pinterestClientSecret = getEnv('PINTEREST_CLIENT_SECRET');
	if (pinterestClientId && pinterestClientSecret) {
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

	const existingOAuth2 = users.oauth2 || {};
	const existingProviders = Array.isArray(existingOAuth2.providers) ? existingOAuth2.providers : [];
	const preservedProviders = existingProviders.filter((provider) => !['google', 'pinterest'].includes(provider.name));

	users.oauth2 = {
		...existingOAuth2,
		enabled: true,
		mappedFields: {
			id: 'id',
			name: 'name',
			username: 'username',
			avatarURL: 'avatarURL',
		},
		providers: [...preservedProviders, ...providers],
	};

	$app.save(users);
	$app.logger().info('PocketBase OAuth2 providers configured for users collection');
}

try {
	configureUsersOAuth2();
} catch (error) {
	$app.logger().error('Failed to configure PocketBase OAuth2 providers', error);
}