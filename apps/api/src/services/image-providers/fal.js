export async function generateWithFal({ apiKey, prompt, count = 1, model }) {
	if (!apiKey) {
		throw new Error('Fal.ai API key is not configured');
	}

	const endpointModel = model || process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/dev';
	const images = [];

	for (let index = 0; index < count; index += 1) {
		const response = await fetch(`https://fal.run/${endpointModel}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Key ${apiKey}`,
			},
			body: JSON.stringify({
				prompt,
				image_size: {
					width: 1000,
					height: 1500,
				},
				num_images: 1,
			}),
		});

		if (!response.ok) {
			const details = await response.text().catch(() => 'Fal.ai image generation failed');
			const error = new Error(details || 'Fal.ai image generation failed');
			error.status = response.status;
			throw error;
		}

		const payload = await response.json();
		const url = payload?.images?.[0]?.url || payload?.image?.url || '';
		if (!url) {
			throw new Error('Fal.ai returned no image URL');
		}

		const imageResponse = await fetch(url);
		if (!imageResponse.ok) {
			throw new Error('Failed to download generated image from Fal.ai');
		}
		const arrayBuffer = await imageResponse.arrayBuffer();
		images.push({
			bytes: Buffer.from(arrayBuffer),
			contentType: imageResponse.headers.get('content-type') || 'image/png',
			provider: model?.includes('flux') ? 'flux' : 'fal',
		});
	}

	return images;
}
