import { renderFeaturedPinToBlob } from '@/lib/pinCanvasRenderer';
import { listArticleImageCandidates } from '@/lib/imageSourceStrategy';
import { uploadImageBlob } from './imageLifecycle.js';
import { traceImageLifecycle } from './imageLifecycleTrace.js';

const FEATURED_COMPOSE_CONCURRENCY = 2;

async function runWithConcurrency(items, concurrency, workerFn) {
	const results = new Array(items.length);
	let cursor = 0;

	async function worker() {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await workerFn(items[index], index);
		}
	}

	const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));

	return results;
}

async function composeSingleFeaturedPin(pin, { brandKit, profile }) {
	const candidates = listArticleImageCandidates(pin);
	await traceImageLifecycle('2_image_url_resolution', {
		traceId: pin.tempId,
		tempId: pin.tempId,
		articleId: pin.articleId,
		imageUrl: candidates[0] || '',
		functionName: 'composeAndUploadFeaturedPins',
		fileName: 'apps/web/src/services/ai-pins/featuredComposeService.js',
		lineNumber: 18,
		meta: {
			hasTemplateConfig: Boolean(pin.templateConfig),
			candidateCount: candidates.length,
		},
	});
	if (candidates.length === 0) {
		return {
			tempId: pin.tempId,
			ok: false,
			error: 'Article image is missing',
			imageUrl: '',
			hosted: false,
		};
	}

	let lastError = null;
	for (const featuredImageUrl of candidates) {
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
				exportProfileId: profile,
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
				lineNumber: 70,
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
					lineNumber: 96,
				});
				return {
					tempId: pin.tempId,
					ok: true,
					error: '',
					imageUrl: uploaded.imageUrl,
					hosted: true,
					usedImageUrl: featuredImageUrl,
				};
			} catch (uploadError) {
				await traceImageLifecycle('8_upload', {
					traceId: pin.tempId,
					tempId: pin.tempId,
					success: false,
					error: uploadError?.message || 'upload failed',
					imageUrl: objectUrl,
					functionName: 'composeAndUploadFeaturedPins',
					fileName: 'apps/web/src/services/ai-pins/featuredComposeService.js',
					lineNumber: 110,
				});
				return {
					tempId: pin.tempId,
					ok: true,
					error: uploadError?.message || 'Hosted upload deferred — will retry on Save Draft',
					imageUrl: objectUrl,
					hosted: false,
					usedImageUrl: featuredImageUrl,
				};
			}
		} catch (error) {
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
			}
			lastError = error;
			await traceImageLifecycle('5_canvas_rendering', {
				traceId: pin.tempId,
				tempId: pin.tempId,
				success: false,
				error: error?.message || 'compose failed',
				imageUrl: featuredImageUrl,
				functionName: 'composeAndUploadFeaturedPins',
				fileName: 'apps/web/src/services/ai-pins/featuredComposeService.js',
				lineNumber: 136,
				meta: { tryingNextCandidate: true },
			});
		}
	}

	return {
		tempId: pin.tempId,
		ok: false,
		error: lastError?.message || 'Local featured canvas render failed',
		imageUrl: '',
		hosted: false,
	};
}

/**
 * Compose featured pins with the BlogToPin-style canvas engine and upload PNGs.
 * Preview may temporarily use a blob URL; Save Draft always uploads to a hosted URL first.
 * Tries featured → source → content images so a stale featured URL does not fail the pin.
 */
export async function composeAndUploadFeaturedPins(pins, {
	brandKit = null,
	exportProfileId = 'pinterest_standard',
} = {}) {
	const profile = String(exportProfileId || 'pinterest_standard').trim() || 'pinterest_standard';
	return runWithConcurrency(
		pins,
		FEATURED_COMPOSE_CONCURRENCY,
		(pin) => composeSingleFeaturedPin(pin, { brandKit, profile }),
	);
}
