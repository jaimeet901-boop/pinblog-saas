const PLACEHOLDER_APP_ID = 'YOUR_FACEBOOK_APP_ID';

export function isPlaceholderFacebookAppId(appId, placeholder = PLACEHOLDER_APP_ID) {
	const value = String(appId || '').trim();
	if (!value) return true;
	return /^YOUR_FACEBOOK/i.test(value) || /^PENDING_/i.test(value) || value === placeholder;
}

/**
 * Pure readiness check used by OAuth start.
 * Meta has no Trial Access gate — complete App ID + Secret is enough to start,
 * unless Admin explicitly disabled OAuth.
 */
export function evaluateFacebookOAuthReadiness(credentials = {}, placeholder = PLACEHOLDER_APP_ID) {
	if (isPlaceholderFacebookAppId(credentials.appId, placeholder) || !credentials.appSecret) {
		return {
			ok: false,
			status: 503,
			errorCode: 'FACEBOOK_OAUTH_PENDING',
			message: 'Facebook OAuth is not ready. Configure App ID and App Secret in Admin Console → Facebook Accounts.',
		};
	}
	if (!credentials.redirectUri) {
		return {
			ok: false,
			status: 500,
			errorCode: 'FACEBOOK_REDIRECT_MISSING',
			message: 'Facebook redirect URI is not configured.',
		};
	}
	if (!credentials.enabled && credentials.source === 'pocketbase') {
		return {
			ok: false,
			status: 503,
			errorCode: 'FACEBOOK_OAUTH_DISABLED',
			message: 'Facebook OAuth is disabled in Admin Console.',
		};
	}
	return { ok: true };
}

export { PLACEHOLDER_APP_ID };
