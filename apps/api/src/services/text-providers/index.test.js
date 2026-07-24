import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listImplementedTextAdapters } from './adapters.js';

describe('text-providers adapters', () => {
	it('exposes gemini as the first implemented adapter', () => {
		const adapters = listImplementedTextAdapters();
		assert.ok(adapters.includes('gemini'));
	});
});
