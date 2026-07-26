import { renderFeaturedPinToBlob } from '@/lib/pinCanvasRenderer';
import { uploadImageBlob } from './imageLifecycle.js';

/**
 * Compose featured pins with the BlogToPin-style canvas engine and upload PNGs.
 * Preview may temporarily use a blob URL; Save Draft always uploads to a hosted URL first.
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
				error: 'Article image is missing',
				imageUrl: '',
				hosted: false,
			});
			continue;
		}

		let objectUrl = '';
		try {
			const blob = await renderFeaturedPinToBlob({
				featuredImageUrl,
				templateConfig: pin.templateConfig,
				context: {
					title: pin.title,
					subtitle: pin.subtitle,
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

			try {
				const uploaded = await uploadImageBlob(blob, {
					articleId: pin.articleId || '',
					title: pin.title || '',
					fileName: `featured-pin-${pin.tempId || Date.now()}.png`,
				});
				URL.revokeObjectURL(objectUrl);
				objectUrl = '';
				results.push({
					tempId: pin.tempId,
					ok: true,
					error: '',
					imageUrl: uploaded.imageUrl,
					hosted: true,
				});
			} catch (uploadError) {
				// Keep local blob for Studio preview only — Save Draft will re-upload via imageLifecycle.
				console.warn('[featured-compose] upload failed, keeping local blob for preview', {
					status: uploadError?.message,
					tempId: pin.tempId,
				});
				results.push({
					tempId: pin.tempId,
					ok: true,
					error: uploadError?.message || 'Hosted upload deferred — will retry on Save Draft',
					imageUrl: objectUrl,
					hosted: false,
				});
			}
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
				imageUrl: '',
				hosted: false,
			});
		}
	}
	return results;
}
