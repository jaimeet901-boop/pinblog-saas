import { resolveImageGenerationTarget } from './image-generation-target.js';

function normalizeText(value, max = 0) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!max || text.length <= max) {
		return text;
	}
	return text.slice(0, max);
}

/**
 * Text-to-image prompt for Fal/FLUX — background photo only.
 * Pin copy and template layout are applied later via canvas compose.
 */
export function buildBackgroundImagePrompt({
	category = '',
	keywords = [],
	imagePrompt = '',
	recipeContext = '',
	channel = '',
	exportProfileId = '',
	generationTarget = null,
} = {}) {
	const target = generationTarget || resolveImageGenerationTarget({ channel, exportProfileId });
	const normalizedKeywords = (Array.isArray(keywords) ? keywords : [])
		.map((item) => normalizeText(String(item), 40))
		.filter(Boolean)
		.slice(0, 12);
	const categoryText = normalizeText(category, 120);
	const creative = normalizeText(imagePrompt, 800);
	const context = normalizeText(recipeContext, 500);
	const layoutGuard = target.channel === 'facebook'
		? 'no social post layout, no watermark, no graphic design elements'
		: 'no Pinterest layout, no watermark, no graphic design elements';

	return [
		`Photorealistic food or lifestyle background photo, ${target.promptOrientation}.`,
		`No text, no typography, no title, no CTA, no logo, no border, no frame, ${layoutGuard}.`,
		categoryText ? `Recipe category: ${categoryText}` : '',
		normalizedKeywords.length > 0 ? `Subject keywords: ${normalizedKeywords.join(', ')}` : '',
		context ? `Recipe context: ${context}` : '',
		creative ? `Creative direction: ${creative}` : '',
	].filter(Boolean).join('\n');
}
