import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	WRITER_LENGTH_PRESETS,
	autoHeadingCount,
	buildLengthEnforcementPrompt,
	countArticleWords,
	normalizeWriterLengthParams,
	resolveWriterLengthPreset,
} from './writer-article-length.js';

describe('writer-article-length', () => {
	it('normalizes structured articleLength/minWords/maxWords', () => {
		const long = normalizeWriterLengthParams({
			articleLength: 'long',
			minWords: '1800',
			maxWords: '2500',
		});
		assert.equal(long.id, 'long');
		assert.equal(long.minWords, 1800);
		assert.equal(long.maxWords, 2500);
		assert.equal(long.maxTokens, 9000);
		assert.equal(long.timeoutMs, 300000);
	});

	it('builds mandatory length enforcement text', () => {
		const text = buildLengthEnforcementPrompt(WRITER_LENGTH_PRESETS.long);
		assert.match(text, /NEVER stop before reaching at least 1800 words/i);
		assert.match(text, /9-12 H2\/H3/i);
		assert.match(text, /FAQ and conclusion count/i);
	});

	it('auto heading midpoint matches UI scaling', () => {
		assert.equal(autoHeadingCount(resolveWriterLengthPreset('short')), '5');
		assert.equal(autoHeadingCount(resolveWriterLengthPreset('medium')), '7');
		assert.equal(autoHeadingCount(resolveWriterLengthPreset('long')), '11');
		assert.equal(autoHeadingCount(resolveWriterLengthPreset('xl')), '14');
	});

	it('counts article words across fields', () => {
		const words = countArticleWords({
			introduction: '<p>one two three</p>',
			sections: [{ heading: 'Tips', content: '<p>four five six seven</p>' }],
			faq: [{ question: 'eight nine?', answer: 'ten eleven twelve' }],
			conclusion: '<p>thirteen fourteen</p>',
		});
		assert.equal(words, 15);
	});
});
