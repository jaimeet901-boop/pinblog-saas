/**
 * AI-PINS-04 Add manual article modal.
 * Run: node --test src/components/ai-pins/ManualArticleForm.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const formSource = readFileSync(join(here, 'ManualArticleForm.jsx'), 'utf8');
const studioSource = readFileSync(join(here, '../../pages/app/ContentStudioPage.jsx'), 'utf8');

const helperMatch = formSource.match(
	/export function isManualArticleBackdropDismiss\([^)]*\) \{[\s\S]*?\n\}/,
);
assert.ok(helperMatch, 'isManualArticleBackdropDismiss must be exported');
const isManualArticleBackdropDismiss = new Function(
	`${helperMatch[0].replace(/^export /, '')}; return isManualArticleBackdropDismiss;`,
)();

describe('ManualArticleForm backdrop dismiss', () => {
	it('does not close when the click target is inside modal content', () => {
		const backdrop = {};
		const content = {};
		assert.equal(isManualArticleBackdropDismiss(
			{ target: content, currentTarget: backdrop },
			true,
		), false);
	});

	it('closes when pointerdown and click both hit the backdrop', () => {
		const backdrop = {};
		assert.equal(isManualArticleBackdropDismiss(
			{ target: backdrop, currentTarget: backdrop },
			true,
		), true);
	});

	it('does not close when pointerdown started on content even if click lands on backdrop', () => {
		const backdrop = {};
		assert.equal(isManualArticleBackdropDismiss(
			{ target: backdrop, currentTarget: backdrop },
			false,
		), false);
	});
});

describe('ManualArticleForm wiring', () => {
	it('closes on backdrop via target === currentTarget, not overlay onClick={onClose}', () => {
		assert.match(formSource, /onClick=\{handleBackdropClick\}/);
		assert.match(formSource, /onPointerDown=\{handleBackdropPointerDown\}/);
		assert.match(formSource, /event\.target === event\.currentTarget/);
		assert.doesNotMatch(formSource, /bg-black\/50 p-4"[\s\S]{0,120}onClick=\{onClose\}/);
		assert.match(formSource, /isManualArticleBackdropDismiss\(event, pressedOnBackdrop\)/);
	});

	it('stops content clicks on a real DOM wrapper, not Card', () => {
		assert.match(formSource, /className="w-full max-w-lg"[\s\S]{0,80}onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
		assert.match(formSource, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
		assert.doesNotMatch(formSource, /<Card[^>]*onClick=/);
	});

	it('Save article submits through handleSubmit', () => {
		assert.match(formSource, /<form onSubmit=\{handleSubmit\}/);
		assert.match(formSource, /type="submit"/);
		assert.match(formSource, /Save article/);
		assert.match(formSource, /await onSubmit\?\.\(\{/);
		assert.match(formSource, /title: form\.title\.trim\(\),/);
		assert.match(formSource, /url: form\.url\.trim\(\),/);
		assert.match(formSource, /featuredImage: form\.featuredImage\.trim\(\),/);
		assert.doesNotMatch(formSource, /websiteId/);
	});

	it('empty optional URL does not block submission', () => {
		assert.match(formSource, /label="URL \(optional\)"/);
		assert.doesNotMatch(formSource, /type="url"/);
		assert.match(formSource, /if \(!form\.title\.trim\(\)\)/);
		assert.doesNotMatch(formSource, /if \(!form\.url/);
	});

	it('parent still supplies websiteId and reloads after save', () => {
		assert.match(studioSource, /onSubmit=\{saveManualArticle\}/);
		assert.match(studioSource, /apiServerClient\.fetch\('\/ai-pins\/manual-articles'/);
		assert.match(studioSource, /JSON\.stringify\(\{ \.\.\.payload, websiteId \}\)/);
		assert.match(studioSource, /setSelectedArticleIds\(\(prev\) => new Set\(prev\)\.add\(mapped\.id\)\)/);
		assert.match(studioSource, /setActiveArticleId\(mapped\.id\)/);
		assert.match(studioSource, /await loadArticles\(\)/);
	});
});
