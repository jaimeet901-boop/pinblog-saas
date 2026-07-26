import { renderFeaturedPinToBlob } from '@/lib/pinCanvasRenderer';
import { uploadImageBlob } from './imageLifecycle.js';
import { traceImageLifecycle } from './imageLifecycleTrace.js';

/**
 * Compose featured pins with the BlogToPin-style canvas engine and upload PNGs.
 * Preview may temporarily use a blob URL; Save Draft always uploads to a hosted URL first.
 */
export async function composeAndUploadFeaturedPins(pins, {
	brandKit = null,
} = {}) {
	const results = [];
	for (const pin of pins) {
		const featuredImageUrl = String(pin.featuredImage || pin.sourceImageUrl || '').trim();
		await traceImageLifecycle('2_image_url_resolution', {
			traceId: pin.tempId,
			tempId: pin.tempId,
			articleId: pin.articleId,
			imageUrl: featuredImageUrl,
			functionName: 'composeAndUploadFeaturedPins',
			fileName: 'apps/web/src/services/ai-pins/featuredComposeService.js',
			lineNumber: 14,
			meta: { hasTemplateConfig: Boolean(pin.templateConfig) },
		});
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
				traceId: pin.tempId,
			});

			if (!blob || blob.size <= 0) {
				throw new Error('Composer returned an empty image blob');
			}

			await traceImageLifecycle('6_png_export', {
				traceId: pin.tempId,
				tempId: pin.tempId,
				blob,
				sampleBlob: true,
				imageUrl: featuredImageUrl,
				functionName: 'composeAndUploadFeaturedPins',
				fileName: 'apps/web/src/services/ai-pins/featuredComposeService.js',
				lineNumber: 48,
				meta: { bytes: blob.size, type: blob.type },
			});

			objectUrl = URL.createObjectURL(blob);

			try {
				const uploaded = await uploadImageBlob(blob, {
					articleId: pin.articleId || '',
					title: pin.title || '',
					fileName: `featured-pin-${pin.tempId || Date.now()}.png`,
					tempId: pin.tempId || '',
				});
				URL.revokeObjectURL(objectUrl);
				objectUrl = '';
				await traceImageLifecycle('9_api_response_hosted_url', {
					traceId: pin.tempId,
					tempId: pin.tempId,
					imageUrl: uploaded.imageUrl,
					functionName: 'composeAndUploadFeaturedPins',
					fileName: 'apps/web/src/services/ai-pins/featuredComposeService.js',
					lineNumber: 78,
				});
				results.push({
					tempId: pin.tempId,
					ok: true,
					error: '',
					imageUrl: uploaded.imageUrl,
					hosted: true,
				});
			} catch (uploadError) {
				await traceImageLifecycle('8_upload', {
					traceId: pin.tempId,
					tempId: pin.tempId,
					success: false,
					error: uploadError?.message || 'upload failed',
					imageUrl: objectUrl,
					functionName: 'composeAndUploadFeaturedPins',
					fileName: 'apps/web/src/services/ai-pins/featuredComposeService.js',
					lineNumber: 88,
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
			await traceImageLifecycle('5_canvas_rendering', {
				traceId: pin.tempId,
				tempId: pin.tempId,
				success: false,
				error: error?.message || 'compose failed',
				imageUrl: featuredImageUrl,
				functionName: 'composeAndUploadFeaturedPins',
				fileName: 'apps/web/src/services/ai-pins/featuredComposeService.js',
				lineNumber: 104,
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
