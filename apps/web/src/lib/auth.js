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
	return {
		name: String(user?.name || '').trim(),
		plan: 'free',
		role: 'member',
	};
}

export function getEnabledProviderNames(authMethods) {
	return new Set((authMethods?.oauth2?.providers || []).map((provider) => provider.name));
}

export function openOAuthWindow(url) {
	const popup = window.open(url, 'pb-oauth', 'popup=yes,width=560,height=720');
	if (!popup) {
		throw new Error('Please allow popups to continue with this provider.');
	}
	popup.focus();
	return popup;
}