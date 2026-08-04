/**
 * Structured AI runtime request logging.
 */

import logger from '../../utils/logger.js';
import { estimateRequestCostUsd } from './cost.js';
import { recordRuntimeRequestOutcome } from './health-state.js';

export { estimateRequestCostUsd, estimateTokenUsage } from './cost.js';

/**
 * Log one AI runtime attempt and update in-memory health/usage.
 *
 * @param {{
 *   provider: string,
 *   model: string,
 *   latencyMs: number,
 *   success: boolean,
 *   tokens?: { prompt?: number, completion?: number, total?: number, source?: string },
 *   costEstimate?: number,
 *   fallbackReason?: string|null,
 *   requestType?: string,
 *   errorMessage?: string|null,
 * }} entry
 */
export function logAiRuntimeRequest(entry) {
	const provider = String(entry.provider || '').toLowerCase();
	const tokens = entry.tokens || { prompt: 0, completion: 0, total: 0, source: 'none' };
	const costEstimate = entry.costEstimate != null
		? Number(entry.costEstimate)
		: estimateRequestCostUsd(provider, tokens);
	const success = Boolean(entry.success);
	const fallbackReason = entry.fallbackReason ? String(entry.fallbackReason) : null;

	const payload = {
		provider,
		model: String(entry.model || ''),
		latencyMs: Number(entry.latencyMs) || 0,
		tokens,
		costEstimate,
		success,
		failure: !success,
		fallbackReason,
		requestType: entry.requestType || 'text',
		errorMessage: entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null,
	};

	if (success) {
		logger.info('[ai-runtime-request]', payload);
	} else {
		logger.warn('[ai-runtime-request]', payload);
	}

	recordRuntimeRequestOutcome(provider, {
		ok: success,
		latencyMs: payload.latencyMs,
		errorMessage: payload.errorMessage || undefined,
		tokensPrompt: tokens.prompt || 0,
		tokensCompletion: tokens.completion || 0,
		estimatedCostUsd: costEstimate,
		fallback: Boolean(fallbackReason),
	});

	return payload;
}
