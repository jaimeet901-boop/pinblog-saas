/**
 * AI Writer article-length presets and helpers (server).
 * Kept in sync with apps/web/src/lib/writerArticleLength.js
 */

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
 * @param {Partial<{ articleLength: string, minWords: number|string, maxWords: number|string }>} input
 * @returns {WriterLengthPreset & { minWords: number, maxWords: number }}
 */
export function normalizeWriterLengthParams(input = {}) {
	const preset = resolveWriterLengthPreset(input.articleLength || '');
	const minWords = Math.max(1, Number(input.minWords) || preset.minWords);
	const maxWords = Math.max(minWords, Number(input.maxWords) || preset.maxWords);
	return {
		...preset,
		minWords,
		maxWords,
	};
}

/**
 * Recommended heading count (midpoint of the preset range).
 * @param {WriterLengthPreset} preset
 */
export function autoHeadingCount(preset) {
	const min = Number(preset?.minHeadings) || 4;
	const max = Number(preset?.maxHeadings) || min;
	return String(Math.round((min + max) / 2));
}

/**
 * System-prompt addendum that hard-enforces length.
 * @param {{ minWords: number, maxWords: number, minHeadings: number, maxHeadings: number }} params
 */
export function buildLengthEnforcementPrompt({ minWords, maxWords, minHeadings, maxHeadings }) {
	return [
		'ARTICLE LENGTH REQUIREMENTS (MANDATORY — OVERRIDE SOFT STYLE GUIDANCE):',
		`- The finished article MUST contain between ${minWords} and ${maxWords} words.`,
		`- Count every word in introduction + all section bodies + FAQ questions/answers + conclusion.`,
		`- NEVER stop before reaching at least ${minWords} words.`,
		`- Do not summarize early. Do not write an outline-style or short-form article.`,
		`- Expand sections naturally with concrete details, examples, tips, and sensory food writing.`,
		`- Use ${minHeadings}-${maxHeadings} H2/H3 headings. Add additional H2/H3 sections when necessary to reach the word count.`,
		'- FAQ and conclusion count toward the total word count.',
		'- Keep the required JSON shape. Prefer longer section content over omitting fields.',
	].join('\n');
}

/**
 * Strip HTML and count whitespace-separated words.
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
