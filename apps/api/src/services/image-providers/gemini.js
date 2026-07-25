/**
 * Google Gemini image adapter — Generative Language API (generateContent + IMAGE modality).
 * Uses the same Admin Provider Registry credentials as Gemini text (`code: gemini`).
 *
 * Model IDs are never chosen here — Provider Registry resolves them from Admin AI Models.
 */

import logger from '../../utils/logger.js';
import { normalizeGeminiModelId } from '../text-providers/gemini-models.js';

function joinUrl(base, path) {
	const normalizedBase = String(base || '').replace(/\/+$/, '');
	const normalizedPath = String(path || '').replace(/^\/+/, '');
	return `${normalizedBase}/${normalizedPath}`;
}

function extractGoogleErrorMessage(payload, fallback) {
	if (!payload || typeof payload !== 'object') return fallback;
	const err = payload.error;
	if (!err) return fallback;
	const parts = [
		err.message,
		err.status,
		Array.isArray(err.details)
			? err.details.map((item) => item?.reason || item?.message || '').filter(Boolean).join('; ')
			: '',
	].filter(Boolean);
	return parts.join(' — ') || fallback;
}

function extractInlineImage(payload) {
	const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
	for (const candidate of candidates) {
		const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
		for (const part of parts) {
			const inline = part?.inlineData || part?.inline_data;
			if (inline?.data) {
				return {
					bytes: Buffer.from(inline.data, 'base64'),
					contentType: inline.mimeType || inline.mime_type || 'image/png',
				};
			}
		}
	}
	return null;
}

/**
 * @param {{
 *   apiKey: string,
 *   prompt: string,
 *   count?: number,
 *   model: string,
 *   modelSource?: string,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 *   aspectRatio?: string,
 * }} params
 * @returns {Promise<Array<{ bytes: Buffer, contentType: string, provider: string, model: string }>>}
 */
export async function generateWithGemini({
	apiKey,
	prompt,
	count = 1,
	model,
	modelSource = 'unknown',
	baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
	timeoutMs = 90000,
	aspectRatio = '2:3',
}) {
	if (!apiKey) {
		throw new Error('Google Gemini API key is not configured');
	}

	const modelId = normalizeGeminiModelId(model);
	if (!modelId) {
		const error = new Error('Gemini image adapter requires a model id from Admin AI Models.');
		error.status = 400;
		error.errorCode = 'AI_IMAGE_MODEL_MISSING';
		throw error;
	}

	const images = [];

	for (let index = 0; index < count; index += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const url = joinUrl(baseUrl, `models/${encodeURIComponent(modelId)}:generateContent`);

		logger.info('[gemini-image-adapter] Calling Generative Language API', {
			model: modelId,
			modelSource,
			aspectRatio,
			attempt: index + 1,
			of: count,
		});

		let response;
		try {
			response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-goog-api-key': apiKey,
				},
				signal: controller.signal,
				body: JSON.stringify({
					contents: [
						{
							role: 'user',
							parts: [{ text: String(prompt || '').trim() }],
						},
					],
					generationConfig: {
						responseModalities: ['TEXT', 'IMAGE'],
						imageConfig: {
							aspectRatio: aspectRatio || '2:3',
						},
					},
				}),
			});
		} catch (error) {
			clearTimeout(timer);
			if (error?.name === 'AbortError') {
				throw new Error(`Gemini image request timed out after ${timeoutMs}ms (model ${modelId})`);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}

		const rawText = await response.text().catch(() => '');
		let payload = null;
		try {
			payload = rawText ? JSON.parse(rawText) : null;
		} catch {
			payload = null;
		}

		if (!response.ok) {
			const googleMessage = extractGoogleErrorMessage(
				payload,
				rawText || `Gemini image request failed (${response.status})`,
			);
			const error = new Error(`Gemini image request failed (${response.status}): ${googleMessage}`);
			error.status = response.status;
			error.provider = 'gemini';
			error.model = modelId;
			error.details = payload?.error || rawText;
			throw error;
		}

		const inline = extractInlineImage(payload);
		if (!inline?.bytes?.length) {
			const blockReason = payload?.candidates?.[0]?.finishReason
				|| payload?.promptFeedback?.blockReason
				|| '';
			const error = new Error(
				blockReason
					? `Gemini image generation returned no image (${blockReason})`
					: 'Gemini image generation returned no image data',
			);
			error.status = 502;
			error.provider = 'gemini';
			error.model = modelId;
			error.details = payload;
			throw error;
		}

		images.push({
			bytes: inline.bytes,
			contentType: inline.contentType,
			provider: 'gemini',
			model: modelId,
		});
	}

	return images;
}
