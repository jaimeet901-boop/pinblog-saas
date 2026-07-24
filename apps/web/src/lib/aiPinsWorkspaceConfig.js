/**
 * Derive AI Pins Studio UI options from Workspace Config only.
 * No hardcoded providers/models/prompts/flags — Admin is the source of truth.
 */

import { normalizeTemplateConfig } from '@/lib/pinTemplates';

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
	const preferred = String(config?.images?.defaultImageProvider || '').trim().toLowerCase();
	const providers = Array.isArray(config?.imageProviders) ? config.imageProviders.filter((item) => item?.enabled !== false) : [];
	if (preferred) {
		const match = providers.find((item) => {
			const code = String(item.code || '').toLowerCase();
			const name = String(item.name || '').toLowerCase();
			return code === preferred || name === preferred || name.includes(preferred) || preferred.includes(code);
		});
		if (match?.code) return match.code;
	}
	return providers[0]?.code || '';
}

export function buildImageQualityOptions(config) {
	const providers = Array.isArray(config?.imageProviders)
		? config.imageProviders.filter((item) => item && item.enabled !== false && item.code)
		: [];
	const defaultProvider = resolveDefaultImageProvider(config) || providers[0]?.code || '';
	const estimate = Number(config?.images?.estimateCreditsPerAiPin);
	const aiCreditHint = Number.isFinite(estimate) ? estimate : 0;

	const providerOptions = providers.map((provider) => ({
		id: `provider:${provider.code}`,
		label: provider.name || provider.code,
		hint: `AI · ${provider.badge || provider.name || provider.code}`,
		imageMode: 'generate_ai',
		imageProvider: provider.code,
		creditHint: aiCreditHint,
	}));

	return [
		...providerOptions,
		{
			id: 'featured',
			label: 'Featured',
			hint: 'Article image',
			imageMode: 'use_featured',
			imageProvider: defaultProvider,
			creditHint: 0,
		},
	];
}

export function resolveDefaultImageQualityId(config, qualities) {
	const list = Array.isArray(qualities) ? qualities : buildImageQualityOptions(config);
	const preferred = resolveDefaultImageProvider(config);
	const qualitySetting = String(config?.images?.quality || '').toLowerCase();
	if (qualitySetting.includes('feature') || qualitySetting === 'budget') {
		const featured = list.find((item) => item.imageMode === 'use_featured');
		if (featured) return featured.id;
	}
	const match = list.find((item) => item.imageMode === 'generate_ai' && item.imageProvider === preferred);
	return match?.id || list[0]?.id || 'featured';
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
	const remaining = Number(credits.remaining) || 0;
	const ai = credits.ai && typeof credits.ai === 'object'
		? {
			used: Number(credits.ai.used) || 0,
			limit: Number(credits.ai.limit) || 0,
			remaining: Number(credits.ai.remaining ?? remaining) || 0,
		}
		: { used: Number(credits.used) || 0, limit: Number(credits.quota) || 0, remaining };
	const image = credits.image && typeof credits.image === 'object'
		? {
			used: Number(credits.image.used) || 0,
			limit: Number(credits.image.limit) || 0,
			remaining: Number(credits.image.remaining ?? remaining) || 0,
		}
		: { used: 0, limit: 0, remaining };
	return {
		plan: credits.planSlug || credits.plan || 'free',
		balance: Number(credits.balance) || remaining,
		quota: Number(credits.quota) || 0,
		used: Number(credits.used) || 0,
		remaining,
		ai,
		image,
	};
}

export function buildPinPromptFromConfig({ config, article, count, panel }) {
	const system = String(config?.prompts?.pinSystem || '').trim();
	const userSeed = String(config?.prompts?.pinUser || '').trim();
	const header = system || 'You are a Pinterest SEO expert for blog traffic growth.';
	const guidance = userSeed ? `Platform guidance: ${userSeed}\n` : '';

	return `${header}
${guidance}Return ONLY a valid JSON object in this exact shape:
{
  "pins": [
    {
      "title": "Pinterest SEO title",
      "description": "Pinterest description optimized for clicks",
      "overlayText": "short image overlay text",
      "suggestedKeywords": ["keyword1", "keyword2", "keyword3"],
      "suggestedHashtags": ["#tag1", "#tag2", "#tag3"],
      "imagePrompt": "detailed AI image prompt for a vertical Pinterest pin"
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

export function estimatePinCredits({ quality, count, articleFactor = 1 }) {
	const perPin = Number(quality?.creditHint);
	const rate = Number.isFinite(perPin) ? perPin : 0;
	return Number((rate * Math.max(1, count) * Math.max(1, articleFactor)).toFixed(2));
}
