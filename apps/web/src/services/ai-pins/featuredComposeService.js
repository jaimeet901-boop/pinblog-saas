import apiServerClient from '@/lib/apiServerClient';
import { renderFeaturedPinToBlob } from '@/lib/pinCanvasRenderer';

/**
 * Compose featured pins locally and upload hosted PNGs (no AI, no credits).
 */
export async function composeAndUploadFeaturedPins(pins, {
	brandKit = null,
} = {}) {
	const results = [];
	for (const pin of pins) {
		const featuredImageUrl = String(pin.featuredImage || pin.imageUrl || '').trim();
		if (!featuredImageUrl) {
			results.push({
				tempId: pin.tempId,
				ok: false,
				error: 'Article featured image is missing',
				imageUrl: '',
			});
			continue;
		}

		try {
			const blob = await renderFeaturedPinToBlob({
				featuredImageUrl,
				templateConfig: pin.templateConfig,
				context: {
					title: pin.title,
					description: pin.description,
					overlayText: pin.overlayText,
					category: pin.category,
					website: pin.website,
					author: pin.author,
				},
				logoUrl: brandKit?.logoUrl || '',
				watermarkText: brandKit?.watermarkText || '',
			});

			const formData = new FormData();
			formData.append('image', blob, `featured-pin-${pin.tempId || Date.now()}.png`);
			formData.append('articleId', String(pin.articleId || ''));
			formData.append('title', String(pin.title || '').slice(0, 220));

			const response = await apiServerClient.fetch('/ai-pin-images/composed', {
				method: 'POST',
				body: formData,
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to upload composed pin (${response.status})`);
			}

			results.push({
				tempId: pin.tempId,
				ok: true,
				error: '',
				imageUrl: payload.imageUrl || '',
			});
		} catch (error) {
			results.push({
				tempId: pin.tempId,
				ok: false,
				error: error?.message || 'Local featured render failed',
				// Fall back to raw featured URL so the pin is still usable.
				imageUrl: featuredImageUrl,
			});
		}
	}
	return results;
}
