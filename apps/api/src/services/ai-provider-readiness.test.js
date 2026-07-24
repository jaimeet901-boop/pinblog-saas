import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	isImageOrientedProvider,
	isProviderConfigured,
	isTextOrientedProvider,
	matchPreferredProvider,
	providerHasCredentials,
} from './ai-provider-readiness.js';

describe('ai-provider-readiness helpers', () => {
	it('classifies text vs image oriented providers', () => {
		assert.equal(isTextOrientedProvider('gemini'), true);
		assert.equal(isTextOrientedProvider('openai'), true);
		assert.equal(isImageOrientedProvider('fal'), true);
		assert.equal(isImageOrientedProvider('flux'), true);
		assert.equal(isTextOrientedProvider('fal'), false);
	});

	it('requires enabled + credentials for configured providers', () => {
		assert.equal(isProviderConfigured({
			enabled: true,
			config: { hasApiKey: true },
		}), true);
		assert.equal(isProviderConfigured({
			enabled: false,
			config: { hasApiKey: true },
		}), false);
		assert.equal(isProviderConfigured({
			enabled: true,
			config: { hasApiKey: false },
		}), false);
		assert.equal(providerHasCredentials({ config: { hasSecretKey: true } }), true);
	});

	it('matches preferred provider by code or name from platform settings', () => {
		const providers = [
			{ code: 'gemini', name: 'Google Gemini', enabled: true, config: { hasApiKey: true } },
			{ code: 'fal', name: 'Fal.ai', enabled: true, config: { hasApiKey: true } },
		];
		assert.equal(matchPreferredProvider(providers, 'Google Gemini')?.code, 'gemini');
		assert.equal(matchPreferredProvider(providers, 'Fal.ai')?.code, 'fal');
		assert.equal(matchPreferredProvider(providers, 'fal')?.code, 'fal');
	});
});
