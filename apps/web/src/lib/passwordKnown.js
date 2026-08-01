const PASSWORD_KNOWN_KEY = (userId) => `chefia-password-known:${userId}`;

export function markPasswordKnown(userId) {
	if (!userId) return;
	try {
		localStorage.setItem(PASSWORD_KNOWN_KEY(userId), '1');
	} catch {
		/* ignore */
	}
}

export function isPasswordKnownLocally(userId) {
	if (!userId) return false;
	try {
		return localStorage.getItem(PASSWORD_KNOWN_KEY(userId)) === '1';
	} catch {
		return false;
	}
}
