import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsBlockedHtmlPayload, sanitizeRichHtml } from '../sanitizeHtml.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const writerPagePath = path.resolve(here, '../../pages/app/WriterPage.jsx');
const legalPagePath = path.resolve(here, '../../pages/LegalPage.jsx');
const adminLegalPath = path.resolve(here, '../../pages/admin/AdminLegalPagesPage.jsx');

describe('High Priority #2 — sanitize AI / rich HTML before dangerouslySetInnerHTML', () => {
	it('safe HTML renders correctly (recipe-like formatting preserved)', () => {
		const input = [
			'<h2>Ingredients</h2>',
			'<p>Mix <strong>flour</strong> and <em>water</em>.</p>',
			'<ul><li>1 cup flour</li><li>2 eggs</li></ul>',
			'<ol><li>Whisk</li><li>Bake</li></ol>',
			'<pre><code>oven = 180C</code></pre>',
			'<table><thead><tr><th>Item</th></tr></thead><tbody><tr><td>Salt</td></tr></tbody></table>',
			'<a href="https://example.com/recipe" rel="noopener noreferrer">Source</a>',
			'<img src="https://cdn.example.com/dish.jpg" alt="Dish" />',
		].join('\n');

		const out = sanitizeRichHtml(input);
		expect(out).toContain('<h2>Ingredients</h2>');
		expect(out).toContain('<strong>flour</strong>');
		expect(out).toContain('<em>water</em>');
		expect(out).toContain('<li>1 cup flour</li>');
		expect(out).toContain('<code>oven = 180C</code>');
		expect(out).toContain('<td>Salt</td>');
		expect(out).toContain('https://example.com/recipe');
		expect(out).toContain('https://cdn.example.com/dish.jpg');
		expect(containsBlockedHtmlPayload(out)).toBe(false);
	});

	it('script tags are removed', () => {
		const out = sanitizeRichHtml('<p>Hi</p><script>alert(1)</script><p>Bye</p>');
		expect(out).toContain('<p>Hi</p>');
		expect(out).toContain('<p>Bye</p>');
		expect(out.toLowerCase()).not.toContain('<script');
		expect(out).not.toContain('alert(1)');
	});

	it('event handlers (onclick, onerror, etc.) are removed', () => {
		const out = sanitizeRichHtml(
			'<p onclick="alert(1)">Click</p><img src="https://x.test/a.png" onerror="alert(2)" alt="x" />',
		);
		expect(out).toContain('Click');
		expect(out.toLowerCase()).not.toMatch(/\sonclick\s*=/);
		expect(out.toLowerCase()).not.toMatch(/\sonerror\s*=/);
	});

	it('javascript: URLs are blocked', () => {
		const out = sanitizeRichHtml('<a href="javascript:alert(1)">Go</a><a href="https://safe.example">OK</a>');
		expect(out.toLowerCase()).not.toContain('javascript:');
		expect(out).toContain('https://safe.example');
	});

	it('normal recipe formatting is preserved through compose-like payload', () => {
		const composed = [
			'<p>Introduction with <strong>keyword</strong>.</p>',
			'<h2>Step One</h2>',
			'<p>Cook gently.</p>',
			'<h2>Frequently Asked Questions</h2>',
			'<h3>How long?</h3>',
			'<p>About 20 minutes.</p>',
			'<h2>Conclusion</h2>',
			'<p>Enjoy.</p>',
		].join('\n');
		const out = sanitizeRichHtml(composed);
		expect(out).toContain('Introduction');
		expect(out).toContain('<h2>Step One</h2>');
		expect(out).toContain('Frequently Asked Questions');
		expect(out).toContain('Conclusion');
	});

	it('streaming preview path stays text-only (no dangerouslySetInnerHTML on stream)', () => {
		const src = readFileSync(writerPagePath, 'utf8');
		const streamIdx = src.indexOf('className="wr-stream"');
		expect(streamIdx).toBeGreaterThan(-1);
		const streamBlock = src.slice(streamIdx, streamIdx + 280);
		expect(streamBlock).toContain('{stream');
		expect(streamBlock).not.toContain('dangerouslySetInnerHTML');
	});

	it('WriterPage and legal previews sanitize before dangerouslySetInnerHTML', () => {
		const writer = readFileSync(writerPagePath, 'utf8');
		expect(writer).toContain("from '@/lib/sanitizeHtml'");
		expect(writer).toContain('sanitizeRichHtml');
		expect(writer).toMatch(/sanitizeRichHtml\(\s*composeHtml\(article\)/);
		expect(writer).not.toMatch(/composeHtml\(article\)\.replace\(\/<script/);

		const legal = readFileSync(legalPagePath, 'utf8');
		expect(legal).toContain('sanitizeRichHtml');

		const admin = readFileSync(adminLegalPath, 'utf8');
		expect(admin).toContain('sanitizeRichHtml');
	});
});
