/**
 * Local (non-AI) pin copy for Featured Image mode.
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

/**
 * Build pin drafts from article + panel fields without calling any AI provider.
 */
export function buildLocalPinsFromArticle({ article, count = 1, panel = {}, analysis = null }) {
	const n = Math.max(1, Number(count) || 1);
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
	const baseOverlay = truncate(
		panel.textOverlay
		|| analysis?.cta
		|| article?.title
		|| article?.slug
		|| 'Read now',
		48,
	);
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
		const suffix = n > 1 ? ` (${index + 1})` : '';
		return {
			title: truncate(`${baseTitle}${suffix}`, 100),
			description: truncate(baseDescription, 500),
			overlayText: baseOverlay,
			suggestedKeywords: keywords,
			suggestedHashtags: hashtags,
			imagePrompt: '',
		};
	});
}
