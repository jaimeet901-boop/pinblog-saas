import Pocketbase from 'pocketbase';

const POCKETBASE_API_URL = '/hcgi/platform';

const pocketbaseClient = new Pocketbase(POCKETBASE_API_URL);

export function getPocketbaseAuthHeader() {
	const token = pocketbaseClient.authStore.token;
	const record = pocketbaseClient.authStore.record;

	if (!token || !record) {
		return '';
	}

	return `Bearer ${btoa(JSON.stringify({ token, record }))}`;
}

export default pocketbaseClient;

export { pocketbaseClient };
