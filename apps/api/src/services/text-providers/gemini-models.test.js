import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	GEMINI_STABLE_FALLBACK_MODEL,
	isRetiredGeminiModel,
	normalizeGeminiModelId,
} from './gemini-models.js';

describe('gemini-models policy', () => {
	it('normalizes models/ prefix', () => {
		assert.equal(normalizeGeminiModelId('models/gemini-3.5-flash'), 'gemini-3.5-flash');
	});

	it('marks retired Gemini ids unavailable', () => {
		assert.equal(isRetiredGeminiModel('gemini-2.5-flash'), true);
		assert.equal(isRetiredGeminiModel('models/gemini-2.5-pro'), true);
		assert.equal(isRetiredGeminiModel('gemini-3.5-flash'), false);
	});

	it('exposes a non-retired stable fallback', () => {
		assert.ok(GEMINI_STABLE_FALLBACK_MODEL);
		assert.equal(isRetiredGeminiModel(GEMINI_STABLE_FALLBACK_MODEL), false);
	});
});
