import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackgroundImagePrompt } from './ai-pin-background-prompt.js';

describe('buildBackgroundImagePrompt', () => {
	it('uses background-only instructions without pin copy fields', () => {
		const prompt = buildBackgroundImagePrompt({
			category: 'dessert',
			keywords: ['chocolate', 'cake'],
			imagePrompt: 'Warm studio light on molten chocolate cake',
			recipeContext: 'Rich gooey center, indulgent mood',
		});

		assert.match(prompt, /Photorealistic food or lifestyle background photo/i);
		assert.match(prompt, /no text, no typography, no title, no CTA/i);
		assert.match(prompt, /Recipe category: dessert/);
		assert.match(prompt, /Subject keywords: chocolate, cake/);
		assert.match(prompt, /Recipe context: Rich gooey center/);
		assert.match(prompt, /Creative direction: Warm studio light/);
		assert.doesNotMatch(prompt, /Article title:/i);
		assert.doesNotMatch(prompt, /Overlay text/i);
		assert.doesNotMatch(prompt, /Pinterest marketing/i);
		assert.doesNotMatch(prompt, /typography and strong visual hierarchy/i);
	});
});
