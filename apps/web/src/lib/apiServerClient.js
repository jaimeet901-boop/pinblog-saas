export const API_SERVER_URL = '/hcgi/api';
import { getPocketbaseAuthHeader } from './pocketbaseClient.js';

const STORAGE_KEY = 'chefia-active-workspace-id';
let memoryWorkspaceId = '';

try {
	memoryWorkspaceId = localStorage.getItem(STORAGE_KEY) || '';
} catch {
	memoryWorkspaceId = '';
}

export function setActiveWorkspaceId(id) {
	memoryWorkspaceId = String(id || '');
	try {
		if (memoryWorkspaceId) localStorage.setItem(STORAGE_KEY, memoryWorkspaceId);
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* ignore */
	}
}

export function getActiveWorkspaceId() {
	if (memoryWorkspaceId) return memoryWorkspaceId;
	try {
		memoryWorkspaceId = localStorage.getItem(STORAGE_KEY) || '';
	} catch {
		memoryWorkspaceId = '';
	}
	return memoryWorkspaceId;
}

const apiServerClient = {
	fetch: async (url, options = {}) => {
		const authorization = getPocketbaseAuthHeader();
		const workspaceId = getActiveWorkspaceId();

		return await window.fetch(API_SERVER_URL + url, {
			...options,
			headers: {
				...options.headers,
				...(authorization && { Authorization: authorization }),
				...(workspaceId && { 'X-Workspace-Id': workspaceId }),
			},
		});
	},
};

export default apiServerClient;

export { apiServerClient };
