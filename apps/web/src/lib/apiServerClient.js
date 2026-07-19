export const API_SERVER_URL = '/hcgi/api';
import { getPocketbaseAuthHeader } from './pocketbaseClient.js';

const apiServerClient = {
    fetch: async (url, options = {}) => {
		const authorization = getPocketbaseAuthHeader();

        return await window.fetch(API_SERVER_URL + url, {
            ...options,
            headers: {
                ...options.headers,
				    ...(authorization && { Authorization: authorization }),
            },
        });
    }
};

export default apiServerClient;

export { apiServerClient };
