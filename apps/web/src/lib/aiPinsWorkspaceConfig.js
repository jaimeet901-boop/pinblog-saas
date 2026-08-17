/**
 * Derive AI Pins Studio UI options from Workspace Config only.
 * No hardcoded providers/models/prompts/flags — Admin is the source of truth.
 */

import { normalizeTemplateConfig } from '@/lib/pinTemplates';
import { normalizeStudioPromptChannel, resolveChannelPromptPack } from '@/lib/studio/promptPacks';
import { planCreditsIncludedPerMonth, workspaceWalletRemaining } from '@/lib/workspaceWalletRemaining';

const LANGUAGE_LABELS = {
	en: 'English',
	fr: 'French',
	es: 'Spanish',
	de: 'German',
	it: 'Italian',
	pt: 'Portuguese',
};

/** Pinterest size presets — product layout chrome; default id comes from config. */
export const PIN_ASPECT_RATIOS = [
	{ id: 'tall', label: 'Tall', ratio: '1:2', frame: 'tall', match: ['1:2'] },
	{ id: 'pinterest', label: 'Pinterest', ratio: '2:3', frame: 'pin', match: ['2:3', '2/3'] },
	{ id: 'classic', label: 'Classic', ratio: '3:4', frame: 'classic', match: ['3:4', '3/4'] },
	{ id: 'custom', label: 'Custom', ratio: 'Free', frame: 'custom', match: [] },
];

export function languageLabelFromConfig(config) {
	const code = String(config?.general?.defaultLanguage || config?.typographyHints?.defaultLanguage || 'en').toLowerCase();
	return LANGUAGE_LABELS[code] || (code.length > 2 ? code : 'English');
}

export function resolveDefaultImageProvider(config) {
	return '';
}

export function resolveDefaultTextProvider(config) {
	return '';
}

export function buildImageQualityOptions(config) {
	const estimate = Number(config?.images?.estimateCreditsPerAiPin);
	const aiCreditHint = Number.isFinite(estimate) ? estimate : 0;

	const providerOptions = [{
		id: 'ai',
		label: 'AI image',
		hint: 'Generated image',
		imageMode: 'generate_ai',
		creditHint: aiCreditHint,
	}];

	return [
		...providerOptions,
		{
			id: 'featured',
			label: 'Featured',
			hint: 'Article image · no AI',
			imageMode: 'use_featured',
			creditHint: 0,
		},
	];
}

export function resolveDefaultImageQualityId(config, qualities) {
	const list = Array.isArray(qualities) ? qualities : buildImageQualityOptions(config);
	const strategy = String(config?.images?.imageSourceStrategy || '').trim().toLowerCase();
	if (strategy === 'always_featured' || strategy === 'featured_first' || strategy === 'featured_image_first') {
		const featured = list.find((item) => item.imageMode === 'use_featured');
		if (featured) return featured.id;
	}
	if (strategy === 'always_ai' || strategy === 'ai_first' || strategy === 'ai_image_first' || !strategy) {
		return list.find((item) => item.imageMode === 'generate_ai')?.id || list[0]?.id || 'featured';
	}

	const qualitySetting = String(config?.images?.quality || '').toLowerCase();
	if (
		qualitySetting.includes('feature')
		|| qualitySetting === 'budget'
	) {
		const featured = list.find((item) => item.imageMode === 'use_featured');
		if (featured) return featured.id;
	}
	return list.find((item) => item.imageMode === 'generate_ai')?.id || list[0]?.id || 'featured';
}

export function buildPinCountOptions(config) {
	const max = Math.max(1, Number(config?.limits?.pinsPerBatch) || 20);
	const candidates = [1, 3, 5, 10, 20].filter((count) => count <= max);
	return candidates.length > 0 ? candidates : [1];
}

export function resolveDefaultAspectRatioId(config) {
	const ratio = String(config?.pinterest?.imageRatio || '').trim();
	const match = PIN_ASPECT_RATIOS.find((item) => item.match.some((token) => ratio === token || ratio.includes(token)));
	return match?.id || 'pinterest';
}

export function mapStudioTemplates(config) {
	const rows = Array.isArray(config?.templates) ? config.templates : [];
	return rows.map((item) => ({
		id: item.id,
		name: item.name || 'Untitled template',
		configuration: normalizeTemplateConfig(item.configuration || {}),
		isDefault: Boolean(item.isDefault),
		thumbnailUrl: item.thumbnailUrl || '',
	}));
}

export function mapStudioBrandKits(config) {
	const rows = Array.isArray(config?.brandKits) ? config.brandKits : [];
	return rows.map((item) => ({
		id: item.id,
		name: item.name || 'Untitled kit',
		isDefault: Boolean(item.isDefault),
		logoUrl: item.logoUrl || '',
		primaryColor: item.primaryColor || '',
		secondaryColor: item.secondaryColor || '',
		accentColor: item.accentColor || '',
		fontHeading: item.fontHeading || '',
		fontBody: item.fontBody || '',
		watermarkText: item.watermarkText || '',
		watermarkUrl: item.watermarkUrl || '',
		websiteUrl: item.websiteUrl || '',
	}));
}

export function mapStudioPinStyles(config) {
	if (Array.isArray(config?.pinStyles) && config.pinStyles.length > 0) {
		return config.pinStyles.map((item) => {
			if (typeof item === 'string') return item;
			return item.label || item.id || item.value;
		}).filter(Boolean);
	}
	const fromContent = config?.content?.pinStyles;
	if (Array.isArray(fromContent) && fromContent.length > 0) {
		return fromContent.map(String).filter(Boolean);
	}
	return [];
}

export function mapStudioCredits(config) {
	const credits = config?.credits || {};
	const remaining = workspaceWalletRemaining({
		remaining: credits.remaining ?? credits.ai?.remaining ?? credits.image?.remaining,
		balance: credits.balance,
	});
	const quota = planCreditsIncludedPerMonth(credits);
	return {
		plan: credits.planSlug || credits.plan || 'free',
		balance: remaining,
		quota,
		remaining,
	};
}

export function buildLegacyPinterestPinPromptFromConfig({ config, article, count, panel }) {
	const system = String(config?.prompts?.pinSystem || '').trim();
	const userSeed = String(config?.prompts?.pinUser || '').trim();
	const header = system || 'You are a Pinterest SEO expert for blog traffic growth.';
	const guidance = userSeed ? `Platform guidance: ${userSeed}\n` : '';

	return `${header}
${guidance}You are a senior Pinterest art director creating PREMIUM BlogToPin / Canva-quality pins.
First ANALYZE the recipe: category family (dessert|healthy|dinner|breakfast|drinks|snacks|general), ingredients, mood, cooking time, difficulty, audience.
Then for EACH pin write short luxury marketing copy AND a designRecommendation for that family identity.
STRICT COPY RULES:
- title MUST be 3 to 6 words only (punchy Pinterest headline, no long sentences).
- subtitle is optional (max 6 words) — soft supporting line under the title.
- overlayText is a short CTA badge (2–4 words), e.g. "Save Recipe", "Try Tonight".
- imagePrompt MUST be a detailed background photo prompt ONLY — describe food/lifestyle scene, lighting, styling, and ingredients. No text, no typography, no pin layout, no title, no CTA, no borders (template overlay is applied separately).
Use the Premium Design System: prefer distinct templates from the recipe family identity; never reuse the same template, font mood, or CTA style in this batch.
Return ONLY a valid JSON object in this exact shape:
{
  "recipeAnalysis": {
    "family": "dessert",
    "mood": "indulgent",
    "cookingTime": "under_30",
    "difficulty": "easy",
    "audience": "families",
    "ingredients": ["chocolate", "butter"]
  },
  "pins": [
    {
      "title": "Molten Chocolate Cake",
      "subtitle": "Gooey center",
      "description": "Short pin description for clicks",
      "overlayText": "Save Recipe",
      "layoutStyle": "handwritten_accent",
      "designRecommendation": {
        "template": "handwritten_accent",
        "fontPair": { "heading": "Georgia, \\"Times New Roman\\", serif", "script": "\\"Segoe Script\\", cursive" },
        "colorPalette": { "primary": "#9F1239", "secondary": "#FFE4E6", "accent": "#E8B86D", "text": "#FFF8F1", "overlay": "#4C0519", "ctaBg": "#FFF7ED", "ctaText": "#9F1239", "brush": "#BE123C" },
        "titlePosition": "bottom",
        "ctaStyle": "pill-warm",
        "overlayStyle": "gradient",
        "decoration": "brush",
        "brandPlacement": "bottom-bar",
        "scriptAccent": true
      },
      "suggestedKeywords": ["keyword1", "keyword2", "keyword3"],
      "suggestedHashtags": ["#tag1", "#tag2", "#tag3"],
      "imagePrompt": "detailed background photo prompt ONLY — photorealistic food scene, no text or pin layout"
    }
  ]
}
Generate exactly ${count} pins.
Language: ${panel.language}
Target audience: ${panel.targetAudience}
Tone: ${panel.toneOfVoice}
Style: ${panel.style || ''}
Website article metadata:
Title: ${article.title}
Meta Description: ${article.metaDescription || ''}
URL: ${article.url}
Category: ${article.category || ''}
Featured Image: ${article.featuredImage || ''}
Optional guidance:
Preferred pin title seed: ${panel.pinTitle || ''}
Preferred description seed: ${panel.pinDescription || ''}
Preferred overlay seed: ${panel.textOverlay || ''}
Output only JSON and no markdown.`;
}

export function buildFacebookPostPromptFromConfig({ config, article, count, panel }) {
	const pack = resolveChannelPromptPack(config, 'facebook');
	const header = String(pack.copySystem || '').trim() || 'You are a Facebook Page content strategist.';
	const userSeed = String(pack.copyUser || '').trim();
	const guidance = userSeed ? `Platform guidance: ${userSeed}\n` : '';
	const hints = pack.analyzeHints || {};

	return `${header}
${guidance}You are a senior Facebook Page art director creating PREMIUM link-post creatives for food and lifestyle brands.
First ANALYZE the article: category family (dessert|healthy|dinner|breakfast|drinks|snacks|general), ingredients, mood, cooking time, difficulty, audience.
Then for EACH link post write engaging Facebook copy AND a designRecommendation for that family identity.
STRICT COPY RULES:
- title MUST be a punchy link headline (3 to 8 words).
- description is the post message (1–2 short sentences optimized for engagement and clicks).
- overlayText is a short CTA badge (2–4 words), e.g. "Learn More", "Get Recipe".
Use distinct visual moods per post; never reuse the same template, font mood, or CTA style in this batch.
Image format: landscape link-post (${hints.imageDimensions || '1200x630'}, ${hints.aspect || '1.91:1'}).
Return ONLY a valid JSON object in this exact shape:
{
  "recipeAnalysis": {
    "family": "dessert",
    "mood": "indulgent",
    "cookingTime": "under_30",
    "difficulty": "easy",
    "audience": "families",
    "ingredients": ["chocolate", "butter"]
  },
  "pins": [
    {
      "title": "Molten Chocolate Cake",
      "subtitle": "",
      "description": "Short Facebook post message with link-preview appeal",
      "overlayText": "Learn More",
      "layoutStyle": "link_post_clean",
      "designRecommendation": {
        "template": "link_post_clean",
        "fontPair": { "heading": "Georgia, \\"Times New Roman\\", serif", "script": "\\"Segoe Script\\", cursive" },
        "colorPalette": { "primary": "#1877F2", "secondary": "#E7F3FF", "accent": "#FFFFFF", "text": "#050505", "overlay": "#1C1E21", "ctaBg": "#1877F2", "ctaText": "#FFFFFF", "brush": "#42B72A" },
        "titlePosition": "bottom",
        "ctaStyle": "pill-blue",
        "overlayStyle": "gradient",
        "decoration": "none",
        "brandPlacement": "bottom-bar",
        "scriptAccent": false
      },
      "suggestedKeywords": ["keyword1", "keyword2", "keyword3"],
      "suggestedHashtags": ["#tag1", "#tag2", "#tag3"],
      "imagePrompt": "detailed AI image prompt for a landscape Facebook link-post image"
    }
  ]
}
Generate exactly ${count} posts.
Language: ${panel.language}
Target audience: ${panel.targetAudience}
Tone: ${panel.toneOfVoice}
Style: ${panel.style || ''}
Website article metadata:
Title: ${article.title}
Meta Description: ${article.metaDescription || ''}
URL: ${article.url}
Category: ${article.category || ''}
Featured Image: ${article.featuredImage || ''}
Optional guidance:
Preferred headline seed: ${panel.pinTitle || ''}
Preferred message seed: ${panel.pinDescription || ''}
Preferred overlay seed: ${panel.textOverlay || ''}
Output only JSON and no markdown.`;
}

export function buildPinPromptFromConfig({ config, article, count, panel, channel }) {
	const normalized = normalizeStudioPromptChannel(channel);
	if (normalized === 'facebook') {
		return buildFacebookPostPromptFromConfig({ config, article, count, panel });
	}
	return buildLegacyPinterestPinPromptFromConfig({ config, article, count, panel });
}

export {
	canGenerateWithCredits,
	estimatePinCredits,
	isInsufficientCreditsError,
} from './aiPinsGenerateCredits.js';

/** Re-export publishing config resolver — AI Pins reads publish settings only via Workspace Config. */
export { resolvePublishingConfig } from '@/services/ai-pins/publishingConfig.js';
