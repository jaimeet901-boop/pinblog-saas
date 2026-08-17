/**
 * AI-PINS-02 Generate estimate and wallet guard.
 * Run: node --test src/lib/__tests__/aiPinsGenerateCredits.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AI_IMAGE_CREDIT_COST,
	AI_PIN_COPY_CREDIT_COST,
	canGenerateWithCredits,
	estimatePinCredits,
	INSUFFICIENT_CREDITS_TOAST,
	isInsufficientCreditsError,
} from '../aiPinsGenerateCredits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readSrc(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

describe('AI-PINS-02 Generate credit estimate', () => {
	it('A. Featured estimate: 1 article + 1 featured pin = 1', () => {
		assert.equal(estimatePinCredits({
			imageMode: 'use_featured',
			articleCount: 1,
			pinCount: 1,
		}), 1);
	});

	it('B. AI estimate: 1 article + 1 AI pin = 2', () => {
		assert.equal(estimatePinCredits({
			imageMode: 'generate_ai',
			articleCount: 1,
			pinCount: 1,
		}), 2);
	});

	it('C. 3 AI pins: 1 article + 3 AI pins = 4', () => {
		assert.equal(estimatePinCredits({
			imageMode: 'generate_ai',
			articleCount: 1,
			pinCount: 3,
		}), 4);
	});

	it('D. Bulk: 2 articles + 3 AI pins each = 8', () => {
		assert.equal(estimatePinCredits({
			imageMode: 'generate_ai',
			articleCount: 2,
			pinCount: 3,
		}), 8);
	});

	it('E. Bulk Featured: 2 articles + 3 featured pins each = 2', () => {
		assert.equal(estimatePinCredits({
			imageMode: 'use_featured',
			articleCount: 2,
			pinCount: 3,
		}), 2);
	});

	it('does not use creditHint or estimateCreditsPerAiPin', () => {
		assert.equal(estimatePinCredits({
			imageMode: 'generate_ai',
			quality: { creditHint: 0.7, imageMode: 'generate_ai' },
			articleCount: 1,
			pinCount: 1,
		}), 2);
		assert.equal(estimatePinCredits({
			imageMode: 'use_featured',
			quality: { creditHint: 0, imageMode: 'use_featured' },
			articleCount: 1,
			pinCount: 3,
		}), 1);
		assert.equal(AI_PIN_COPY_CREDIT_COST, 1);
		assert.equal(AI_IMAGE_CREDIT_COST, 1);
	});
});

describe('AI-PINS-02 Generate wallet guard', () => {
	it('F. Generate disabled: remaining 0 < required', () => {
		assert.equal(canGenerateWithCredits(0, 1), false);
		assert.equal(canGenerateWithCredits(0, 2), false);
	});

	it('G. Generate disabled: remaining below required', () => {
		assert.equal(canGenerateWithCredits(1, 2), false);
		assert.equal(canGenerateWithCredits(3, 4), false);
	});

	it('H. Generate enabled: remaining exactly required', () => {
		assert.equal(canGenerateWithCredits(1, 1), true);
		assert.equal(canGenerateWithCredits(4, 4), true);
	});

	it('I. Generate enabled: remaining above required', () => {
		assert.equal(canGenerateWithCredits(5, 2), true);
		assert.equal(canGenerateWithCredits(8, 4), true);
	});
});

describe('AI-PINS-02 insufficient credits message', () => {
	it('J. 402 / INSUFFICIENT_CREDITS gets a credit-specific user message', () => {
		assert.equal(isInsufficientCreditsError({ status: 402, errorCode: 'INSUFFICIENT_CREDITS' }), true);
		assert.equal(isInsufficientCreditsError({ status: 402 }), true);
		assert.equal(isInsufficientCreditsError({ errorCode: 'INSUFFICIENT_CREDITS' }), true);
		assert.equal(isInsufficientCreditsError({ message: 'Insufficient credits [INSUFFICIENT_CREDITS]' }), true);
		assert.equal(isInsufficientCreditsError({ status: 503, message: 'AI generation is unavailable' }), false);
		assert.match(INSUFFICIENT_CREDITS_TOAST.title, /Insufficient credits/i);
		assert.match(INSUFFICIENT_CREDITS_TOAST.description, /credit/i);
		assert.doesNotMatch(INSUFFICIENT_CREDITS_TOAST.description, /unavailable right now/i);
	});
});

describe('AI-PINS-02 studio wiring', () => {
	it('Generate estimate uses imageMode and articleCount, not creditHint', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		const helper = readSrc('lib/aiPinsGenerateCredits.js');
		assert.match(studio, /estimatePinCredits\(\{/);
		assert.match(studio, /imageMode: quality\?\.imageMode/);
		assert.match(studio, /articleCount/);
		assert.doesNotMatch(studio, /quality\?\.creditHint/);
		assert.doesNotMatch(studio, /estimateCreditsPerAiPin/);
		assert.doesNotMatch(helper, /quality\?\.creditHint/);
		assert.doesNotMatch(helper, /config\?\.images\?\.estimateCreditsPerAiPin/);
	});

	it('Generate is disabled when remaining is below required credits', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		assert.match(studio, /generateBlockedByCredits = !canGenerateWithCredits\(credits\?\.remaining, estimatedCredits\)/);
		assert.match(studio, /disabled=\{generating \|\| loadingArticles \|\| generateBlockedByCredits\}/);
		assert.match(studio, /This will use ~\{estimatedCredits\} credits/);
	});

	it('J. handleGenerate surfaces 402 instead of the generic unavailable toast', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		assert.match(studio, /isInsufficientCreditsError\(error\)/);
		assert.match(studio, /INSUFFICIENT_CREDITS_TOAST/);
		assert.match(studio, /AI generation is unavailable right now/);
		const catchBlock = studio.slice(
			studio.indexOf('void startPreviewImageGeneration('),
			studio.indexOf('const regeneratePreviewImage'),
		);
		assert.match(catchBlock, /isInsufficientCreditsError\(error\)/);
		assert.match(catchBlock, /INSUFFICIENT_CREDITS_TOAST/);
	});
});
