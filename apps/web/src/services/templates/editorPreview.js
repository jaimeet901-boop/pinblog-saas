/**
 * Preview bridge — editor never imports compositor internals beyond this facade.
 */

import { renderDocument, createMockRenderSurface } from '@/lib/pinLayerCompositor';

let lastPreviewObjectUrl = '';

export function revokePreviewObjectUrl(url = lastPreviewObjectUrl) {
	if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
		try {
			URL.revokeObjectURL(url);
		} catch {
			/* ignore */
		}
	}
	if (url === lastPreviewObjectUrl) {
		lastPreviewObjectUrl = '';
	}
}

/**
 * Render current editor document via the shared compositor (PNG).
 * @param {object} document
 * @param {object} [options]
 */
export async function previewEditorDocument(document, options = {}) {
	const result = await renderDocument(document, {
		format: 'png',
		variables: options.variables || {
			title: 'Pin Title',
			subtitle: 'Subtitle',
			cta: 'Get the Recipe',
			image: options.imageUrl || '',
			logo: options.logoUrl || '',
		},
		createSurface: options.createSurface,
		loadImageFn: options.loadImageFn,
	});

	if (typeof Blob !== 'undefined') {
		const blob = new Blob([result.bytes], { type: result.mimeType });
		revokePreviewObjectUrl();
		const objectUrl = URL.createObjectURL(blob);
		lastPreviewObjectUrl = objectUrl;
		return {
			...result,
			blob,
			objectUrl,
		};
	}

	return result;
}

/** Test helper: preview without DOM canvas. */
export async function previewEditorDocumentForTests(document, options = {}) {
	return previewEditorDocument(document, {
		...options,
		createSurface: createMockRenderSurface,
	});
}
