/**
 * Fal provider adapter for Writer Image Resolver (M2-A).
 *
 * Reuses generateWithFal from image-providers/fal.js without modifying it.
 * Does not use AI Pins queue or job records.
 *
 * Download SSRF/size limits inside fal.js are unchanged (global fix deferred).
 * Adapter-side: prompt caps, outer timeout, post-bytes size/MIME checks.
 */

import { evaluateAssetAcceptability } from '../acceptability.js';
import {
	ASSET_SOURCE,
	ASSET_STATUS,
	DEFAULT_FAL_TIMEOUT_MS,
	MAX_FAL_IMAGE_BYTES,
	WRITER_BLOG_GENERATION_TARGET,
	emptyAsset,
} from '../types.js';

const MAX_PROMPT_CHARS = 2500;

function trimStr(value) {
	return String(value || '').trim();
}

/**
 * Build a Fal prompt from a planner slot (WHAT → HOW).
 * Prefer query; enrich lightly with concept; never invent unrelated subjects.
 */
export function buildFalPromptFromSlot(slot = {}) {
	const query = trimStr(slot.query);
	const concept = trimStr(slot.concept);
	const altHint = trimStr(slot.altHint);

	const primary = query || concept || altHint;
	if (!primary) {
		return '';
	}

	const parts = [primary];
	if (concept && query && !query.toLowerCase().includes(concept.toLowerCase().slice(0, 24))) {
		parts.push(`visual focus: ${concept}`);
	}
	parts.push('high quality blog photograph, natural lighting, no text overlay, no watermark');

	return parts.join('. ').slice(0, MAX_PROMPT_CHARS);
}

function withTimeout(promise, ms, label) {
	const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_FAL_TIMEOUT_MS;
	let timer;
	return Promise.race([
		Promise.resolve(promise).finally(() => {
			if (timer) clearTimeout(timer);
		}),
		new Promise((_, reject) => {
			timer = setTimeout(() => {
				const error = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
				error.errorCode = 'FAL_TIMEOUT';
				reject(error);
			}, timeoutMs);
		}),
	]);
}

function bytesToDataUrl(bytes, contentType) {
	const mime = IMAGE_SAFE_TYPE(contentType);
	const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
	return `data:${mime};base64,${buf.toString('base64')}`;
}

function IMAGE_SAFE_TYPE(contentType) {
	const raw = trimStr(contentType).toLowerCase() || 'image/png';
	if (/^image\/(png|jpeg|jpg|webp|gif)$/i.test(raw)) {
		return raw === 'image/jpg' ? 'image/jpeg' : raw;
	}
	return '';
}

/**
 * Normalize Fal generateWithFal output into a ResolverAsset.
 * @param {object} slot
 * @param {{ bytes: Buffer, contentType?: string, provider?: string, model?: string }} generated
 * @param {{ width?: number, height?: number, prompt?: string }} meta
 */
export function normalizeFalGeneratedAsset(slot, generated, meta = {}) {
	const slotId = trimStr(slot?.id || slot?.slotId);
	const bytes = generated?.bytes;
	const byteLength = Buffer.isBuffer(bytes) ? bytes.length : 0;
	const contentType = IMAGE_SAFE_TYPE(generated?.contentType);

	if (!slotId) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.FAL,
			slotId: '',
			errorCode: 'INVALID_SLOT',
			errorMessage: 'slot id missing',
		});
	}

	if (!byteLength || !contentType) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.FAL,
			slotId,
			alt: trimStr(slot?.altHint || slot?.concept),
			errorCode: 'INVALID_FAL_RESPONSE',
			errorMessage: 'Fal returned no usable image bytes',
			providerMeta: { byteLength, contentType: generated?.contentType || '' },
		});
	}

	if (byteLength > MAX_FAL_IMAGE_BYTES) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.FAL,
			slotId,
			errorCode: 'IMAGE_TOO_LARGE',
			errorMessage: 'Generated image exceeds size limit',
			providerMeta: { byteLength, contentType },
		});
	}

	const width = Number(meta.width) || WRITER_BLOG_GENERATION_TARGET.targetWidth;
	const height = Number(meta.height) || WRITER_BLOG_GENERATION_TARGET.targetHeight;
	const url = bytesToDataUrl(bytes, contentType);

	const asset = emptyAsset({
		status: ASSET_STATUS.RESOLVED,
		source: ASSET_SOURCE.FAL,
		slotId,
		url,
		width,
		height,
		alt: trimStr(slot?.altHint || slot?.concept || slot?.query),
		attribution: 'Generated with Fal.ai',
		license: 'generated',
		confidence: 1,
		providerMeta: {
			provider: generated?.provider || 'fal',
			model: generated?.model || '',
			contentType,
			byteLength,
			hasBytes: true,
			prompt: trimStr(meta.prompt).slice(0, 500),
			generationTarget: {
				width: WRITER_BLOG_GENERATION_TARGET.falImageSize.width,
				height: WRITER_BLOG_GENERATION_TARGET.falImageSize.height,
			},
			/** Raw bytes for later WP/upload milestones (tests may omit). */
			bytes,
		},
	});

	const check = evaluateAssetAcceptability(asset);
	if (!check.ok) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.FAL,
			slotId,
			errorCode: 'ASSET_UNACCEPTABLE',
			errorMessage: check.reasons.join('; '),
			providerMeta: { reasons: check.reasons },
		});
	}

	return asset;
}

/**
 * Resolve one planner slot via Fal.
 *
 * @param {object} slot — planner imageSlots[] item
 * @param {{
 *   apiKey?: string,
 *   timeoutMs?: number,
 *   model?: string,
 *   generateWithFal?: Function,
 * }} [context]
 * @returns {Promise<import('../types.js').ResolverAsset>}
 */
export async function resolveFalSlot(slot, context = {}) {
	const slotId = trimStr(slot?.id || slot?.slotId);
	if (!slotId) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.FAL,
			errorCode: 'INVALID_SLOT',
			errorMessage: 'slot id missing',
		});
	}

	const prompt = buildFalPromptFromSlot(slot);
	if (!prompt) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.FAL,
			slotId,
			errorCode: 'EMPTY_PROMPT',
			errorMessage: 'slot has no query/concept for Fal',
		});
	}

	const apiKey = trimStr(context.apiKey);
	if (!apiKey) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.FAL,
			slotId,
			errorCode: 'FAL_API_KEY_MISSING',
			errorMessage: 'Fal API key is not configured',
		});
	}

	const generate = typeof context.generateWithFal === 'function'
		? context.generateWithFal
		: async (params) => {
			const mod = await import('../../image-providers/fal.js');
			return mod.generateWithFal(params);
		};

	try {
		const images = await withTimeout(
			generate({
				apiKey,
				prompt,
				count: 1,
				model: context.model,
				generationTarget: WRITER_BLOG_GENERATION_TARGET,
			}),
			context.timeoutMs || DEFAULT_FAL_TIMEOUT_MS,
			`Fal resolve ${slotId}`,
		);

		const generated = Array.isArray(images) ? images[0] : null;
		if (!generated?.bytes) {
			return emptyAsset({
				status: ASSET_STATUS.FAILED,
				source: ASSET_SOURCE.FAL,
				slotId,
				errorCode: 'INVALID_FAL_RESPONSE',
				errorMessage: 'Fal returned no image',
			});
		}

		return normalizeFalGeneratedAsset(slot, generated, {
			prompt,
			width: WRITER_BLOG_GENERATION_TARGET.targetWidth,
			height: WRITER_BLOG_GENERATION_TARGET.targetHeight,
		});
	} catch (error) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.FAL,
			slotId,
			alt: trimStr(slot?.altHint || slot?.concept),
			errorCode: error?.errorCode || 'FAL_GENERATE_FAILED',
			errorMessage: trimStr(error?.message).slice(0, 300) || 'Fal generation failed',
			providerMeta: { thrown: true },
		});
	}
}
