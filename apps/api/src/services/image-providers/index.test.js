import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	listImageProviders,
	listImplementedImageAdapters,
	resolveImageAdapterCode,
} from './index.js';

describe('image-providers registry', () => {
	it('exposes fal and gemini adapters side by side', () => {
		const adapters = listImplementedImageAdapters();
		assert.ok(adapters.includes('fal'));
		assert.ok(adapters.includes('gemini'));
		assert.ok(adapters.includes('openai'));
	});

	it('lists gemini in public image providers', () => {
		const providers = listImageProviders();
		assert.ok(providers.some((item) => item.id === 'gemini'));
		assert.ok(providers.some((item) => item.id === 'fal'));
	});

	it('resolves google aliases to gemini', () => {
		assert.equal(resolveImageAdapterCode('Google Gemini'), 'gemini');
		assert.equal(resolveImageAdapterCode('flux'), 'flux');
		assert.equal(resolveImageAdapterCode('fal'), 'fal');
	});
});
