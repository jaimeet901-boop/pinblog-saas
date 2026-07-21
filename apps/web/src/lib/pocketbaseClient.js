import Pocketbase from 'pocketbase';

const POCKETBASE_API_URL = '/hcgi/platform';

const pocketbaseClient = new Pocketbase(POCKETBASE_API_URL);

/**
 * UTF-8 safe base64 encoding.
 * Plain btoa(JSON.stringify(...)) throws or corrupts when user records contain non-Latin1 characters,
 * which drops the Authorization header and breaks every /websites API call.
 */
export function encodeBase64Utf8(value) {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

export function getPocketbaseAuthHeader() {
	const token = pocketbaseClient.authStore.token;
	const record = pocketbaseClient.authStore.record;

	if (!token || !record) {
		return '';
	}

	try {
		return `Bearer ${encodeBase64Utf8(JSON.stringify({ token, record }))}`;
	} catch {
		return '';
	}
}

export default pocketbaseClient;

export { pocketbaseClient };
