/**
 * Validate login IdP client credentials without mutating stored secrets.
 * Google: token endpoint distinguishes invalid_client vs other errors.
 */

import { getAuthProviderCatalogEntry } from './catalog.js';

function httpError(status, message, errorCode = 'AUTH_PROVIDER_TEST') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/**
 * @returns {Promise<{ ok: boolean, code: string, message: string, httpStatus?: number }>}
 */
export async function testProviderCredentials({
	providerId,
	clientId,
	clientSecret,
	redirectUri,
	tokenURL,
} = {}) {
	const entry = getAuthProviderCatalogEntry(providerId);
	if (!entry) {
		throw httpError(404, `Unknown authentication provider: ${providerId}`, 'AUTH_PROVIDER_UNKNOWN');
	}
	if (!entry.configurable) {
		throw httpError(501, `${entry.displayName} test is not available yet.`, 'AUTH_PROVIDER_NOT_CONFIGURABLE');
	}

	const id = String(clientId || '').trim();
	const secret = String(clientSecret || '').trim();
	const redirect = String(redirectUri || '').trim();
	const endpoint = String(tokenURL || entry.tokenURL || '').trim();

	if (!id || !secret) {
		return {
			ok: false,
			code: 'MISSING_CREDENTIALS',
			message: 'Client ID and Client Secret are required to test the connection.',
		};
	}
	if (!endpoint) {
		return {
			ok: false,
			code: 'MISSING_TOKEN_URL',
			message: 'Provider token URL is not configured in the catalog.',
		};
	}

	if (entry.id === 'google') {
		return testGoogleClientCredentials({ clientId: id, clientSecret: secret, redirectUri: redirect, tokenURL: endpoint });
	}

	return {
		ok: false,
		code: 'TEST_UNSUPPORTED',
		message: `Test Connection is not implemented for ${entry.displayName} yet.`,
	};
}

async function testGoogleClientCredentials({ clientId, clientSecret, redirectUri, tokenURL }) {
	const body = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		// Intentionally invalid code — we only care whether Google accepts the client.
		code: 'chef_ia_auth_provider_connection_test',
		grant_type: 'authorization_code',
		redirect_uri: redirectUri || 'https://example.com/oauth2-redirect',
	});

	let response;
	let payload = {};
	try {
		response = await fetch(tokenURL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body,
		});
		payload = await response.json().catch(() => ({}));
	} catch (error) {
		return {
			ok: false,
			code: 'NETWORK_ERROR',
			message: `Could not reach Google token endpoint: ${error?.message || error}`,
		};
	}

	const errorCode = String(payload.error || '').trim();
	const errorDescription = String(payload.error_description || payload.message || '').trim();

	// Client authenticated; grant failed as expected for a fake code.
	if (
		errorCode === 'invalid_grant'
		|| errorCode === 'redirect_uri_mismatch'
		|| errorCode === 'invalid_request'
	) {
		return {
			ok: true,
			code: 'CREDENTIALS_VALID',
			message: errorCode === 'redirect_uri_mismatch'
				? 'Client ID and Secret are valid, but the Redirect URI does not match Google Cloud Console. Update Authorized redirect URIs to match the URI shown in Admin.'
				: 'Client ID and Secret were accepted by Google.',
			httpStatus: response.status,
			warning: errorCode === 'redirect_uri_mismatch' ? 'redirect_uri_mismatch' : null,
		};
	}

	if (errorCode === 'invalid_client') {
		return {
			ok: false,
			code: 'INVALID_CLIENT',
			message: errorDescription || 'Google rejected the Client ID or Client Secret (invalid_client).',
			httpStatus: response.status,
		};
	}

	if (response.ok && payload.access_token) {
		return {
			ok: true,
			code: 'CREDENTIALS_VALID',
			message: 'Client credentials were accepted by Google.',
			httpStatus: response.status,
		};
	}

	return {
		ok: false,
		code: errorCode || 'UNKNOWN_ERROR',
		message: errorDescription || `Unexpected Google token response (HTTP ${response.status}).`,
		httpStatus: response.status,
	};
}
