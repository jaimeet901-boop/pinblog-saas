import apiServerClient from '@/lib/apiServerClient';
import { renderFeaturedPinToBlob } from '@/lib/pinCanvasRenderer';
import { resolveFeaturedTemplateConfig } from '@/lib/pinTemplates';

/**
 * Compose featured pins with the BlogToPin-style canvas engine and upload PNGs.
 * Never falls back to the raw article featured image after a successful render —
 * that legacy path is what made pins look like plain photos with no overlay.
 */
export async function composeAndUploadFeaturedPins(pins, {
	brandKit = null,
} = {}) {
	const results = [];
	for (const pin of pins) {
		const featuredImageUrl = String(pin.featuredImage || '').trim();
		if (!featuredImageUrl) {
			results.push({
				tempId: pin.tempId,
				ok: false,
				error: 'Article featured image is missing',
				imageUrl: '',
			});
			continue;
		}

		let objectUrl = '';
		try {
			const blob = await renderFeaturedPinToBlob({
				featuredImageUrl,
				templateConfig: resolveFeaturedTemplateConfig(pin.templateConfig),
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
				websiteDomain: brandKit?.websiteUrl || pin.website || '',
			});

			objectUrl = URL.createObjectURL(blob);

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
				// Keep the composed blob URL so the UI still shows the designed pin.
				console.warn('[featured-compose] upload failed, using local composed blob', {
					status: response.status,
					message: payload?.message,
					tempId: pin.tempId,
				});
				results.push({
					tempId: pin.tempId,
					ok: true,
					error: payload?.message || `Upload deferred (${response.status})`,
					imageUrl: objectUrl,
					hosted: false,
				});
				continue;
			}

			const hostedUrl = String(payload.imageUrl || '').trim();
			if (hostedUrl) {
				URL.revokeObjectURL(objectUrl);
				objectUrl = '';
			}

			results.push({
				tempId: pin.tempId,
				ok: true,
				error: '',
				imageUrl: hostedUrl || objectUrl,
				hosted: Boolean(hostedUrl),
			});
		} catch (error) {
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
			}
			console.error('[featured-compose] canvas render failed', {
				tempId: pin.tempId,
				error: error?.message || error,
			});
			results.push({
				tempId: pin.tempId,
				ok: false,
				error: error?.message || 'Local featured canvas render failed',
				// Intentionally empty: UI falls back to TemplatePreviewCard (designed overlay),
				// never the raw article photo.
				imageUrl: '',
			});
		}
	}
	return results;
}
