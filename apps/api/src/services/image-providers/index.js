import { IMAGE_ADAPTER_LOADERS, listImplementedImageAdapters, resolveImageAdapterCode } from './adapters.js';

export const PINTEREST_IMAGE_SIZE = '1024x1536'; // closest OpenAI portrait; target 1000x1500
export const SUPPORTED_IMAGE_COUNTS = [1, 3, 5];

export function normalizeImageCount(value) {
	const count = Number.parseInt(String(value ?? '1'), 10);
	if (SUPPORTED_IMAGE_COUNTS.includes(count)) {
		return count;
	}
	return 1;
}

/**
 * @typedef {{ bytes: Buffer, contentType: string, provider: string, model?: string }} GeneratedImage
 */

/**
 * Resolve image model via Admin AI Models (same path as text providers).
 * @param {string} providerCode
 * @param {string} [preferredModelId]
 * @returns {Promise<{ modelId: string, source: string }>}
 */
async function resolveRegistryImageModel(providerCode, preferredModelId = '') {
	const { resolveImageModelIdForProvider } = await import('../ai-models.js');
	return resolveImageModelIdForProvider(providerCode, { preferredModelId });
}

/**
 * Shared image provider interface — adapters must accept this shape and return GeneratedImage[].
 * Switching providers requires no caller changes beyond `provider` + matching apiKeys entry.
 *
 * Flow: Admin AI Models → Provider Registry → adapter
 *
 * @param {{
 *   provider: string,
 *   apiKeys: Record<string, string>,
 *   prompt: string,
 *   count?: number,
 *   model?: string,
 *   preferredModelId?: string,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 *   generationTarget?: import('../image-generation-target.js').ImageGenerationTarget,
 * }} params
 * @returns {Promise<GeneratedImage[]>}
 */
export async function generateImagesWithProvider({
	provider,
	apiKeys = {},
	prompt,
	count = 1,
	model,
	preferredModelId,
	baseUrl,
	timeoutMs,
	generationTarget,
}) {
	const normalizedCount = normalizeImageCount(count);
	const code = resolveImageAdapterCode(provider) || 'openai';
	const loader = IMAGE_ADAPTER_LOADERS[code];

	if (!loader) {
		const error = new Error(`Unsupported image provider: ${provider || '(empty)'}`);
		error.status = 422;
		throw error;
	}

	const adapter = await loader();
	const keyCode = code === 'flux' ? 'fal' : code;
	const apiKey = apiKeys[keyCode] || apiKeys[code] || '';

	const preferred = String(preferredModelId || model || '').trim();
	const resolved = await resolveRegistryImageModel(code, preferred);
	const resolvedModel = resolved.modelId || adapter.forceModel || '';
	const modelSource = resolved.modelId ? resolved.source : (adapter.forceModel ? 'adapter_alias' : 'none');

	if (code === 'gemini' && !resolvedModel) {
		const error = new Error(
			'No usable image model configured for Google Gemini in Admin AI Models.',
		);
		error.status = 400;
		error.errorCode = 'AI_IMAGE_MODEL_MISSING';
		throw error;
	}

	console.log('[INFO]', '[image-providers] Resolved image generation model', JSON.stringify({
		provider: code,
		model: resolvedModel || '(adapter default)',
		modelSource,
		preferredModelId: preferred || null,
	}));

	return adapter.generate({
		apiKey,
		prompt,
		count: normalizedCount,
		model: resolvedModel || undefined,
		modelSource,
		baseUrl,
		timeoutMs,
		generationTarget,
	});
}

export function listImageProviders() {
	return [
		{ id: 'openai', label: 'OpenAI Images', size: '1000x1500 (1024x1536)' },
		{ id: 'fal', label: 'Fal.ai', size: '1000x1500' },
		{ id: 'flux', label: 'FLUX (via Fal)', size: '1000x1500' },
		{ id: 'gemini', label: 'Google Gemini Image', size: '1000x1500 (2:3)' },
	];
}

export { listImplementedImageAdapters, resolveImageAdapterCode };
