import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { testProviderCredentials } from './test-connection.js';

describe('authentication provider test connection', () => {
	it('rejects missing credentials without calling Google', async () => {
		const result = await testProviderCredentials({
			providerId: 'google',
			clientId: '',
			clientSecret: '',
		});
		assert.equal(result.ok, false);
		assert.equal(result.code, 'MISSING_CREDENTIALS');
	});

	it('rejects reserved providers', async () => {
		await assert.rejects(
			() => testProviderCredentials({ providerId: 'apple', clientId: 'x', clientSecret: 'y' }),
			(error) => error?.errorCode === 'AUTH_PROVIDER_NOT_CONFIGURABLE',
		);
	});

	it('treats invalid_grant as valid client credentials', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => ({
			ok: false,
			status: 400,
			json: async () => ({ error: 'invalid_grant', error_description: 'Bad Request' }),
		});
		try {
			const result = await testProviderCredentials({
				providerId: 'google',
				clientId: 'client',
				clientSecret: 'secret',
				redirectUri: 'https://tbuy.store/hcgi/platform/api/oauth2-redirect',
			});
			assert.equal(result.ok, true);
			assert.equal(result.code, 'CREDENTIALS_VALID');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('treats invalid_client as failure', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => ({
			ok: false,
			status: 401,
			json: async () => ({ error: 'invalid_client', error_description: 'Unauthorized' }),
		});
		try {
			const result = await testProviderCredentials({
				providerId: 'google',
				clientId: 'bad',
				clientSecret: 'bad',
			});
			assert.equal(result.ok, false);
			assert.equal(result.code, 'INVALID_CLIENT');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('warns on redirect_uri_mismatch while still validating client', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => ({
			ok: false,
			status: 400,
			json: async () => ({ error: 'redirect_uri_mismatch' }),
		});
		try {
			const result = await testProviderCredentials({
				providerId: 'google',
				clientId: 'client',
				clientSecret: 'secret',
				redirectUri: 'https://wrong.example/callback',
			});
			assert.equal(result.ok, true);
			assert.equal(result.warning, 'redirect_uri_mismatch');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
