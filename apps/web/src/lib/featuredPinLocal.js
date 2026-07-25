/**
 * Local (non-AI) pin copy for Featured Image mode.
 * Premium Pinterest copy: 3–7 word headlines + optional subtitle.
 */

function truncate(value, max = 160) {
	const text = String(value || '').trim();
	if (!text) return '';
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeArray(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	if (typeof value === 'string') {
		return value.split(',').map((item) => item.trim()).filter(Boolean);
	}
	return [];
}

function cleanTitleSeed(value) {
	return String(value || '')
		.replace(/\s*[|–—:].*$/, '')
		.replace(/\b(recipe|ideas?|guide|tips?)\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function clampWordCount(text, min = 3, max = 7) {
	const words = String(text || '').trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return 'Must-Try Recipe';
	if (words.length < min) {
		const fillers = ['Recipe', 'Made Easy', 'You Need'];
		return [...words, ...fillers].slice(0, min).join(' ');
	}
	return words.slice(0, max).join(' ');
}

const HEADLINE_BUILDERS = [
	(words) => words.slice(0, Math.min(5, words.length)).join(' '),
	(words) => `Easy ${words.slice(0, 4).join(' ')}`,
	(words) => `${words.slice(0, 3).join(' ')} Recipe`,
	(words) => `Best ${words.slice(0, 4).join(' ')}`,
	(words) => `${words.slice(0, 4).join(' ')} Tonight`,
	(words) => `Creamy ${words.slice(0, 4).join(' ')}`,
	(words) => `${words.slice(0, 3).join(' ')} in Minutes`,
	(words) => `Homemade ${words.slice(0, 4).join(' ')}`,
	(words) => `Simple ${words.slice(0, 4).join(' ')}`,
	(words) => `${words.slice(0, 5).join(' ')}`,
];

const SUBTITLE_BY_FAMILY = {
	dessert: ['Sweet · Decadent · Easy', 'Bakery-style at home', 'Worth every bite'],
	healthy: ['Fresh · Light · Nourishing', 'Clean ingredients', 'Feel-good flavor'],
	dinner: ['Weeknight comfort', 'Family favorite', 'Savory & satisfying'],
	breakfast: ['Morning made better', 'Brunch-worthy', 'Start bright'],
	drinks: ['Sip-worthy refreshment', 'Cool · Bright · Easy', 'Blend & enjoy'],
	snacks: ['Crispy · Shareable', 'Party-ready bites', 'Craveable & quick'],
	general: ['Save for later', 'Simple & delicious', 'Pin-worthy classic'],
};

const CTA_BY_FAMILY = {
	dessert: ['Save Recipe', 'Bake This', 'Try Tonight'],
	healthy: ['Get Recipe', 'Cook Fresh', 'Try This'],
	dinner: ['Make Tonight', 'Get Recipe', 'Save Meal'],
	breakfast: ['Make Morning', 'Try Brunch', 'Get Recipe'],
	drinks: ['Mix This', 'Sip & Save', 'Try Drink'],
	snacks: ['Snack Time', 'Save Bite', 'Make These'],
	general: ['Save Recipe', 'Try This', 'Get Recipe'],
};

function inferFamilyHint({ article, analysis, panel }) {
	const text = [
		article?.title,
		article?.category,
		article?.metaDescription,
		analysis?.pinterestCategory,
		analysis?.title,
		panel?.pinTitle,
	].filter(Boolean).join(' ');
	if (/\b(dessert|cake|cookie|brownie|pie|sweet|chocolate)\b/i.test(text)) return 'dessert';
	if (/\b(healthy|salad|vegan|keto|protein|clean)\b/i.test(text)) return 'healthy';
	if (/\b(dinner|pasta|roast|chicken|steak|casserole)\b/i.test(text)) return 'dinner';
	if (/\b(breakfast|brunch|pancake|waffle|oatmeal)\b/i.test(text)) return 'breakfast';
	if (/\b(drink|cocktail|smoothie|latte|juice|tea)\b/i.test(text)) return 'drinks';
	if (/\b(snack|appetizer|dip|chips|bites)\b/i.test(text)) return 'snacks';
	return 'general';
}

/**
 * Build pin drafts from article + panel fields without calling any AI provider.
 */
export function buildLocalPinsFromArticle({ article, count = 1, panel = {}, analysis = null }) {
	const n = Math.max(1, Number(count) || 1);
	const family = inferFamilyHint({ article, analysis, panel });
	const ctas = CTA_BY_FAMILY[family] || CTA_BY_FAMILY.general;
	const subtitles = SUBTITLE_BY_FAMILY[family] || SUBTITLE_BY_FAMILY.general;
	const seed = cleanTitleSeed(
		panel.pinTitle
		|| analysis?.title
		|| article?.title
		|| article?.slug
		|| 'Perfect Recipe',
	);
	const words = seed.split(/\s+/).filter(Boolean);
	const baseDescription = String(
		panel.pinDescription
		|| analysis?.seoDescription
		|| article?.metaDescription
		|| article?.excerpt
		|| '',
	).trim();
	const keywords = safeArray(
		analysis?.keywords?.length
			? analysis.keywords
			: [article?.category, 'pinterest', 'recipe'].filter(Boolean),
	);
	const hashtags = safeArray(
		analysis?.hashtags?.length
			? analysis.hashtags
			: ['#pinterest', '#recipe'],
	);

	return Array.from({ length: n }).map((_, index) => {
		const builder = HEADLINE_BUILDERS[index % HEADLINE_BUILDERS.length];
		const title = clampWordCount(builder(words.length ? words : ['Perfect', 'Recipe']));
		const subtitle = subtitles[index % subtitles.length];
		const overlayText = truncate(
			panel.textOverlay
			|| analysis?.cta
			|| ctas[index % ctas.length],
			28,
		);
		return {
			title,
			subtitle,
			description: truncate(baseDescription || subtitle, 160),
			overlayText,
			suggestedKeywords: keywords,
			suggestedHashtags: hashtags,
			imagePrompt: '',
			category: article?.category || analysis?.pinterestCategory || family,
		};
	});
}
