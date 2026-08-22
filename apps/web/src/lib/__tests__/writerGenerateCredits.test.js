/**
 * AI-WRITER-02 — Writer Generate wallet preflight.
 * Run: node --test src/lib/__tests__/writerGenerateCredits.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	canStartWriterGeneration,
	isWriterInsufficientCreditsError,
	readWriterCreditCost,
	readWriterCreditRemaining,
} from '../writerGenerateCredits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const writerPage = readFileSync(path.resolve(here, '../../pages/app/WriterPage.jsx'), 'utf8');

describe('readWriterCreditCost / remaining', () => {
	it('reads existing featureCosts.ai_writer and does not hardcode a price', () => {
		assert.equal(readWriterCreditCost({ featureCosts: { ai_writer: 2 } }), 2);
		assert.equal(readWriterCreditCost({ credits: { featureCosts: { ai_writer: 4 } } }), 4);
		assert.equal(readWriterCreditCost({}), null);
		assert.equal(readWriterCreditCost({ featureCosts: { ai_pin_copy: 1 } }), null);
	});

	it('reads remaining/balance from the existing credits DTO', () => {
		assert.equal(readWriterCreditRemaining({ remaining: 12, balance: 12 }), 12);
		assert.equal(readWriterCreditRemaining({ remaining: 0 }), 0);
		assert.equal(readWriterCreditRemaining({ balance: 3 }), 3);
		assert.equal(readWriterCreditRemaining({ credits: { remaining: 8 } }), 8);
		assert.equal(readWriterCreditRemaining({}), null);
	});
});

describe('canStartWriterGeneration', () => {
	it('wallet >= ai_writer cost → Generate allowed', () => {
		assert.equal(canStartWriterGeneration({ remaining: 2, cost: 2 }), true);
		assert.equal(canStartWriterGeneration({ remaining: 10, cost: 2 }), true);
	});

	it('wallet < ai_writer cost → Generate blocked', () => {
		assert.equal(canStartWriterGeneration({ remaining: 1, cost: 2 }), false);
	});

	it('wallet 0 → Generate blocked', () => {
		assert.equal(canStartWriterGeneration({ remaining: 0, cost: 2 }), false);
		assert.equal(canStartWriterGeneration({ remaining: 0, cost: null }), false);
	});

	it('unknown wallet still allows (API 402 fallback)', () => {
		assert.equal(canStartWriterGeneration({ remaining: null, cost: 2 }), true);
	});

	it('catalog cost 0 with empty wallet is allowed', () => {
		assert.equal(canStartWriterGeneration({ remaining: 0, cost: 0 }), true);
	});
});

describe('isWriterInsufficientCreditsError', () => {
	it('treats 402 / INSUFFICIENT_CREDITS as the safety fallback', () => {
		assert.equal(isWriterInsufficientCreditsError({ status: 402 }), true);
		assert.equal(isWriterInsufficientCreditsError({ errorCode: 'INSUFFICIENT_CREDITS' }), true);
		assert.equal(isWriterInsufficientCreditsError({ status: 500 }), false);
	});
});

describe('WriterPage wiring', () => {
	it('preflight blocks Generate before /integrated-ai/stream', () => {
		assert.match(writerPage, /canStartWriterGeneration/);
		assert.match(writerPage, /readWriterCreditCost/);
		assert.match(writerPage, /readWriterCreditRemaining/);
		assert.match(writerPage, /Insufficient credits/);
		const generateFn = writerPage.slice(writerPage.indexOf('const generate = async'));
		const guardIndex = generateFn.indexOf('canStartWriterGeneration');
		const streamIndex = generateFn.indexOf('generateText(');
		assert.ok(guardIndex >= 0 && streamIndex > guardIndex);
		assert.ok(generateFn.indexOf('setArticle(null)') > guardIndex);
	});

	it('does not hardcode ai_writer price in WriterPage', () => {
		assert.doesNotMatch(writerPage, /ai_writer[^\n]{0,40}:\s*2/);
		assert.doesNotMatch(writerPage, /writerCreditCost,\s*2/);
	});

	it('keeps 402 insufficient-credits handling', () => {
		assert.match(writerPage, /INSUFFICIENT_CREDITS/);
		assert.match(writerPage, /status === 402/);
		assert.match(writerPage, /isWriterInsufficientCreditsError/);
	});
});
