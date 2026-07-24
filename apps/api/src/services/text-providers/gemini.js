/**
 * Google Gemini text adapter — direct Generative Language API (no external Integrated AI proxy).
 * Uses Admin Provider Registry credentials (ai_providers + ai_provider_secrets).
 */

import logger from '../../utils/logger.js';
import { normalizeGeminiModelId } from './gemini-models.js';

function joinUrl(base, path) {
	const normalizedBase = String(base || '').replace(/\/+$/, '');
	const normalizedPath = String(path || '').replace(/^\/+/, '');
	return `${normalizedBase}/${normalizedPath}`;
}

function mapRole(role) {
	const normalized = String(role || '').toLowerCase();
	if (normalized === 'assistant' || normalized === 'model') return 'model';
	return 'user';
}

/**
 * @param {{ mimeType?: string, bytes: Buffer }} image
 */
function toInlinePart(image) {
	return {
		inline_data: {
			mime_type: image.mimeType || 'image/jpeg',
			data: image.bytes.toString('base64'),
		},
	};
}

async function fetchImageAsInlinePart(url, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), Math.min(15000, timeoutMs || 15000));
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) return null;
		const mimeType = response.headers.get('content-type') || 'image/jpeg';
		if (!String(mimeType).startsWith('image/')) return null;
		const buffer = Buffer.from(await response.arrayBuffer());
		if (!buffer.length || buffer.length > 15 * 1024 * 1024) return null;
		return toInlinePart({ mimeType: mimeType.split(';')[0].trim(), bytes: buffer });
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * @param {import('./index.js').ChatMessage[]} messages
 * @param {number} timeoutMs
 */
async function buildGeminiContents(messages, timeoutMs) {
	/** @type {Array<{ role: string, parts: object[] }>} */
	const contents = [];

	for (const message of messages) {
		const role = mapRole(message.role);
		if (role === 'model' && message.role === 'tool') {
			continue;
		}

		/** @type {object[]} */
		const parts = [];
		const text = String(message.content || '').trim();
		if (text) {
			parts.push({ text });
		}

		const images = Array.isArray(message.images) ? message.images : [];
		for (const imageUrl of images.slice(0, 4)) {
			const url = String(imageUrl || '').trim();
			if (!url) continue;
			const inline = await fetchImageAsInlinePart(url, timeoutMs);
			if (inline) {
				parts.push(inline);
			} else {
				parts.push({ text: `[image] ${url}` });
			}
		}

		if (parts.length === 0) continue;

		const previous = contents[contents.length - 1];
		if (previous && previous.role === role) {
			previous.parts.push(...parts);
		} else {
			contents.push({ role, parts });
		}
	}

	// Gemini requires the last turn to be from the user for generateContent.
	if (contents.length > 0 && contents[contents.length - 1].role !== 'user') {
		contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });
	}

	return contents;
}

function extractTextFromSsePayload(payload) {
	const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
	let text = '';
	for (const candidate of candidates) {
		const parts = candidate?.content?.parts;
		if (!Array.isArray(parts)) continue;
		for (const part of parts) {
			if (typeof part?.text === 'string' && part.text) {
				text += part.text;
			}
		}
	}
	return text;
}

/**
 * Stream Gemini tokens as { type: 'content', text } chunks.
 *
 * @param {{
 *   runtime: import('./index.js').TextProviderRuntime,
 *   systemPrompt: string,
 *   messages: import('./index.js').ChatMessage[],
 * }} params
 */
export async function* streamText({ runtime, systemPrompt, messages }) {
	const baseUrl = runtime.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
	const model = normalizeGeminiModelId(runtime.model);
	if (!model) {
		const error = new Error('Gemini adapter requires a model id from Admin AI Models.');
		error.status = 400;
		error.errorCode = 'AI_TEXT_MODEL_MISSING';
		throw error;
	}

	const timeoutMs = Number(runtime.timeoutMs) || 60000;
	const contents = await buildGeminiContents(messages, timeoutMs);

	if (contents.length === 0) {
		const error = new Error('No user content to send to Gemini.');
		error.status = 422;
		throw error;
	}

	logger.info('[gemini-adapter] Calling Generative Language API', {
		model,
		modelSource: runtime.modelSource || 'unknown',
		endpoint: 'streamGenerateContent',
		baseUrl,
	});

	const url = `${joinUrl(baseUrl, `models/${encodeURIComponent(model)}:streamGenerateContent`)}?alt=sse`;
	const body = {
		contents,
		generationConfig: {
			temperature: 0.7,
		},
	};

	const system = String(systemPrompt || '').trim();
	if (system) {
		body.system_instruction = {
			parts: [{ text: system }],
		};
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
				'x-goog-api-key': runtime.apiKey,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch (error) {
		clearTimeout(timer);
		if (error?.name === 'AbortError') {
			const timeoutError = new Error(`Gemini request timed out after ${timeoutMs}ms`);
			timeoutError.status = 504;
			throw timeoutError;
		}
		throw error;
	}

	if (!response.ok) {
		clearTimeout(timer);
		const details = await response.text().catch(() => '');
		const error = new Error(
			`Gemini request failed (${response.status}): ${details.slice(0, 500) || response.statusText}`,
		);
		error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
		throw error;
	}

	if (!response.body) {
		clearTimeout(timer);
		const error = new Error('Gemini returned an empty response body');
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
					const error = new Error(`Gemini error: ${payload.error.message}`);
					error.status = Number(payload.error.code) || 502;
					throw error;
				}

				const text = extractTextFromSsePayload(payload);
				if (text) {
					yield { type: 'content', text };
				}
			}
		}

		const trailing = buffer.trim();
		if (trailing.startsWith('data:')) {
			const data = trailing.slice(5).trim();
			if (data && data !== '[DONE]') {
				try {
					const payload = JSON.parse(data);
					const text = extractTextFromSsePayload(payload);
					if (text) yield { type: 'content', text };
				} catch {
					// ignore trailing partial JSON
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
