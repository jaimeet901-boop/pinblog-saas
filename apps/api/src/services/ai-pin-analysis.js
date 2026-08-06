import logger from '../utils/logger.js';
import { DEFAULT_PLATFORM_SETTINGS } from './platform-settings.js';
import { generateTextWithRegistry } from './text-providers/index.js';
import {
	normalizeStudioPromptChannel,
	resolveChannelPromptPack,
} from './studio/prompt-packs.js';
import { PINTEREST_PROMPT_PACK_HINTS } from './studio/channel-defaults.js';

export const PIN_STYLES = Array.isArray(DEFAULT_PLATFORM_SETTINGS.content?.pinStyles)
	&& DEFAULT_PLATFORM_SETTINGS.content.pinStyles.length > 0
	? DEFAULT_PLATFORM_SETTINGS.content.pinStyles.map(String)
	: [];

function resolvePinStyle(style, fallback = '') {
	const requested = String(style || '').trim();
	if (requested && PIN_STYLES.includes(requested)) return requested;
	if (fallback && PIN_STYLES.includes(fallback)) return fallback;
	return PIN_STYLES[0] || requested || fallback || '';
}

function resolvePromptPack({ channel, promptPack, prompts } = {}) {
	if (promptPack && typeof promptPack === 'object') {
		return promptPack;
	}
	return resolveChannelPromptPack(prompts, channel);
}

function extractJsonObject(text) {
	if (!text || typeof text !== 'string') {
		return null;
	}
	const trimmed = text.trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf('{');
		const end = trimmed.lastIndexOf('}');
		if (start !== -1 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				return null;
			}
		}
	}
	return null;
}

function heuristicAnalysis(article, style = '', pack = null) {
	const selectedStyle = resolvePinStyle(style);
	const title = String(article.title || 'Untitled article').trim();
	const description = String(article.metaDescription || article.description || '').trim();
	const category = String(article.category || selectedStyle || 'General').trim();
	const words = `${title} ${description} ${category}`
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 3)
		.slice(0, 12);

	const unique = [...new Set(words)];
	const hashtags = unique.slice(0, 8).map((word) => `#${word}`);

	if (!pack || pack.channel === 'pinterest') {
		return {
			title: title.slice(0, 100),
			seoDescription: (description || `Discover ${title} — save this pin for later.`).slice(0, 500),
			cta: 'Save this pin for later',
			keywords: unique.slice(0, 10),
			hashtags,
			pinterestCategory: category || selectedStyle,
			targetAudience: `People interested in ${category || selectedStyle}`,
			style: selectedStyle,
			source: 'heuristic',
		};
	}

	const hints = pack.analyzeHints || {};
	const suffix = hints.heuristicDescriptionSuffix || '';
	const defaultCta = hints.defaultCta || 'Learn more';

	return {
		title: title.slice(0, 100),
		seoDescription: (description || `Discover ${title} ${suffix}`.trim()).slice(0, 500),
		cta: defaultCta,
		keywords: unique.slice(0, 10),
		hashtags,
		pinterestCategory: category || selectedStyle,
		targetAudience: `People interested in ${category || selectedStyle}`,
		style: selectedStyle,
		source: 'heuristic',
	};
}

async function analyzeWithTextRuntime({ article, style, pack }) {
	if (!pack || pack.channel === 'pinterest') {
		const prompt = `Analyze this blog article for Pinterest marketing.
Return ONLY valid JSON with keys:
title, seoDescription, cta, keywords (array), hashtags (array), pinterestCategory, targetAudience.
Style niche: ${style}
Article title: ${article.title || ''}
Meta description: ${article.metaDescription || article.description || ''}
URL: ${article.url || ''}
Category: ${article.category || ''}
Author: ${article.author || ''}`;

		const { text, provider } = await generateTextWithRegistry({
			systemPrompt: 'You are a Pinterest SEO strategist. Reply with JSON only.',
			messages: [{ role: 'user', content: prompt }],
			options: {
				temperature: 0.4,
				responseFormat: 'json',
			},
		});

		const parsed = extractJsonObject(text);
		if (!parsed) {
			throw new Error('Text runtime analysis returned invalid JSON');
		}

		return {
			title: String(parsed.title || article.title || '').slice(0, 100),
			seoDescription: String(parsed.seoDescription || parsed.description || '').slice(0, 500),
			cta: String(parsed.cta || 'Save this pin').slice(0, 120),
			keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 12) : [],
			hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).slice(0, 12) : [],
			pinterestCategory: String(parsed.pinterestCategory || article.category || style).slice(0, 120),
			targetAudience: String(parsed.targetAudience || '').slice(0, 200),
			style: resolvePinStyle(style),
			source: provider?.code || 'text-runtime',
		};
	}

	const hints = pack.analyzeHints || {};
	const network = hints.network || 'Facebook';
	const prompt = `Analyze this blog article for ${network} marketing.
Return ONLY valid JSON with keys:
title, seoDescription, cta, keywords (array), hashtags (array), pinterestCategory, targetAudience.
Style niche: ${style}
Article title: ${article.title || ''}
Meta description: ${article.metaDescription || article.description || ''}
URL: ${article.url || ''}
Category: ${article.category || ''}
Author: ${article.author || ''}`;

	const { text, provider } = await generateTextWithRegistry({
		systemPrompt: pack.analyzeSystem || 'You are a Facebook Page content strategist. Reply with JSON only.',
		messages: [{ role: 'user', content: prompt }],
		options: {
			temperature: 0.4,
			responseFormat: 'json',
		},
	});

	const parsed = extractJsonObject(text);
	if (!parsed) {
		throw new Error('Text runtime analysis returned invalid JSON');
	}

	const defaultCta = hints.defaultCta || 'Learn more';

	return {
		title: String(parsed.title || article.title || '').slice(0, 100),
		seoDescription: String(parsed.seoDescription || parsed.description || '').slice(0, 500),
		cta: String(parsed.cta || defaultCta).slice(0, 120),
		keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 12) : [],
		hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).slice(0, 12) : [],
		pinterestCategory: String(parsed.pinterestCategory || article.category || style).slice(0, 120),
		targetAudience: String(parsed.targetAudience || '').slice(0, 200),
		style: resolvePinStyle(style),
		source: provider?.code || 'text-runtime',
	};
}

export async function analyzeArticleForPin({
	owner,
	article,
	style = '',
	channel,
	promptPack,
	prompts,
} = {}) {
	const selectedStyle = resolvePinStyle(style);
	const pack = resolvePromptPack({
		channel: normalizeStudioPromptChannel(channel),
		promptPack,
		prompts,
	});

	try {
		return await analyzeWithTextRuntime({ article, style: selectedStyle, pack });
	} catch (error) {
		logger.warn('AI pin analysis text runtime failed; using heuristic fallback', {
			owner,
			channel: pack.channel,
			message: error?.message || null,
		});
	}

	return heuristicAnalysis(article, selectedStyle, pack);
}

function buildLegacyPinterestImagePromptBase({ selectedStyle, analysis, article }) {
	return [
		`Create a premium vertical Pinterest pin image (1000x1500, 2:3).`,
		`Niche style: ${selectedStyle}.`,
		`Subject: ${analysis?.title || article?.title || 'blog topic'}.`,
		analysis?.seoDescription ? `Context: ${analysis.seoDescription}` : '',
		analysis?.cta ? `Include subtle CTA mood: ${analysis.cta}` : '',
		`Clean composition, high contrast text-safe areas, mobile-first readability, no watermarks.`,
	].filter(Boolean).join(' ');
}

function buildChannelImagePromptBase({ pack, selectedStyle, analysis, article }) {
	if (!pack || pack.channel === 'pinterest') {
		return buildLegacyPinterestImagePromptBase({ selectedStyle, analysis, article });
	}

	const hints = pack.analyzeHints || PINTEREST_PROMPT_PACK_HINTS;
	return [
		`Create a premium ${hints.network || 'Facebook'} link-post image (${hints.imageDimensions || '1200x630'}, ${hints.aspect || '1.91:1'}).`,
		`Niche style: ${selectedStyle}.`,
		`Subject: ${analysis?.title || article?.title || 'blog topic'}.`,
		analysis?.seoDescription ? `Context: ${analysis.seoDescription}` : '',
		analysis?.cta ? `Include subtle CTA mood: ${analysis.cta}` : '',
		`Clean composition, high contrast text-safe areas, mobile-first readability, no watermarks.`,
	].filter(Boolean).join(' ');
}

export async function generateImagePromptForPin({
	owner,
	article,
	analysis,
	style = '',
	channel,
	promptPack,
	prompts,
} = {}) {
	const selectedStyle = resolvePinStyle(style, analysis?.style || '');
	const pack = resolvePromptPack({
		channel: normalizeStudioPromptChannel(channel),
		promptPack,
		prompts,
	});
	const base = buildChannelImagePromptBase({ pack, selectedStyle, analysis, article });

	const improvementSystemPrompt = pack.channel === 'facebook'
		? String(pack.imageSystem || '').trim() || 'You write optimized image-generation prompts. Reply with JSON { "imagePrompt": "..." } only.'
		: 'You write optimized image-generation prompts. Reply with JSON { "imagePrompt": "..." } only.';

	const improveLabel = pack.channel === 'facebook' ? 'Facebook link-post' : 'Pinterest';

	try {
		const { text, provider } = await generateTextWithRegistry({
			systemPrompt: improvementSystemPrompt,
			messages: [{
				role: 'user',
				content: `Improve this ${improveLabel} image prompt for style ${selectedStyle}:\n${base}`,
			}],
			options: {
				temperature: 0.6,
				responseFormat: 'json',
			},
		});
		const parsed = extractJsonObject(text);
		return {
			imagePrompt: String(parsed?.imagePrompt || base).slice(0, 4000),
			style: selectedStyle,
			source: provider?.code || 'text-runtime',
		};
	} catch (error) {
		logger.warn('Prompt generation fallback', {
			owner,
			channel: pack.channel,
			message: error?.message || null,
		});
		return {
			imagePrompt: base,
			style: selectedStyle,
			source: 'template',
		};
	}
}
