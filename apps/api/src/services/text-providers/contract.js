/**
 * Universal Text Provider Adapter contract.
 *
 * Every text adapter MUST export:
 *   - streamText({ runtime, systemPrompt, messages, options? }) → AsyncGenerator<{ type:'content', text:string }>
 *   - generateText({ runtime, systemPrompt, messages, options? }) → Promise<{ text:string, usage? }>
 *   - countTokens({ text, runtime? }) → Promise<number> | number  (estimate OK)
 *   - validate({ runtime }) → Promise<{ ok:boolean, message?:string }>
 *   - healthCheck({ runtime }) → Promise<{ ok:boolean, latencyMs?:number, message?:string }>
 *   - meta → { code, name, capabilities, capabilitiesDetailed, implemented }
 */

import {
	capabilitiesToFlags,
	normalizeProviderCapabilities,
} from './capabilities.js';

export function estimateTokenCount(text) {
	const value = String(text || '');
	if (!value) return 0;
	return Math.max(1, Math.ceil(value.length / 4));
}

/**
 * Errors that should trigger failover to the next provider.
 * Config/auth problems on one provider may still allow another to succeed.
 */
export function isFailoverableTextError(error) {
	if (!error) return false;
	if (error.name === 'AbortError') return true;
	if (error.errorCode === 'AI_TEXT_ADAPTER_UNAVAILABLE') return true;
	if (error.errorCode === 'AI_TEXT_ADAPTER_NOT_IMPLEMENTED') return true;
	if (error.errorCode === 'AI_TEXT_MODEL_MISSING') return true;
	if (error.errorCode === 'AI_TEXT_PROVIDER_KEY_MISSING') return true;

	const status = Number(error.status || error.statusCode || 0);
	if (status === 408 || status === 429) return true;
	if (status >= 500 && status <= 599) return true;

	const message = String(error.message || '').toLowerCase();
	if (!message) return status === 0;
	if (message.includes('timed out') || message.includes('timeout')) return true;
	if (message.includes('rate limit') || message.includes('too many requests')) return true;
	if (message.includes('econnreset') || message.includes('fetch failed') || message.includes('network')) return true;
	if (message.includes('socket') || message.includes('unavailable') || message.includes('overloaded')) return true;
	if (status === 401 || status === 403) return true;
	return status === 0 && Boolean(error.message);
}

export function createNotImplementedAdapter(meta) {
	const code = String(meta?.code || 'unknown');
	const name = String(meta?.name || code);

	function notImplemented(method) {
		const error = new Error(
			`Text adapter "${name}" (${code}) is not implemented yet (${method}).`,
		);
		error.status = 503;
		error.errorCode = 'AI_TEXT_ADAPTER_NOT_IMPLEMENTED';
		return error;
	}

	const capabilitiesDetailed = normalizeProviderCapabilities(code, meta?.capabilities ?? null);
	const capabilityFlags = Array.isArray(meta?.capabilities)
		&& meta.capabilities.every((item) => typeof item === 'string')
		? [...new Set(meta.capabilities.map(String))]
		: capabilitiesToFlags(capabilitiesDetailed);

	return {
		meta: {
			code,
			name,
			capabilities: capabilityFlags,
			capabilitiesDetailed,
			implemented: false,
		},
		/* eslint-disable-next-line require-yield -- not-implemented adapter */
		async *streamText() {
			throw notImplemented('streamText');
		},
		async generateText() {
			throw notImplemented('generateText');
		},
		countTokens({ text }) {
			return estimateTokenCount(text);
		},
		async validate() {
			return { ok: false, message: `${name} adapter is a placeholder` };
		},
		async healthCheck() {
			return { ok: false, message: `${name} adapter is a placeholder` };
		},
	};
}
