import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBillableAiResultSource } from './ai-billing-policy.js';

describe('isBillableAiResultSource', () => {
	it('rejects heuristic and template fallbacks', () => {
		assert.equal(isBillableAiResultSource('heuristic'), false);
		assert.equal(isBillableAiResultSource('template'), false);
		assert.equal(isBillableAiResultSource(''), false);
		assert.equal(isBillableAiResultSource(null), false);
	});

	it('accepts runtime provider sources', () => {
		assert.equal(isBillableAiResultSource('openai'), true);
		assert.equal(isBillableAiResultSource('gemini'), true);
		assert.equal(isBillableAiResultSource('text-runtime'), true);
	});
});
