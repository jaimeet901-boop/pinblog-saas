const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const OAUTH_PROVIDERS = {
	google: {
		name: 'google',
		label: 'Google',
		description: 'Continue with your Google account',
		accent: 'from-[#4285F4] to-[#2563eb]',
		badge: 'G',
	},
	pinterest: {
		name: 'pinterest',
		label: 'Pinterest',
		description: 'Continue with your Pinterest account',
		accent: 'from-[#E60023] to-[#B0001B]',
		badge: 'P',
	},
};

/**
 * Login / Signup pages ONLY.
 * Toggle `pinterest` to show/hide the auth-page button.
 * Never used by Pinterest Hub, reconnect, or Settings account linking.
 */
export const AUTH_PAGE_OAUTH_ENABLED = {
	google: true,
	pinterest: false,
};

/**
 * In-app PocketBase login-provider linking (Settings, authenticated users).
 * Independent from AUTH_PAGE_OAUTH_ENABLED.
 * Publishing OAuth (Pinterest Hub Connect/Reconnect) uses /pinterest/oauth/* and is unrelated.
 */
export const IN_APP_LOGIN_OAUTH_ENABLED = {
	google: true,
	pinterest: true,
};

function filterProvidersByFlags(flags) {
	return Object.values(OAUTH_PROVIDERS).filter(
		(provider) => flags[provider.name] !== false,
	);
}

/** Providers rendered on Login / Signup. */
export function getAuthPageOAuthProviders() {
	return filterProvidersByFlags(AUTH_PAGE_OAUTH_ENABLED);
}

/** Providers available for linking after the user is authenticated (Settings). */
export function getInAppLoginOAuthProviders() {
	return filterProvidersByFlags(IN_APP_LOGIN_OAUTH_ENABLED);
}

export function normalizeEmail(value) {
	return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value) {
	return EMAIL_PATTERN.test(normalizeEmail(value));
}

export function getPasswordIssues(password) {
	const issues = [];
	const value = String(password || '');

	if (value.length < 10) {
		issues.push('Use at least 10 characters.');
	}
	if (!/[a-z]/.test(value)) {
		issues.push('Add at least one lowercase letter.');
	}
	if (!/[A-Z]/.test(value)) {
		issues.push('Add at least one uppercase letter.');
	}
	if (!/[0-9]/.test(value)) {
		issues.push('Add at least one number.');
	}
	if (!/[^A-Za-z0-9]/.test(value)) {
		issues.push('Add at least one symbol.');
	}

	return issues;
}

export function validateSignupForm({ name, email, password, confirmPassword }) {
	const errors = [];

	if (!String(name || '').trim()) {
		errors.push('Full name is required.');
	}
	if (!isValidEmail(email)) {
		errors.push('Enter a valid email address.');
	}

	const passwordIssues = getPasswordIssues(password);
	if (passwordIssues.length > 0) {
		errors.push(...passwordIssues);
	}
	if (String(password || '') !== String(confirmPassword || '')) {
		errors.push('Passwords do not match.');
	}

	return errors;
}

export function normalizePocketBaseError(error, fallback = 'Something went wrong. Please try again.') {
	const responseData = error?.response?.data || error?.data || {};
	const nestedMessage = responseData?.message || responseData?.error?.message;
	const fieldErrors = responseData?.data || {};
	const fieldMessages = Object.values(fieldErrors)
		.flatMap((entry) => {
			if (!entry) {
				return [];
			}
			if (Array.isArray(entry)) {
				return entry.map((item) => (typeof item === 'string' ? item : item?.message)).filter(Boolean);
			}
			if (typeof entry === 'object' && entry.message) {
				return [entry.message];
			}
			return [String(entry)];
		})
		.filter(Boolean);

	const rawMessage = nestedMessage || fieldMessages[0] || error?.message || fallback;
	const normalized = String(rawMessage).toLowerCase();

	if (normalized.includes('already in use') || normalized.includes('validation_not_unique') || normalized.includes('duplicate')) {
		return 'An account with this email already exists. Try signing in instead.';
	}

	if (normalized.includes('invalid password') || normalized.includes('weak password')) {
		return 'Your password is too weak. Use a stronger password with letters, numbers, and symbols.';
	}

	if (normalized.includes('invalid email')) {
		return 'Enter a valid email address.';
	}

	return rawMessage;
}

export function buildOAuthCreateData(user) {
	// Omit empty name so PocketBase can map the Google profile name.
	// Empty name in createData blocks MappedFields.name population.
	const data = {
		plan: 'free',
		role: 'member',
	};
	const name = String(user?.name || '').trim();
	if (name) {
		data.name = name;
	}
	return data;
}

export function getEnabledProviderNames(authMethods) {
	return new Set((authMethods?.oauth2?.providers || []).map((provider) => provider.name));
}

export function isPocketBaseOAuth2Enabled(authMethods) {
	return authMethods?.oauth2?.enabled === true;
}

export function pocketBaseOAuth2ProviderNames(authMethods) {
	const providers = authMethods?.oauth2?.providers;
	if (!Array.isArray(providers)) return [];
	return providers
		.map((provider) => String(provider?.name || '').trim().toLowerCase())
		.filter(Boolean);
}

export function isAuthPageOAuthProviderLive(providerName, authMethods) {
	if (!isPocketBaseOAuth2Enabled(authMethods)) return false;
	const name = String(providerName || '').trim().toLowerCase();
	if (!name) return false;
	return pocketBaseOAuth2ProviderNames(authMethods).includes(name);
}

/** Login / Signup buttons that are both product-flagged and live in PocketBase. */
export function getLiveAuthPageOAuthProviders(authMethods) {
	return getAuthPageOAuthProviders().filter((provider) => (
		isAuthPageOAuthProviderLive(provider.name, authMethods)
	));
}

export function openOAuthWindow(url) {
	const popup = window.open(url, 'pb-oauth', 'popup=yes,width=560,height=720');
	if (!popup) {
		throw new Error('Please allow popups to continue with this provider.');
	}
	popup.focus();
	return popup;
}