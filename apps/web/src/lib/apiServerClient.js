export const API_SERVER_URL = '/hcgi/api';

function getPocketbaseToken() {
    const pocketbaseToken = localStorage.getItem('pocketbase_auth');

    if (pocketbaseToken) {
        const bytes = new TextEncoder().encode(pocketbaseToken);
        const binary = String.fromCharCode(...bytes);

        return btoa(binary);
    }
}

const apiServerClient = {
    fetch: async (url, options = {}) => {
        const pocketbaseToken = getPocketbaseToken();

        return await window.fetch(API_SERVER_URL + url, {
            ...options,
            headers: {
                ...options.headers,
                ...(pocketbaseToken && { Authorization: `Bearer ${pocketbaseToken}` }),
            },
        });
    }
};

export default apiServerClient;

export { apiServerClient };
