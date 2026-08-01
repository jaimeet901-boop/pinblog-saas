import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	AUTH_PROVIDER_STATUS,
	AUTH_PROVIDER_VERSION,
	deriveAuthProviderStatus,
	authStatusToPillTone,
} from './status.js';

describe('authentication provider status', () => {
	it('exports a stable provider version', () => {
		assert.equal(AUTH_PROVIDER_VERSION, '1.0.0');
	});

	it('marks incomplete providers as not configured', () => {
		const result = deriveAuthProviderStatus({
			configurable: true,
			configured: false,
			enabled: false,
		});
		assert.equal(result.status, AUTH_PROVIDER_STATUS.NOT_CONFIGURED);
	});

	it('marks failed tests as invalid credentials', () => {
		const result = deriveAuthProviderStatus({
			configurable: true,
			configured: true,
			enabled: true,
			hasDatabaseRow: true,
			lastTestOk: false,
		});
		assert.equal(result.status, AUTH_PROVIDER_STATUS.INVALID_CREDENTIALS);
		assert.equal(authStatusToPillTone(result.status), 'failed');
	});

	it('marks disabled configured providers', () => {
		const result = deriveAuthProviderStatus({
			configurable: true,
			configured: true,
			enabled: false,
			hasDatabaseRow: true,
		});
		assert.equal(result.status, AUTH_PROVIDER_STATUS.DISABLED);
	});

	it('uses environment fallback when only env is present', () => {
		const result = deriveAuthProviderStatus({
			configurable: true,
			configured: true,
			enabled: true,
			hasEnvCredentials: true,
			hasDatabaseRow: false,
		});
		assert.equal(result.status, AUTH_PROVIDER_STATUS.ENVIRONMENT_FALLBACK);
		assert.equal(result.sourceLabel, 'Environment Fallback');
	});

	it('uses connected + database configuration when Admin row is active', () => {
		const result = deriveAuthProviderStatus({
			configurable: true,
			configured: true,
			enabled: true,
			hasDatabaseRow: true,
			lastTestOk: true,
		});
		assert.equal(result.status, AUTH_PROVIDER_STATUS.CONNECTED);
		assert.equal(result.sourceLabel, 'Database Configuration');
	});
});
