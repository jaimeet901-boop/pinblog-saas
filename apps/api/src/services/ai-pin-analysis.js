import { getDecryptedOpenAIKey } from './user-settings.js';
import logger from '../utils/logger.js';

const PIN_STYLES = [
	'Food',
	'Recipe',
	'Fitness',
	'Travel',
	'DIY',
	'Home',
	'Beauty',
	'Fashion',
	'Technology',
	'Business',
	'Lifestyle',
];

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

function heuristicAnalysis(article, style = 'Lifestyle') {
	const title = String(article.title || 'Untitled article').trim();
	const description = String(article.metaDescription || article.description || '').trim();
	const category = String(article.category || style || 'Lifestyle').trim();
	const words = `${title} ${description} ${category}`
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 3)
		.slice(0, 12);

	const unique = [...new Set(words)];
	const hashtags = unique.slice(0, 8).map((word) => `#${word}`);

	return {
		title: title.slice(0, 100),
		seoDescription: (description || `Discover ${title} — save this pin for later.`).slice(0, 500),
		cta: 'Save this pin for later',
		keywords: unique.slice(0, 10),
		hashtags,
		pinterestCategory: category || style,
		targetAudience: `People interested in ${category || style}`,
		style: PIN_STYLES.includes(style) ? style : 'Lifestyle',
		source: 'heuristic',
	};
}

async function analyzeWithOpenAI({ apiKey, article, style }) {
	const prompt = `Analyze this blog article for Pinterest marketing.
Return ONLY valid JSON with keys:
title, seoDescription, cta, keywords (array), hashtags (array), pinterestCategory, targetAudience.
Style niche: ${style}
Article title: ${article.title || ''}
Meta description: ${article.metaDescription || article.description || ''}
URL: ${article.url || ''}
Category: ${article.category || ''}
Author: ${article.author || ''}`;

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
			temperature: 0.4,
			messages: [
				{ role: 'system', content: 'You are a Pinterest SEO strategist. Reply with JSON only.' },
				{ role: 'user', content: prompt },
			],
			response_format: { type: 'json_object' },
		}),
	});

	if (!response.ok) {
		const details = await response.text().catch(() => 'OpenAI analysis failed');
		throw new Error(details || 'OpenAI analysis failed');
	}

	const payload = await response.json();
	const content = payload?.choices?.[0]?.message?.content || '';
	const parsed = extractJsonObject(content);
	if (!parsed) {
		throw new Error('OpenAI analysis returned invalid JSON');
	}

	return {
		title: String(parsed.title || article.title || '').slice(0, 100),
		seoDescription: String(parsed.seoDescription || parsed.description || '').slice(0, 500),
		cta: String(parsed.cta || 'Save this pin').slice(0, 120),
		keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 12) : [],
		hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).slice(0, 12) : [],
		pinterestCategory: String(parsed.pinterestCategory || article.category || style).slice(0, 120),
		targetAudience: String(parsed.targetAudience || '').slice(0, 200),
		style: PIN_STYLES.includes(style) ? style : 'Lifestyle',
		source: 'openai',
	};
}

export async function analyzeArticleForPin({ owner, article, style = 'Lifestyle' }) {
	const selectedStyle = PIN_STYLES.includes(style) ? style : 'Lifestyle';
	const apiKey = await getDecryptedOpenAIKey(owner).catch(() => '');

	if (apiKey) {
		try {
			return await analyzeWithOpenAI({ apiKey, article, style: selectedStyle });
		} catch (error) {
			logger.warn('AI pin analysis OpenAI failed; using heuristic fallback', {
				owner,
				message: error?.message || null,
			});
		}
	}

	return heuristicAnalysis(article, selectedStyle);
}

export async function generateImagePromptForPin({ owner, article, analysis, style = 'Lifestyle' }) {
	const selectedStyle = PIN_STYLES.includes(style) ? style : (analysis?.style || 'Lifestyle');
	const base = [
		`Create a premium vertical Pinterest pin image (1000x1500, 2:3).`,
		`Niche style: ${selectedStyle}.`,
		`Subject: ${analysis?.title || article?.title || 'blog topic'}.`,
		analysis?.seoDescription ? `Context: ${analysis.seoDescription}` : '',
		analysis?.cta ? `Include subtle CTA mood: ${analysis.cta}` : '',
		`Clean composition, high contrast text-safe areas, mobile-first readability, no watermarks.`,
	].filter(Boolean).join(' ');

	const apiKey = await getDecryptedOpenAIKey(owner).catch(() => '');
	if (!apiKey) {
		return {
			imagePrompt: base,
			style: selectedStyle,
			source: 'template',
		};
	}

	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
				temperature: 0.6,
				messages: [
					{ role: 'system', content: 'You write optimized image-generation prompts. Reply with JSON { "imagePrompt": "..." } only.' },
					{ role: 'user', content: `Improve this Pinterest image prompt for style ${selectedStyle}:\n${base}` },
				],
				response_format: { type: 'json_object' },
			}),
		});
		if (!response.ok) {
			throw new Error('Prompt generation failed');
		}
		const payload = await response.json();
		const parsed = extractJsonObject(payload?.choices?.[0]?.message?.content || '');
		return {
			imagePrompt: String(parsed?.imagePrompt || base).slice(0, 4000),
			style: selectedStyle,
			source: 'openai',
		};
	} catch (error) {
		logger.warn('Prompt generation fallback', { message: error?.message || null });
		return {
			imagePrompt: base,
			style: selectedStyle,
			source: 'template',
		};
	}
}

export { PIN_STYLES };
