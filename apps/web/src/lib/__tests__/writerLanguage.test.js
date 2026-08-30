/**
 * AI Writer language support — selector, enforcement, RTL, legacy drafts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WRITER_LANGUAGE,
	WRITER_LANGUAGES,
	buildWriterLanguageEnforcement,
	isWriterRtlLanguage,
	normalizeWriterLanguage,
	writerContentLanguageAttrs,
} from '../writerLanguage.js';
import { buildContinuationPrompt } from '../writerArticleLength.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// __tests__ → lib → src → web → apps → repo
const webSrc = path.resolve(here, '../..');
const repoRoot = path.resolve(here, '../../../../..');

describe('writerLanguage helpers', () => {
	it('exposes exactly English, Arabic, Spanish, French with English default', () => {
		expect(WRITER_LANGUAGES).toEqual(['English', 'Arabic', 'Spanish', 'French']);
		expect(DEFAULT_WRITER_LANGUAGE).toBe('English');
	});

	it('normalizes supported languages and coerces unsupported legacy values to English', () => {
		expect(normalizeWriterLanguage('Arabic')).toBe('Arabic');
		expect(normalizeWriterLanguage('spanish')).toBe('Spanish');
		expect(normalizeWriterLanguage('FRENCH')).toBe('French');
		expect(normalizeWriterLanguage('English')).toBe('English');
		expect(normalizeWriterLanguage('German')).toBe('English');
		expect(normalizeWriterLanguage('Italian')).toBe('English');
		expect(normalizeWriterLanguage('Portuguese')).toBe('English');
		expect(normalizeWriterLanguage('Dutch')).toBe('English');
		expect(normalizeWriterLanguage('')).toBe('English');
		expect(normalizeWriterLanguage(null)).toBe('English');
	});

	it('builds hard language enforcement covering all user-facing fields', () => {
		const block = buildWriterLanguageEnforcement('Arabic');
		expect(block).toContain('LANGUAGE REQUIREMENT (MANDATORY');
		expect(block).toContain('Write ALL user-facing content in Arabic');
		expect(block).toContain('seo_title');
		expect(block).toContain('meta_description');
		expect(block).toContain('FAQ');
		expect(block).toContain('recipe title/name');
		expect(block).toContain('ingredient text');
		expect(block).toContain('keywords may remain unchanged');
		expect(block).toContain('ASCII kebab-case');
		expect(block).toContain('Do NOT write in English unless the selected language is English');
	});

	it('returns Arabic RTL attrs and LTR for other languages', () => {
		expect(isWriterRtlLanguage('Arabic')).toBe(true);
		expect(isWriterRtlLanguage('English')).toBe(false);
		expect(writerContentLanguageAttrs('Arabic')).toEqual({ lang: 'ar', dir: 'rtl' });
		expect(writerContentLanguageAttrs('Spanish')).toEqual({ lang: 'es', dir: 'ltr' });
		expect(writerContentLanguageAttrs('French')).toEqual({ lang: 'fr', dir: 'ltr' });
		expect(writerContentLanguageAttrs('English')).toEqual({ lang: 'en', dir: 'ltr' });
		expect(writerContentLanguageAttrs('German')).toEqual({ lang: 'en', dir: 'ltr' });
	});
});

describe('writer language enforcement in continuation prompts', () => {
	it('includes language enforcement in continuation prompts', () => {
		const prompt = buildContinuationPrompt({
			seo_title: 'T',
			sections: [{ heading: 'Ingredients', content: '<p>one</p>' }],
			faq: [],
		}, {
			minWords: 1800,
			maxWords: 2500,
			currentWords: 100,
			language: 'Spanish',
		});
		expect(prompt).toContain('LANGUAGE REQUIREMENT (MANDATORY');
		expect(prompt).toContain('Write ALL user-facing content in Spanish');
		expect(prompt).toContain('Do NOT regenerate the full article');
	});

	it('defaults continuation language enforcement to English when omitted', () => {
		const prompt = buildContinuationPrompt({
			seo_title: 'T',
			sections: [{ heading: 'A', content: '<p>one</p>' }],
		}, {
			minWords: 600,
			maxWords: 900,
			currentWords: 10,
		});
		expect(prompt).toContain('Write ALL user-facing content in English');
	});
});

describe('Writer language wiring (source)', () => {
	const pageSource = readFileSync(path.join(webSrc, 'pages/app/WriterPage.jsx'), 'utf8');
	const sectionSource = readFileSync(
		path.join(webSrc, 'components/writer/WriterSectionBlocks.jsx'),
		'utf8',
	);
	const generateSource = readFileSync(path.join(webSrc, 'lib/aiGenerate.js'), 'utf8');
	const promptsSource = readFileSync(path.join(repoRoot, 'apps/api/src/constants/prompts.js'), 'utf8');

	it('selector lists only the four supported languages', () => {
		expect(pageSource).toMatch(/WRITER_LANGUAGES\.map/);
		expect(pageSource).toMatch(/from '@\/lib\/writerLanguage'/);
		expect(pageSource).not.toMatch(/German.*Italian.*Portuguese.*Dutch/);
		expect(pageSource).not.toMatch(/\['English', 'French', 'Spanish', 'German'/);
	});

	it('hard-enforces language in buildPrompt and passes language to generateText', () => {
		expect(pageSource).toMatch(/buildWriterLanguageEnforcement\(language\)/);
		expect(pageSource).toMatch(/language:\s*normalizeWriterLanguage\(form\.language\)/);
	});

	it('applies RTL/lang attrs on the editor root and meta previews; keeps slug LTR', () => {
		expect(pageSource).toMatch(/writerContentLanguageAttrs\(form\.language\)/);
		expect(pageSource).toMatch(/contentLangAttrs/);
		expect(pageSource).toMatch(/className="wr-atelier__editor p-4 sm:p-5" ref=\{editorRef\} \{\.\.\.contentLangAttrs\}/);
		expect(pageSource).toMatch(/label="Slug"[\s\S]*?dir="ltr"[\s\S]*?lang="en"/);
		expect(pageSource).toMatch(/Meta Title Preview[\s\S]*?\{\.\.\.contentLangAttrs\}/);
		expect(pageSource).toMatch(/Meta Description Preview[\s\S]*?\{\.\.\.contentLangAttrs\}/);
		expect(pageSource).not.toMatch(/className="wr-doc" \{\.\.\.contentLangAttrs\}/);
		expect(pageSource).not.toMatch(/wr-stream" ref=\{streamRef\} \{\.\.\.contentLangAttrs\}/);
	});

	it('includes explicit RTL visual alignment CSS for content and form fields', () => {
		const cssSource = readFileSync(path.join(webSrc, 'pages/app/WriterPage.css'), 'utf8');
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="rtl"\] \.wr-doc__title/);
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="rtl"\] \.wr-doc__meta/);
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="rtl"\] \.wr-doc__body/);
		expect(cssSource).toMatch(/:where\(h1, h2, h3, h4, p, li, blockquote, td, th\)/);
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="rtl"\] input:not\(\[dir="ltr"\]\)/);
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="rtl"\] textarea/);
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="rtl"\] input\[dir="ltr"\]/);
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="ltr"\] input:not\(\[dir="ltr"\]\)/);
		expect(cssSource).toMatch(/\.wr-preview-box \[dir="rtl"\]/);
		expect(cssSource).toMatch(/direction:\s*rtl/);
		expect(cssSource).toMatch(/text-align:\s*right/);
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="rtl"\] \.wr-doc__body ul/);
		expect(cssSource).toMatch(/\.wr-atelier__editor\[dir="rtl"\] \.wr-doc__body blockquote/);
		expect(cssSource).toMatch(/border-right:\s*3px solid/);
	});

	it('normalizes unsupported draft/history languages', () => {
		expect(pageSource).toMatch(/normalizeWriterLanguage\(draft\.language/);
		expect(pageSource).toMatch(/normalizeWriterLanguage\(item\.formSnapshot\.language/);
	});

	it('section AI prompts enforce language', () => {
		expect(sectionSource).toMatch(/buildWriterLanguageEnforcement\(resolvedLanguage\)/);
		expect(sectionSource).toMatch(/normalizeWriterLanguage\(form\?\.language\)/);
		expect(sectionSource).toMatch(/export function buildSectionPrompt/);
	});

	it('generateText forwards language into continuation prompts', () => {
		expect(generateSource).toMatch(/language,/);
		expect(generateSource).toMatch(/buildContinuationPrompt\(article, \{[\s\S]*language,/);
	});

	it('does not change shared backend SystemPrompt', () => {
		expect(promptsSource).toMatch(/Write in the requested language/);
		expect(promptsSource).not.toMatch(/LANGUAGE REQUIREMENT \(MANDATORY/);
	});
});
