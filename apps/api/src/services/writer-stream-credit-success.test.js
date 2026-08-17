/**
 * AI-WRITER-02 — Writer stream credit settlement from output contract.
 * Run: node --test src/services/writer-stream-credit-success.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PIN_COPY_CREDIT_FEATURE,
	WRITER_CREDIT_FEATURE,
} from './integrated-ai-stream-credits.js';
import {
	createOnceCreditSettle,
	evaluateIntegratedAiStreamCreditSuccess,
	extractWriterJson,
	isStreamAbortError,
	isValidWriterArticleJson,
	isValidWriterSectionJson,
	joinSseContentEvents,
} from './writer-stream-credit-success.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const streamSource = readFileSync(path.join(here, '../api/integrated-ai.js'), 'utf8');
const routeSource = readFileSync(path.join(here, '../routes/integrated-ai.js'), 'utf8');
const helperSource = readFileSync(path.join(here, 'integrated-ai-stream-credits.js'), 'utf8');
const engineSource = readFileSync(path.join(here, 'credits-engine.js'), 'utf8');

const VALID_ARTICLE = {
	seo_title: 'Easy Vegan Lasagna',
	meta_description: 'A weeknight lasagna with cashew béchamel.',
	slug: 'easy-vegan-lasagna',
	introduction: '<p>Make this tonight.</p>',
	sections: [{ heading: 'Ingredients', level: 'h2', content: '<p>Noodles and sauce.</p>' }],
	faq: [{ question: 'Can I freeze it?', answer: 'Yes.' }],
	conclusion: '<p>Enjoy.</p>',
	recipe_schema: null,
};

function articleText(overrides = {}) {
	return JSON.stringify({ ...VALID_ARTICLE, ...overrides });
}

describe('extractWriterJson', () => {
	it('parses a Writer JSON object', () => {
		const json = extractWriterJson(articleText());
		assert.equal(json.seo_title, 'Easy Vegan Lasagna');
		assert.equal(json.sections.length, 1);
	});

	it('strips markdown fences', () => {
		const json = extractWriterJson(`\`\`\`json\n${articleText()}\n\`\`\``);
		assert.equal(json.slug, 'easy-vegan-lasagna');
	});

	it('rejects empty, prose, and truncated JSON', () => {
		assert.equal(extractWriterJson(''), null);
		assert.equal(extractWriterJson('Sorry, I cannot help with that.'), null);
		assert.equal(extractWriterJson('{ "seo_title": "Open'), null);
		assert.equal(extractWriterJson('[]'), null);
	});
});

describe('Writer article / section JSON contract', () => {
	it('accepts the existing article contract', () => {
		assert.equal(isValidWriterArticleJson(VALID_ARTICLE), true);
	});

	it('accepts an article that omits recipe_schema (existing client success)', () => {
		const { recipe_schema: _omit, ...rest } = VALID_ARTICLE;
		assert.equal(isValidWriterArticleJson(rest), true);
	});

	it('rejects objects that are not Writer articles', () => {
		assert.equal(isValidWriterArticleJson({ foo: 1 }), false);
		assert.equal(isValidWriterArticleJson({ content: '<p>section only</p>' }), false);
		assert.equal(isValidWriterArticleJson(null), false);
	});

	it('accepts section-AI JSON shapes', () => {
		assert.equal(isValidWriterSectionJson({ content: '<p>Rewritten intro</p>' }), true);
		assert.equal(isValidWriterSectionJson({ heading: 'Tips', content: '<p>More.</p>' }), true);
		assert.equal(isValidWriterSectionJson({ faq: [{ question: 'Q', answer: 'A' }] }), true);
		assert.equal(isValidWriterSectionJson({ content: '   ' }), false);
		assert.equal(isValidWriterSectionJson({ faq: [] }), false);
	});
});

describe('evaluateIntegratedAiStreamCreditSuccess', () => {
	it('valid Writer JSON → commit', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: true,
			contentEventCount: 3,
			accumulatedText: articleText(),
		}), true);
	});

	it('empty output → release', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: true,
			contentEventCount: 0,
			accumulatedText: '',
		}), false);
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: true,
			contentEventCount: 4,
			accumulatedText: '   ',
		}), false);
	});

	it('malformed JSON → release even when tokens arrived', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: true,
			contentEventCount: 8,
			accumulatedText: '{ "seo_title": "cut off',
		}), false);
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: true,
			contentEventCount: 2,
			accumulatedText: 'Here is your article in markdown...',
		}), false);
	});

	it('provider failure → release', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			providerFailed: true,
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: true,
			contentEventCount: 5,
			accumulatedText: articleText(),
		}), false);
	});

	it('cancellation before usable output → release', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: true,
			contentEventCount: 2,
			accumulatedText: '{ "seo_title": "partial',
		}), false);
	});

	it('cancellation after valid Writer JSON in the buffer → commit', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: true,
			contentEventCount: 6,
			accumulatedText: articleText(),
		}), true);
	});

	it('section AI parseable JSON still commits (pricing unchanged)', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: false,
			contentEventCount: 1,
			accumulatedText: JSON.stringify({ content: '<p>Expanded section.</p>' }),
		}), true);
	});

	it('section AI empty/malformed → release', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: WRITER_CREDIT_FEATURE,
			requireWriterArticleJson: false,
			contentEventCount: 3,
			accumulatedText: 'not json',
		}), false);
	});

	it('pin copy still commits on non-empty text (not Writer JSON)', () => {
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: PIN_COPY_CREDIT_FEATURE,
			contentEventCount: 1,
			accumulatedText: 'Pin title one\nPin title two',
		}), true);
		assert.equal(evaluateIntegratedAiStreamCreditSuccess({
			creditFeature: PIN_COPY_CREDIT_FEATURE,
			contentEventCount: 1,
			accumulatedText: '   ',
		}), false);
	});
});

describe('createOnceCreditSettle', () => {
	it('no double settlement — second call is skipped', async () => {
		const calls = [];
		const settle = createOnceCreditSettle(async (payload) => {
			calls.push(payload);
			return { settled: payload.success ? 'committed' : 'released' };
		});
		const first = await settle({ success: true });
		const second = await settle({ success: false });
		assert.equal(first.skipped, false);
		assert.equal(second.skipped, true);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].success, true);
	});

	it('cancellation after successful settlement does not release', async () => {
		const calls = [];
		const settle = createOnceCreditSettle(async (payload) => {
			calls.push(payload.success);
			return payload.success ? 'committed' : 'released';
		});
		await settle({ success: true });
		await settle({ success: false });
		await settle({ success: false });
		assert.deepEqual(calls, [true]);
	});
});

describe('helpers', () => {
	it('joins SSE content events in order', () => {
		assert.equal(joinSseContentEvents([
			{ data: { content: '{"seo' } },
			{ data: { content: '_title":"A"}' } },
		]), '{"seo_title":"A"}');
	});

	it('detects stream abort / destroy errors', () => {
		assert.equal(isStreamAbortError({ code: 'ERR_STREAM_DESTROYED' }), true);
		assert.equal(isStreamAbortError({ name: 'AbortError' }), true);
		assert.equal(isStreamAbortError({ message: 'gemini 500' }), false);
	});
});

describe('AI-WRITER-02 wiring', () => {
	it('stream settlement uses the Writer JSON evaluator, not token count alone', () => {
		assert.match(streamSource, /evaluateIntegratedAiStreamCreditSuccess/);
		assert.match(streamSource, /createOnceCreditSettle/);
		assert.doesNotMatch(
			streamSource,
			/settledSuccess = contentEvents\.length > 0/,
		);
	});

	it('continuation remains free and does not attach a first-shot settlement callback', () => {
		const handler = routeSource.slice(routeSource.indexOf("router.post('/stream'"));
		assert.match(handler, /if \(intent\.mode === 'billable'\)/);
		assert.match(handler, /onGenerationSettled: creditReservation\?\.id \? settleCreditsOnce : null/);
		assert.match(helperSource, /mode: 'writer_continuation'/);
		assert.match(engineSource, /ai_writer:\s*2/);
	});
});
