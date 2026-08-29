/**
 * Live gallery pin previews — real Template Engine renders (not SVG stubs).
 */

import { renderFeaturedPinToBlob } from '@/lib/pinCanvasRenderer';
import { fetchTemplateCached } from '@/services/ai-pins/templateHydration';
import { setCachedPreview } from '@/services/templates/previewCache';
import {
	buildFallbackFoodImageDataUrl,
	resolveGalleryPreviewContent,
} from '@/lib/pinGalleryDemoContent';

const MAX_CONCURRENT = 2;
const objectUrls = new Set();
const inFlight = new Map();
let active = 0;
const waitQueue = [];

function enqueue(task) {
	return new Promise((resolve, reject) => {
		waitQueue.push({ task, resolve, reject });
		pump();
	});
}

function pump() {
	while (active < MAX_CONCURRENT && waitQueue.length) {
		const next = waitQueue.shift();
		active += 1;
		Promise.resolve()
			.then(() => next.task())
			.then(next.resolve, next.reject)
			.finally(() => {
				active -= 1;
				pump();
			});
	}
}

function previewChecksum(configChecksum, contentKey) {
	const base = String(configChecksum || 'nocfg').trim().toLowerCase() || 'nocfg';
	const content = String(contentKey || 'demo').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96);
	return `${base}:live:${content}`;
}

async function resolveFeaturedImageUrl(content) {
	const preferred = String(content.featuredImageUrl || '').trim();
	if (preferred.startsWith('data:') || preferred.startsWith('blob:')) {
		return preferred;
	}
	if (preferred.startsWith('http://') || preferred.startsWith('https://')) {
		return preferred;
	}
	return buildFallbackFoodImageDataUrl(content.imageSeed || 0);
}

/**
 * Render one template card preview with the Template Engine.
 * @returns {Promise<string>} object URL for PNG preview
 */
export async function renderGalleryTemplatePreview({
	templateSummary,
	article = null,
	templateIndex = 0,
	signal = null,
} = {}) {
	const templateId = String(templateSummary?.id || '').trim();
	if (!templateId) throw new Error('Template id required');

	const content = resolveGalleryPreviewContent({
		article,
		templateIndex,
		templateId,
	});
	const checksum = previewChecksum(
		templateSummary.configChecksum || templateSummary.config_checksum || '',
		content.contentKey,
	);
	const cacheKey = `${templateId}::${checksum}`;
	if (inFlight.has(cacheKey)) {
		return inFlight.get(cacheKey);
	}

	const work = enqueue(async () => {
		if (signal?.aborted) throw new Error('Preview cancelled');
		const hydrated = await fetchTemplateCached(templateId);
		if (signal?.aborted) throw new Error('Preview cancelled');
		const configuration = hydrated?.configuration;
		if (!configuration || typeof configuration !== 'object') {
			throw new Error('Template configuration missing');
		}

		let featuredImageUrl = await resolveFeaturedImageUrl(content);
		let blob;
		try {
			blob = await renderFeaturedPinToBlob({
				featuredImageUrl,
				templateConfig: configuration,
				context: {
					title: content.title,
					subtitle: content.subtitle,
					overlayText: content.category,
					cta: content.cta,
					category: content.category,
					description: content.description,
					ingredients: content.ingredients || '',
					recipe: { ingredients: content.ingredients || '' },
				},
				websiteDomain: content.website,
			});
		} catch (error) {
			// Remote food image failed — retry once with local canvas food plate.
			featuredImageUrl = buildFallbackFoodImageDataUrl(content.imageSeed || templateIndex);
			blob = await renderFeaturedPinToBlob({
				featuredImageUrl,
				templateConfig: configuration,
				context: {
					title: content.title,
					subtitle: content.subtitle,
					overlayText: content.category,
					cta: content.cta,
					category: content.category,
					description: content.description,
					ingredients: content.ingredients || '',
					recipe: { ingredients: content.ingredients || '' },
				},
				websiteDomain: content.website,
			});
			if (!blob) throw error;
		}

		const url = URL.createObjectURL(blob);
		objectUrls.add(url);
		setCachedPreview({
			templateId,
			configChecksum: checksum,
			imageUrl: url,
			source: 'live-engine',
			format: 'png',
		});
		return url;
	});

	inFlight.set(cacheKey, work);
	try {
		return await work;
	} finally {
		inFlight.delete(cacheKey);
	}
}

export function revokeGalleryLivePreviewUrls() {
	for (const url of objectUrls) {
		try {
			URL.revokeObjectURL(url);
		} catch {
			// ignore
		}
	}
	objectUrls.clear();
}
