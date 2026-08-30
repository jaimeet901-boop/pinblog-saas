import { describe, expect, it } from 'vitest';
import {
	WRITER_LENGTH_OPTIONS,
	WRITER_LENGTH_PRESETS,
	autoHeadingCount,
	buildContinuationPrompt,
	countArticleWords,
	mergeArticleContinuation,
	resolveWriterLengthPreset,
} from '../writerArticleLength.js';

describe('writerArticleLength presets', () => {
	it('resolves Short/Medium/Long/XL labels and ids', () => {
		expect(resolveWriterLengthPreset('short').minWords).toBe(600);
		expect(resolveWriterLengthPreset('Short (600-900 words)').maxWords).toBe(900);
		expect(resolveWriterLengthPreset('medium').minWords).toBe(1000);
		expect(resolveWriterLengthPreset('Long (1800-2500 words)').minWords).toBe(1800);
		expect(resolveWriterLengthPreset('xl').minWords).toBe(2500);
		expect(resolveWriterLengthPreset('XL (2500-3500 words)').maxHeadings).toBe(16);
	});

	it('auto-scales heading targets per length', () => {
		expect(autoHeadingCount(WRITER_LENGTH_PRESETS.short)).toBe('5');
		expect(autoHeadingCount(WRITER_LENGTH_PRESETS.medium)).toBe('7');
		expect(autoHeadingCount(WRITER_LENGTH_PRESETS.long)).toBe('11');
		expect(autoHeadingCount(WRITER_LENGTH_PRESETS.xl)).toBe('14');
	});

	it('exposes four length options for the Writer UI', () => {
		expect(WRITER_LENGTH_OPTIONS.map((item) => item.id)).toEqual(['short', 'medium', 'long', 'xl']);
	});
});

describe('writerArticleLength word count + merge', () => {
	const baseArticle = {
		seo_title: 'Easy Vegan Lasagna',
		meta_description: 'A comforting plant-based lasagna with rich sauce.',
		slug: 'easy-vegan-lasagna',
		introduction: '<p>One two three four five six seven eight nine ten.</p>',
		sections: [
			{ heading: 'Ingredients', level: 'h2', content: '<p>eleven twelve thirteen fourteen fifteen.</p>' },
		],
		faq: [{ question: 'Can I freeze it?', answer: 'Yes you can freeze leftovers safely.' }],
		conclusion: '<p>sixteen seventeen eighteen nineteen twenty.</p>',
		recipe_schema: { '@type': 'Recipe', name: 'Easy Vegan Lasagna' },
	};

	it('counts introduction, sections, faq, and conclusion', () => {
		const words = countArticleWords(baseArticle);
		expect(words).toBeGreaterThan(20);
		expect(words).toBe(countArticleWords(baseArticle));
	});

	it('merges continuation sections/faq without dropping SEO or recipe schema', () => {
		const merged = mergeArticleContinuation(baseArticle, {
			sections: [
				{ heading: 'Baking Tips', level: 'h2', content: '<p>Add more detail about baking temperature and rest time for better texture.</p>' },
			],
			faq: [{ question: 'How long does it keep?', answer: 'About four days in the fridge.' }],
			conclusion: '<p>Enjoy leftovers the next day with a crisp green salad.</p>',
		});

		expect(merged.seo_title).toBe(baseArticle.seo_title);
		expect(merged.meta_description).toBe(baseArticle.meta_description);
		expect(merged.slug).toBe(baseArticle.slug);
		expect(merged.introduction).toBe(baseArticle.introduction);
		expect(merged.recipe_schema).toEqual(baseArticle.recipe_schema);
		expect(merged.sections).toHaveLength(2);
		expect(merged.sections[1].heading).toBe('Baking Tips');
		expect(merged.faq).toHaveLength(2);
		expect(merged.conclusion).toContain('green salad');
		expect(countArticleWords(merged)).toBeGreaterThan(countArticleWords(baseArticle));
	});

	it('skips duplicate section headings on merge', () => {
		const merged = mergeArticleContinuation(baseArticle, {
			sections: [
				{ heading: 'Ingredients', level: 'h2', content: '<p>duplicate</p>' },
				{ heading: 'Serving Ideas', level: 'h2', content: '<p>fresh herbs and olive oil.</p>' },
			],
		});
		expect(merged.sections.map((section) => section.heading)).toEqual(['Ingredients', 'Serving Ideas']);
	});

	it('builds a continuation prompt that asks for additive JSON only', () => {
		const prompt = buildContinuationPrompt(baseArticle, {
			minWords: 1800,
			maxWords: 2500,
			currentWords: 624,
			language: 'English',
		});
		expect(prompt).toContain('Do NOT regenerate the full article');
		expect(prompt).toContain('1800');
		expect(prompt).toContain('"sections"');
		expect(prompt).toContain('Ingredients');
		expect(prompt).toContain('Write ALL user-facing content in English');
	});
});

describe('writerArticleLength expected ranges', () => {
	it('documents target ranges for Short/Medium/Long/XL', () => {
		const ranges = Object.fromEntries(
			WRITER_LENGTH_OPTIONS.map((preset) => [preset.id, {
				minWords: preset.minWords,
				maxWords: preset.maxWords,
				headings: `${preset.minHeadings}-${preset.maxHeadings}`,
				maxTokens: preset.maxTokens,
				timeoutMs: preset.timeoutMs,
			}]),
		);

		expect(ranges.short).toEqual({
			minWords: 600,
			maxWords: 900,
			headings: '4-5',
			maxTokens: 3200,
			timeoutMs: 120000,
		});
		expect(ranges.medium).toEqual({
			minWords: 1000,
			maxWords: 1500,
			headings: '6-8',
			maxTokens: 5200,
			timeoutMs: 180000,
		});
		expect(ranges.long).toEqual({
			minWords: 1800,
			maxWords: 2500,
			headings: '9-12',
			maxTokens: 9000,
			timeoutMs: 300000,
		});
		expect(ranges.xl).toEqual({
			minWords: 2500,
			maxWords: 3500,
			headings: '12-16',
			maxTokens: 12000,
			timeoutMs: 360000,
		});
	});
});
