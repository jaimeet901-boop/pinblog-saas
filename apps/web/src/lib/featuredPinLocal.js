/**
 * Local (non-AI) pin copy for Featured Image mode.
 * Titles/CTAs vary; Template Intelligence assigns the visual system.
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

const TITLE_PATTERNS = [
	(title) => title,
	(title) => `Easy ${title}`,
	(title) => `${title} You’ll Love`,
	(title) => `Best ${title} Ideas`,
	(title) => `${title} in Minutes`,
	(title) => `How to Make ${title}`,
	(title) => `${title}: Simple & Delicious`,
	(title) => `Weeknight ${title}`,
	(title) => `${title} Recipe`,
	(title) => `Save This ${title}`,
];

const CTA_BY_FAMILY = {
	dessert: ['Save Dessert', 'Bake This', 'Sweet Treat', 'Try Tonight'],
	healthy: ['Eat Fresh', 'Try Clean', 'Get Recipe', 'Feel Good'],
	dinner: ['Make Dinner', 'Cook Tonight', 'Get Recipe', 'Save Meal'],
	breakfast: ['Make Morning', 'Brunch Idea', 'Start Day', 'Try Breakfast'],
	drinks: ['Mix This', 'Sip & Save', 'Try Drink', 'Cheers'],
	snacks: ['Snack Time', 'Party Bite', 'Crunch This', 'Save Snack'],
	general: ['Save Recipe', 'Try This', 'Get the Recipe', 'Pin for Later'],
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
	const baseTitle = String(
		panel.pinTitle
		|| analysis?.title
		|| article?.title
		|| article?.slug
		|| 'Pinterest Pin',
	).trim();
	const baseDescription = String(
		panel.pinDescription
		|| analysis?.seoDescription
		|| article?.metaDescription
		|| article?.excerpt
		|| `Discover more: ${article?.title || 'this article'}`,
	).trim();
	const keywords = safeArray(
		analysis?.keywords?.length
			? analysis.keywords
			: [article?.category, 'pinterest', 'blog'].filter(Boolean),
	);
	const hashtags = safeArray(
		analysis?.hashtags?.length
			? analysis.hashtags
			: ['#pinterest', '#blog'],
	);

	return Array.from({ length: n }).map((_, index) => {
		const pattern = TITLE_PATTERNS[index % TITLE_PATTERNS.length];
		const title = truncate(pattern(baseTitle), 100);
		const overlayText = truncate(
			panel.textOverlay
			|| analysis?.cta
			|| ctas[index % ctas.length],
			48,
		);
		return {
			title,
			description: truncate(baseDescription, 500),
			overlayText,
			suggestedKeywords: keywords,
			suggestedHashtags: hashtags,
			imagePrompt: '',
			category: article?.category || analysis?.pinterestCategory || family,
		};
	});
}
