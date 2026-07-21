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
 * @typedef {{ bytes: Buffer, contentType: string, provider: string }} GeneratedImage
 */

/**
 * @param {{ provider: string, apiKeys: Record<string, string>, prompt: string, count?: number }} params
 * @returns {Promise<GeneratedImage[]>}
 */
export async function generateImagesWithProvider({ provider, apiKeys, prompt, count = 1 }) {
	const normalizedCount = normalizeImageCount(count);
	const name = String(provider || 'openai').toLowerCase();

	if (name === 'fal' || name === 'flux') {
		const { generateWithFal } = await import('./fal.js');
		return generateWithFal({
			apiKey: apiKeys.fal || '',
			prompt,
			count: normalizedCount,
			model: name === 'flux' ? 'fal-ai/flux/dev' : undefined,
		});
	}

	const { generateWithOpenAI } = await import('./openai.js');
	return generateWithOpenAI({
		apiKey: apiKeys.openai || '',
		prompt,
		count: normalizedCount,
	});
}

export function listImageProviders() {
	return [
		{ id: 'openai', label: 'OpenAI Images', size: '1000x1500 (1024x1536)' },
		{ id: 'fal', label: 'Fal.ai', size: '1000x1500' },
		{ id: 'flux', label: 'FLUX (via Fal)', size: '1000x1500' },
	];
}
