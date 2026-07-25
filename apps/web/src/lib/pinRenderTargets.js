/**
 * Format-agnostic RenderTarget adapters.
 * PNG implemented; JPG/WebP/PDF/SVG/MP4 reserved.
 * No PocketBase / AI provider imports.
 * Export Engine is the only consumer of encode options (quality/compression).
 */

import { RENDER_TARGETS, isRenderTarget } from './pinEngineConstants.js';

export class UnsupportedRenderFormatError extends Error {
	constructor(format) {
		super(`UNSUPPORTED_FORMAT: ${format}`);
		this.name = 'UnsupportedRenderFormatError';
		this.code = 'UNSUPPORTED_FORMAT';
		this.format = format;
	}
}

/**
 * @typedef {object} RenderSurface
 * @property {number} width
 * @property {number} height
 * @property {(type?: string, quality?: number) => Promise<Blob|Uint8Array>} [toBlob]
 * @property {(type?: string, quality?: number) => string} [toDataURL]
 * @property {() => Uint8Array} [toPNGBytes]
 */

/**
 * @typedef {object} EncodeOptions
 * @property {number} [quality] 0–1 (lossy formats)
 * @property {number} [compression] 0–9 (PNG-oriented hint)
 * @property {boolean} [transparent]
 * @property {number} [dpi]
 */

function dataUrlToUint8Array(dataUrl) {
	const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
	if (!match) {
		throw new Error('Invalid data URL from surface');
	}
	const binary = atob(match[2]);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function encodePng(surface, options = {}) {
	const quality = options.quality;
	if (typeof surface.toPNGBytes === 'function') {
		const bytes = surface.toPNGBytes(options);
		return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	}
	if (typeof surface.toBlob === 'function') {
		const blob = await surface.toBlob('image/png', quality);
		if (blob instanceof Uint8Array) return blob;
		if (typeof Blob !== 'undefined' && blob instanceof Blob) {
			const buffer = await blob.arrayBuffer();
			return new Uint8Array(buffer);
		}
	}
	if (typeof surface.toDataURL === 'function') {
		return dataUrlToUint8Array(surface.toDataURL('image/png', quality));
	}
	throw new Error('RenderSurface cannot encode PNG');
}

/** Minimal valid 1x1 PNG (fallback for mock surfaces without pixels). */
export const MINIMAL_PNG_BYTES = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
	0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
	0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export const PngTarget = {
	id: 'png',
	mimeType: 'image/png',
	supportsTransparency: true,
	/**
	 * @param {RenderSurface} surface
	 * @param {EncodeOptions} [options]
	 */
	async encode(surface, options = {}) {
		try {
			return await encodePng(surface, options);
		} catch {
			if (surface?.__allowMinimalPng) {
				return MINIMAL_PNG_BYTES.slice();
			}
			throw new Error('PNG encode failed');
		}
	},
};

function stubTarget(id, mimeType, extras = {}) {
	return {
		id,
		mimeType,
		supportsTransparency: Boolean(extras.supportsTransparency),
		async encode(_surface, _options = {}) {
			throw new UnsupportedRenderFormatError(id);
		},
	};
}

const TARGETS = {
	png: PngTarget,
	jpg: stubTarget('jpg', 'image/jpeg'),
	jpeg: stubTarget('jpg', 'image/jpeg'),
	webp: stubTarget('webp', 'image/webp', { supportsTransparency: true }),
	pdf: stubTarget('pdf', 'application/pdf'),
	svg: stubTarget('svg', 'image/svg+xml', { supportsTransparency: true }),
	mp4: stubTarget('mp4', 'video/mp4'),
};

/**
 * @param {string} format
 */
export function getRenderTarget(format = 'png') {
	const key = String(format || 'png').toLowerCase();
	if (!TARGETS[key]) {
		throw new UnsupportedRenderFormatError(key);
	}
	if (key !== 'png' && key !== 'jpeg' && key !== 'jpg' && !isRenderTarget(key)) {
		throw new UnsupportedRenderFormatError(key);
	}
	return TARGETS[key];
}

export function listRenderTargets() {
	return [...RENDER_TARGETS];
}
