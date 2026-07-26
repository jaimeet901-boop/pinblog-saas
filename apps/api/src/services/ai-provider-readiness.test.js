import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	isImageOrientedProvider,
	isProviderConfigured,
	isTextOrientedProvider,
	matchPreferredProvider,
	normalizeImageProviderAlias,
	providerHasCredentials,
} from './ai-provider-readiness.js';

describe('ai-provider-readiness helpers', () => {
	it('classifies text vs image oriented providers', () => {
		assert.equal(isTextOrientedProvider('gemini'), true);
		assert.equal(isTextOrientedProvider('openai'), true);
		assert.equal(isImageOrientedProvider('fal'), true);
		assert.equal(isImageOrientedProvider('flux'), true);
		assert.equal(isTextOrientedProvider('fal'), false);
		// Gemini stays text-oriented so dual text+image use does not drop copy generation.
		assert.equal(isImageOrientedProvider('gemini'), false);
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
		assert.equal(normalizeImageProviderAlias('Fal.ai'), 'fal');
		assert.equal(normalizeImageProviderAlias('Google Gemini'), 'gemini');
		// Must never cross-map gemini → fal via loose includes()
		assert.equal(matchPreferredProvider(providers, 'gemini')?.code, 'gemini');
		assert.notEqual(matchPreferredProvider(providers, 'gemini')?.code, 'fal');
	});
});
