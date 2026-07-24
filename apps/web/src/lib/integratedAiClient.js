const API_SERVER_URL = '/hcgi/api';
import { getPocketbaseAuthHeader } from './pocketbaseClient.js';

function buildHttpError(response, errorBody) {
	let message;
	let errorCode = '';
	try {
		const parsed = JSON.parse(errorBody);
		message = parsed?.message
			|| parsed?.error?.message
			|| (typeof parsed?.error === 'string' ? parsed.error : '')
			|| '';
		errorCode = parsed?.errorCode || '';
	} catch {
		message = errorBody;
	}

	const detail = String(message || '').trim() || `Request failed (${response.status})`;
	const error = new Error(errorCode ? `${detail} [${errorCode}]` : detail);
	error.status = response.status;
	error.errorCode = errorCode || undefined;
	error.body = errorBody;
	return error;
}

const integratedAiClient = {
	fetch: async (path, options = {}) => {
		const authorization = getPocketbaseAuthHeader();

		const response = await window.fetch(API_SERVER_URL + path, {
			...options,
			headers: {
				...options.headers,
				...(authorization && { Authorization: authorization }),
			},
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw buildHttpError(response, errorBody);
		}

		return response.json();
	},

	stream: async (path, { body, signal, images } = {}) => {
		const authorization = getPocketbaseAuthHeader();

		const headers = {
			Accept: 'text/event-stream',
			...(authorization && { Authorization: authorization }),
		};

		const formData = new FormData();
		formData.append('message', JSON.stringify(body.message));

		images.forEach((image) => {
			formData.append('images', image);
		});

		const response = await window.fetch(API_SERVER_URL + path, {
			method: 'POST',
			headers,
			body: formData,
			signal,
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw buildHttpError(response, errorBody);
		}

		if (!response.body) {
			throw new Error('No response body');
		}

		return response;
	},
};

export default integratedAiClient;

export { integratedAiClient };
