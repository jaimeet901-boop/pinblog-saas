/**
 * Pure token / cost estimate helpers (no I/O).
 */

import { estimateTokenCount } from './contract.js';

/** Rough USD per 1K tokens (prompt / completion) for cost estimates only. */
const COST_PER_1K = {
	openai: { prompt: 0.00015, completion: 0.0006 },
	gemini: { prompt: 0.0001, completion: 0.0004 },
	claude: { prompt: 0.003, completion: 0.015 },
	openrouter: { prompt: 0.0002, completion: 0.0008 },
	deepseek: { prompt: 0.00014, completion: 0.00028 },
	default: { prompt: 0.0002, completion: 0.0008 },
};

export function estimateTokenUsage({ systemPrompt = '', messages = [], outputText = '', usage = null }) {
	if (usage && (usage.prompt_tokens != null || usage.completion_tokens != null)) {
		return {
			prompt: Number(usage.prompt_tokens) || 0,
			completion: Number(usage.completion_tokens) || 0,
			total: Number(usage.total_tokens)
				|| ((Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0)),
			source: 'provider',
		};
	}

	const inputParts = [
		String(systemPrompt || ''),
		...(Array.isArray(messages) ? messages.map((item) => String(item?.content || '')) : []),
	];
	const prompt = estimateTokenCount(inputParts.join('\n'));
	const completion = estimateTokenCount(outputText);
	return {
		prompt,
		completion,
		total: prompt + completion,
		source: 'estimate',
	};
}

export function estimateRequestCostUsd(providerCode, tokens) {
	const rates = COST_PER_1K[String(providerCode || '').toLowerCase()] || COST_PER_1K.default;
	const prompt = Number(tokens?.prompt) || 0;
	const completion = Number(tokens?.completion) || 0;
	const usd = (prompt / 1000) * rates.prompt + (completion / 1000) * rates.completion;
	return Number(usd.toFixed(8));
}
