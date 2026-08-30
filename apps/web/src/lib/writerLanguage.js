/**
 * AI Writer supported languages (web-only).
 * Keep this list in sync with the WriterPage language selector.
 */

export const WRITER_LANGUAGES = Object.freeze(['English', 'Arabic', 'Spanish', 'French']);

export const DEFAULT_WRITER_LANGUAGE = 'English';

const LANGUAGE_BCP47 = Object.freeze({
	English: 'en',
	Arabic: 'ar',
	Spanish: 'es',
	French: 'fr',
});

/**
 * Coerce any stored/UI language to a supported Writer language.
 * Unsupported values (e.g. legacy German drafts) fall back to English.
 * @param {unknown} value
 * @returns {typeof WRITER_LANGUAGES[number]}
 */
export function normalizeWriterLanguage(value) {
	const raw = String(value || '').trim();
	if (!raw) return DEFAULT_WRITER_LANGUAGE;
	const match = WRITER_LANGUAGES.find((item) => item.toLowerCase() === raw.toLowerCase());
	return match || DEFAULT_WRITER_LANGUAGE;
}

/**
 * @param {unknown} language
 * @returns {boolean}
 */
export function isWriterRtlLanguage(language) {
	return normalizeWriterLanguage(language) === 'Arabic';
}

/**
 * HTML lang/dir attributes for Writer editing + preview surfaces.
 * @param {unknown} language
 * @returns {{ lang: string, dir: 'rtl' | 'ltr' }}
 */
export function writerContentLanguageAttrs(language) {
	const normalized = normalizeWriterLanguage(language);
	return {
		lang: LANGUAGE_BCP47[normalized] || 'en',
		dir: normalized === 'Arabic' ? 'rtl' : 'ltr',
	};
}

/**
 * Hard language lock for Writer generation / section AI / continuation prompts.
 * @param {unknown} language
 * @returns {string}
 */
export function buildWriterLanguageEnforcement(language) {
	const normalized = normalizeWriterLanguage(language);
	return [
		'LANGUAGE REQUIREMENT (MANDATORY — OVERRIDE OTHER STYLE GUIDANCE):',
		`- Write ALL user-facing content in ${normalized}.`,
		'- This includes: seo_title, meta_description, introduction, headings, section bodies, FAQ questions and answers, conclusion, recipe title/name, recipe description, recipe instructions, and ingredient text.',
		`- Do NOT write in English unless the selected language is English (selected: ${normalized}).`,
		'- User-provided keywords may remain unchanged; do not translate the keyword strings themselves.',
		'- URL slug may remain ASCII kebab-case for URLs.',
	].join('\n');
}
