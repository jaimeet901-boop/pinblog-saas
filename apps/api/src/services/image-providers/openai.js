import { PINTEREST_IMAGE_SIZE } from './index.js';

export async function generateWithOpenAI({ apiKey, prompt, count = 1 }) {
	if (!apiKey) {
		throw new Error('OpenAI API key is not configured');
	}

	const images = [];
	for (let index = 0; index < count; index += 1) {
		const response = await fetch('https://api.openai.com/v1/images/generations', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: process.env.OPENAI_IMAGES_MODEL || 'gpt-image-1',
				prompt,
				size: process.env.OPENAI_IMAGES_SIZE || PINTEREST_IMAGE_SIZE,
			}),
		});

		if (!response.ok) {
			const details = await response.text().catch(() => 'OpenAI image generation failed');
			const error = new Error(details || 'OpenAI image generation failed');
			error.status = response.status;
			throw error;
		}

		const payload = await response.json();
		const item = payload?.data?.[0];
		if (!item) {
			throw new Error('OpenAI image generation returned empty output');
		}

		if (item.b64_json) {
			images.push({
				bytes: Buffer.from(item.b64_json, 'base64'),
				contentType: 'image/png',
				provider: 'openai',
			});
			continue;
		}

		if (item.url) {
			const imageResponse = await fetch(item.url);
			if (!imageResponse.ok) {
				throw new Error('Failed to download generated image from OpenAI');
			}
			const arrayBuffer = await imageResponse.arrayBuffer();
			images.push({
				bytes: Buffer.from(arrayBuffer),
				contentType: imageResponse.headers.get('content-type') || 'image/png',
				provider: 'openai',
			});
		}
	}

	return images;
}
