/**
 * OpenAI Chat Completions text adapter (Admin platform key via Text Runtime).
 */

import logger from '../../utils/logger.js';
import { estimateTokenCount } from './contract.js';
import { normalizeProviderCapabilities, capabilitiesToFlags } from './capabilities.js';

function joinUrl(base, path) {
	const normalizedBase = String(base || 'https://api.openai.com/v1').replace(/\/+$/, '');
	const normalizedPath = String(path || '').replace(/^\/+/, '');
	return `${normalizedBase}/${normalizedPath}`;
}

function toOpenAiMessages(systemPrompt, messages) {
	/** @type {Array<{ role: string, content: string | Array<object> }>} */
	const out = [];
	const system = String(systemPrompt || '').trim();
	if (system) {
		out.push({ role: 'system', content: system });
	}

	for (const message of Array.isArray(messages) ? messages : []) {
		const roleRaw = String(message?.role || 'user').toLowerCase();
		const role = roleRaw === 'assistant' || roleRaw === 'model'
			? 'assistant'
			: roleRaw === 'system'
				? 'system'
				: 'user';

		const text = String(message?.content || '');
		const images = Array.isArray(message?.images) ? message.images.filter(Boolean).slice(0, 4) : [];

		if (images.length === 0) {
			if (!text.trim() && role !== 'assistant') continue;
			out.push({ role, content: text });
			continue;
		}

		/** @type {Array<object>} */
		const parts = [];
		if (text.trim()) {
			parts.push({ type: 'text', text });
		}
		for (const imageUrl of images) {
			parts.push({
				type: 'image_url',
				image_url: { url: String(imageUrl) },
			});
		}
		out.push({ role, content: parts });
	}

	return out;
}

function buildRequestBody({ runtime, systemPrompt, messages, stream, options }) {
	const model = String(runtime.model || '').trim();
	if (!model) {
		const error = new Error('OpenAI adapter requires a model id from Admin AI Models.');
		error.status = 400;
		error.errorCode = 'AI_TEXT_MODEL_MISSING';
		throw error;
	}

	const body = {
		model,
		messages: toOpenAiMessages(systemPrompt, messages),
		temperature: Number(options?.temperature) >= 0 ? Number(options.temperature) : 0.7,
		stream: Boolean(stream),
	};

	if (options?.responseFormat === 'json' || options?.json) {
		body.response_format = { type: 'json_object' };
	}
	if (Number(options?.maxTokens) > 0) {
		body.max_tokens = Number(options.maxTokens);
	}

	return body;
}

async function postChatCompletions({ runtime, body, options }) {
	const baseUrl = runtime.baseUrl || 'https://api.openai.com/v1';
	const timeoutMs = Number(options?.timeoutMs) > 0
		? Number(options.timeoutMs)
		: (Number(runtime.timeoutMs) || 60000);
	const url = joinUrl(baseUrl, 'chat/completions');

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${runtime.apiKey}`,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch (error) {
		clearTimeout(timer);
		if (error?.name === 'AbortError') {
			const timeoutError = new Error(`OpenAI request timed out after ${timeoutMs}ms`);
			timeoutError.status = 504;
			throw timeoutError;
		}
		throw error;
	}

	return { response, timer, timeoutMs };
}

export const meta = {
	code: 'openai',
	name: 'OpenAI',
	capabilities: capabilitiesToFlags(normalizeProviderCapabilities('openai')),
	capabilitiesDetailed: normalizeProviderCapabilities('openai'),
	implemented: true,
};

/**
 * @param {{
 *   runtime: import('./index.js').TextProviderRuntime,
 *   systemPrompt: string,
 *   messages: import('./index.js').ChatMessage[],
 *   options?: object,
 * }} params
 */
export async function* streamText({ runtime, systemPrompt, messages, options }) {
	const body = buildRequestBody({ runtime, systemPrompt, messages, stream: true, options });

	logger.info('[openai-adapter] Calling Chat Completions (stream)', {
		model: body.model,
		modelSource: runtime.modelSource || 'unknown',
	});

	const { response, timer } = await postChatCompletions({ runtime, body, options });

	if (!response.ok) {
		clearTimeout(timer);
		const details = await response.text().catch(() => '');
		const error = new Error(
			`OpenAI request failed (${response.status}): ${details.slice(0, 500) || response.statusText}`,
		);
		error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
		throw error;
	}

	if (!response.body) {
		clearTimeout(timer);
		const error = new Error('OpenAI returned an empty response body');
		error.status = 502;
		throw error;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line.startsWith('data:')) continue;
				const data = line.slice(5).trim();
				if (!data || data === '[DONE]') continue;

				let payload;
				try {
					payload = JSON.parse(data);
				} catch {
					continue;
				}

				if (payload?.error?.message) {
					const error = new Error(`OpenAI error: ${payload.error.message}`);
					error.status = Number(payload.error.code) || 502;
					throw error;
				}

				const delta = payload?.choices?.[0]?.delta?.content;
				if (typeof delta === 'string' && delta) {
					yield { type: 'content', text: delta };
				}
			}
		}
	} finally {
		clearTimeout(timer);
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}
}

/**
 * Non-streaming generateText.
 */
export async function generateText({ runtime, systemPrompt, messages, options }) {
	const body = buildRequestBody({ runtime, systemPrompt, messages, stream: false, options });

	logger.info('[openai-adapter] Calling Chat Completions', {
		model: body.model,
		modelSource: runtime.modelSource || 'unknown',
	});

	const { response, timer } = await postChatCompletions({ runtime, body, options });
	clearTimeout(timer);

	if (!response.ok) {
		const details = await response.text().catch(() => '');
		const error = new Error(
			`OpenAI request failed (${response.status}): ${details.slice(0, 500) || response.statusText}`,
		);
		error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
		throw error;
	}

	const payload = await response.json();
	const text = String(payload?.choices?.[0]?.message?.content || '');
	return {
		text,
		usage: payload?.usage || null,
	};
}

export function countTokens({ text }) {
	return estimateTokenCount(text);
}

export async function validate({ runtime }) {
	if (!runtime?.apiKey) {
		return { ok: false, message: 'OpenAI API key missing' };
	}
	if (!String(runtime.model || '').trim()) {
		return { ok: false, message: 'OpenAI model missing' };
	}
	return { ok: true };
}

export async function healthCheck({ runtime }) {
	const started = Date.now();
	const result = await validate({ runtime });
	if (!result.ok) {
		return { ...result, latencyMs: Date.now() - started };
	}

	try {
		const baseUrl = runtime.baseUrl || 'https://api.openai.com/v1';
		const url = joinUrl(baseUrl, 'models');
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), Math.min(10000, Number(runtime.timeoutMs) || 10000));
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${runtime.apiKey}` },
			signal: controller.signal,
		});
		clearTimeout(timer);
		return {
			ok: response.ok,
			latencyMs: Date.now() - started,
			message: response.ok ? 'ok' : `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			ok: false,
			latencyMs: Date.now() - started,
			message: error?.message || 'health check failed',
		};
	}
}
