/**
 * AI Writer article-length presets and helpers (web).
 * Kept in sync with apps/api/src/services/writer-article-length.js
 */

import { buildWriterLanguageEnforcement, normalizeWriterLanguage } from './writerLanguage.js';

/** @typedef {{
 *   id: string,
 *   label: string,
 *   minWords: number,
 *   maxWords: number,
 *   minHeadings: number,
 *   maxHeadings: number,
 *   maxTokens: number,
 *   timeoutMs: number,
 * }} WriterLengthPreset */

/** @type {Record<string, WriterLengthPreset>} */
export const WRITER_LENGTH_PRESETS = {
	short: {
		id: 'short',
		label: 'Short (600-900 words)',
		minWords: 600,
		maxWords: 900,
		minHeadings: 4,
		maxHeadings: 5,
		maxTokens: 3200,
		timeoutMs: 120000,
	},
	medium: {
		id: 'medium',
		label: 'Medium (1000-1500 words)',
		minWords: 1000,
		maxWords: 1500,
		minHeadings: 6,
		maxHeadings: 8,
		maxTokens: 5200,
		timeoutMs: 180000,
	},
	long: {
		id: 'long',
		label: 'Long (1800-2500 words)',
		minWords: 1800,
		maxWords: 2500,
		minHeadings: 9,
		maxHeadings: 12,
		maxTokens: 9000,
		timeoutMs: 300000,
	},
	xl: {
		id: 'xl',
		label: 'XL (2500-3500 words)',
		minWords: 2500,
		maxWords: 3500,
		minHeadings: 12,
		maxHeadings: 16,
		maxTokens: 12000,
		timeoutMs: 360000,
	},
};

export const WRITER_LENGTH_OPTIONS = Object.values(WRITER_LENGTH_PRESETS);

/**
 * @param {string} value
 * @returns {WriterLengthPreset}
 */
export function resolveWriterLengthPreset(value) {
	const raw = String(value || '').trim().toLowerCase();
	if (WRITER_LENGTH_PRESETS[raw]) return WRITER_LENGTH_PRESETS[raw];

	for (const preset of WRITER_LENGTH_OPTIONS) {
		if (preset.label.toLowerCase() === raw) return preset;
	}

	if (raw.includes('xl') || raw.includes('2500-3500') || raw.includes('3500')) {
		return WRITER_LENGTH_PRESETS.xl;
	}
	if (raw.includes('long') || raw.includes('1800')) {
		return WRITER_LENGTH_PRESETS.long;
	}
	if (raw.includes('short') || raw.includes('600')) {
		return WRITER_LENGTH_PRESETS.short;
	}
	if (raw.includes('medium') || raw.includes('1000')) {
		return WRITER_LENGTH_PRESETS.medium;
	}

	return WRITER_LENGTH_PRESETS.medium;
}

/**
 * @param {WriterLengthPreset} preset
 */
export function autoHeadingCount(preset) {
	const min = Number(preset?.minHeadings) || 4;
	const max = Number(preset?.maxHeadings) || min;
	return String(Math.round((min + max) / 2));
}

/**
 * @param {string} text
 */
export function countPlainWords(text) {
	const cleaned = String(text || '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&[a-z]+;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned) return 0;
	return cleaned.split(' ').filter(Boolean).length;
}

/**
 * @param {object|null|undefined} article
 */
export function countArticleWords(article) {
	if (!article || typeof article !== 'object') return 0;
	const chunks = [
		article.introduction,
		...(Array.isArray(article.sections)
			? article.sections.flatMap((section) => [section?.heading, section?.content])
			: []),
		...(Array.isArray(article.faq)
			? article.faq.flatMap((item) => [item?.question, item?.answer])
			: []),
		article.conclusion,
	];
	return countPlainWords(chunks.filter(Boolean).join(' '));
}

/**
 * Build a continuation prompt that asks only for additive JSON.
 * @param {object} article
 * @param {{ minWords: number, maxWords: number, currentWords: number, language?: string }} params
 */
export function buildContinuationPrompt(article, { minWords, maxWords, currentWords, language } = {}) {
	const lastHeading = Array.isArray(article?.sections) && article.sections.length
		? String(article.sections[article.sections.length - 1]?.heading || '').trim()
		: '';
	const deficit = Math.max(0, minWords - Number(currentWords || 0));
	const existingOutline = Array.isArray(article?.sections)
		? article.sections.map((section, index) => `${index + 1}. ${section?.heading || 'Section'}`).join('\n')
		: '(none)';

	const languageBlock = buildWriterLanguageEnforcement(normalizeWriterLanguage(language));

	return `Continue the food blog article below. Do NOT regenerate the full article.
Current word count: ${currentWords}. Required minimum: ${minWords} (target range ${minWords}-${maxWords}).
You must add at least ${deficit} more words.

Continue ONLY from the last section${lastHeading ? ` ("${lastHeading}")` : ''}.
Add new H2/H3 sections after the existing ones. Optionally expand FAQ and conclusion.
Preserve SEO fields, recipe_schema, internal/external link style, HTML formatting, and existing section content.

${languageBlock}

Existing section outline (do not repeat these headings):
${existingOutline}

Existing article JSON (read-only context):
${JSON.stringify({
		seo_title: article?.seo_title || '',
		meta_description: article?.meta_description || '',
		slug: article?.slug || '',
		introduction: article?.introduction || '',
		sections: article?.sections || [],
		faq: article?.faq || [],
		conclusion: article?.conclusion || '',
		recipe_schema: article?.recipe_schema ?? null,
	})}

Respond ONLY with a single valid JSON object (no markdown) using exactly this shape:
{
  "sections": [ { "heading": "H2/H3 text", "level": "h2" | "h3", "content": "HTML paragraphs" } ],
  "faq": [ { "question": "string", "answer": "string" } ],
  "conclusion": "optional expanded closing paragraph (HTML allowed)"
}
"sections" must contain ONLY new sections to append.
"faq" may be [] or additional FAQ items to append.
If you expand the conclusion, return the full replacement conclusion text; otherwise omit conclusion or use "".`;
}

/**
 * Merge a continuation patch into the original article without dropping SEO/HTML/schema.
 * @param {object} article
 * @param {object|null} patch
 */
export function mergeArticleContinuation(article, patch) {
	if (!article || typeof article !== 'object') return article;
	if (!patch || typeof patch !== 'object') return { ...article };

	const baseSections = Array.isArray(article.sections) ? [...article.sections] : [];
	const patchSections = Array.isArray(patch.sections) ? patch.sections.filter((section) => (
		section && typeof section === 'object' && (section.heading || section.content)
	)) : [];

	const existingHeadings = new Set(
		baseSections.map((section) => String(section?.heading || '').trim().toLowerCase()).filter(Boolean),
	);
	const appendedSections = patchSections.filter((section) => {
		const key = String(section?.heading || '').trim().toLowerCase();
		if (!key) return true;
		if (existingHeadings.has(key)) return false;
		existingHeadings.add(key);
		return true;
	});

	const baseFaq = Array.isArray(article.faq) ? [...article.faq] : [];
	const patchFaq = Array.isArray(patch.faq) ? patch.faq.filter((item) => (
		item && typeof item === 'object' && (item.question || item.answer)
	)) : [];
	const existingQuestions = new Set(
		baseFaq.map((item) => String(item?.question || '').trim().toLowerCase()).filter(Boolean),
	);
	const appendedFaq = patchFaq.filter((item) => {
		const key = String(item?.question || '').trim().toLowerCase();
		if (!key) return true;
		if (existingQuestions.has(key)) return false;
		existingQuestions.add(key);
		return true;
	});

	const nextConclusion = typeof patch.conclusion === 'string' && patch.conclusion.trim()
		? patch.conclusion
		: article.conclusion;

	return {
		...article,
		seo_title: article.seo_title,
		meta_description: article.meta_description,
		slug: article.slug,
		introduction: article.introduction,
		recipe_schema: article.recipe_schema ?? null,
		sections: [...baseSections, ...appendedSections],
		faq: [...baseFaq, ...appendedFaq],
		conclusion: nextConclusion,
	};
}
