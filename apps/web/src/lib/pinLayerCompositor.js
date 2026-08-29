/**
 * Format-agnostic layer compositor.
 * Consumes a normalized template document only — no PocketBase.
 */

import { mergeBrandKitIntoVariableContext } from './pinBrandKitBridge.js';
import {
	getDrawableLayers,
	isV2Document,
	normalizeEditorDocument,
} from './pinLayerSchema.js';
import { getRenderTarget, MINIMAL_PNG_BYTES } from './pinRenderTargets.js';
import { resolveVariablesInDocument } from './pinVariableRegistry.js';
import {
	drawFacebookBackgroundOnSurface,
	isFacebookExportProfile,
} from './facebookBackgroundFit.js';

/**
 * Browser canvas RenderSurface.
 * @param {number} width
 * @param {number} height
 * @param {{ document?: Document }} [options]
 */
export function createBrowserCanvasSurface(width, height, options = {}) {
	const doc = options.document || (typeof document !== 'undefined' ? document : null);
	if (!doc) {
		throw new Error('createBrowserCanvasSurface requires a DOM document');
	}
	const canvas = doc.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas 2D context unavailable');
	}

	return {
		width,
		height,
		ctx,
		canvas,
		fillRect(x, y, w, h, color) {
			ctx.fillStyle = color;
			ctx.fillRect(x, y, w, h);
		},
		clear() {
			ctx.clearRect(0, 0, width, height);
		},
		save() {
			ctx.save();
		},
		restore() {
			ctx.restore();
		},
		setGlobalAlpha(alpha) {
			ctx.globalAlpha = alpha;
		},
		translate(x, y) {
			ctx.translate(x, y);
		},
		rotate(radians) {
			ctx.rotate(radians);
		},
		beginPath() {
			ctx.beginPath();
		},
		rect(x, y, w, h) {
			ctx.rect(x, y, w, h);
		},
		ellipse(x, y, rx, ry) {
			ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
		},
		fill(color) {
			ctx.fillStyle = color;
			ctx.fill();
		},
		stroke(color, lineWidth = 1) {
			ctx.strokeStyle = color;
			ctx.lineWidth = lineWidth;
			ctx.stroke();
		},
		fillText(text, x, y, font, color, align = 'left') {
			ctx.font = font;
			ctx.fillStyle = color;
			ctx.textAlign = align;
			ctx.textBaseline = 'top';
			ctx.fillText(text, x, y);
		},
		measureText(text, font) {
			ctx.font = font;
			return ctx.measureText(text).width;
		},
		drawImage(image, dx, dy, dw, dh, sx, sy, sw, sh) {
			if (sx == null) {
				ctx.drawImage(image, dx, dy, dw, dh);
			} else {
				ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
			}
		},
		createLinearGradient(x0, y0, x1, y1) {
			return ctx.createLinearGradient(x0, y0, x1, y1);
		},
		fillGradientRect(gradient, x, y, w, h) {
			ctx.fillStyle = gradient;
			ctx.fillRect(x, y, w, h);
		},
		clipRoundedRect(x, y, w, h, radius) {
			const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
			ctx.beginPath();
			ctx.moveTo(x + r, y);
			ctx.arcTo(x + w, y, x + w, y + h, r);
			ctx.arcTo(x + w, y + h, x, y + h, r);
			ctx.arcTo(x, y + h, x, y, r);
			ctx.arcTo(x, y, x + w, y, r);
			ctx.closePath();
			ctx.clip();
		},
		async toBlob(type = 'image/png', quality) {
			return new Promise((resolve, reject) => {
				canvas.toBlob((blob) => {
					if (!blob) reject(new Error('canvas.toBlob failed'));
					else resolve(blob);
				}, type, quality);
			});
		},
		toDataURL(type = 'image/png', quality) {
			return canvas.toDataURL(type, quality);
		},
	};
}

/**
 * Deterministic mock surface for Node tests (records ops; encodes minimal PNG).
 */
export function createMockRenderSurface(width, height) {
	const ops = [];
	return {
		width,
		height,
		ops,
		__allowMinimalPng: true,
		fillRect(x, y, w, h, color) {
			ops.push({ op: 'fillRect', x, y, w, h, color });
		},
		clear() {
			ops.push({ op: 'clear' });
		},
		save() {
			ops.push({ op: 'save' });
		},
		restore() {
			ops.push({ op: 'restore' });
		},
		setGlobalAlpha(alpha) {
			ops.push({ op: 'alpha', alpha });
		},
		translate(x, y) {
			ops.push({ op: 'translate', x, y });
		},
		rotate(radians) {
			ops.push({ op: 'rotate', radians });
		},
		beginPath() {
			ops.push({ op: 'beginPath' });
		},
		rect(x, y, w, h) {
			ops.push({ op: 'rect', x, y, w, h });
		},
		ellipse(x, y, rx, ry) {
			ops.push({ op: 'ellipse', x, y, rx, ry });
		},
		fill(color) {
			ops.push({ op: 'fill', color });
		},
		stroke(color, lineWidth = 1) {
			ops.push({ op: 'stroke', color, lineWidth });
		},
		fillText(text, x, y, font, color, align = 'left') {
			ops.push({ op: 'fillText', text, x, y, font, color, align });
		},
		measureText(text) {
			return String(text).length * 10;
		},
		drawImage() {
			ops.push({ op: 'drawImage' });
		},
		createLinearGradient() {
			return { addColorStop() {} };
		},
		fillGradientRect(_g, x, y, w, h) {
			ops.push({ op: 'fillGradientRect', x, y, w, h });
		},
		clipRoundedRect() {
			ops.push({ op: 'clipRoundedRect' });
		},
		toPNGBytes() {
			return MINIMAL_PNG_BYTES.slice();
		},
	};
}

/**
 * Wrap text for v2 layers. Explicit newlines are hard breaks; long lines still wrap.
 * @param {{ measureText: (text: string, font?: string) => number }} surface
 * @param {string} text
 * @param {string} font
 * @param {number} maxWidth
 * @param {number} maxLines
 * @returns {string[]}
 */
export function wrapText(surface, text, font, maxWidth, maxLines) {
	const limit = Math.max(1, Number(maxLines) || 4);
	const paragraphs = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
	const lines = [];

	for (const paragraph of paragraphs) {
		if (lines.length >= limit) break;
		const words = String(paragraph || '').trim().split(/\s+/).filter(Boolean);
		if (!words.length) {
			// Preserve intentional blank lines from consecutive newlines when space remains.
			if (paragraph === '' && lines.length > 0 && lines.length < limit) {
				lines.push('');
			}
			continue;
		}
		let current = words[0];
		for (let i = 1; i < words.length; i += 1) {
			const trial = `${current} ${words[i]}`;
			if (surface.measureText(trial, font) <= maxWidth) {
				current = trial;
			} else {
				lines.push(current);
				current = words[i];
				if (lines.length >= limit) {
					return lines.slice(0, limit);
				}
			}
		}
		if (lines.length < limit) {
			lines.push(current);
		}
	}

	return lines.slice(0, limit);
}

async function loadImage(src, loadImageFn) {
	const url = String(src || '').trim();
	if (!url || url.includes('{{')) return null;
	if (typeof loadImageFn !== 'function') return null;
	return loadImageFn(url);
}

function drawCover(surface, image, x, y, w, h, focusX = 0.5, focusY = 0.5) {
	if (!image) return;
	const iw = image.width || w;
	const ih = image.height || h;
	const scale = Math.max(w / iw, h / ih);
	const sw = w / scale;
	const sh = h / scale;
	const sx = Math.max(0, Math.min(iw - sw, iw * focusX - sw / 2));
	const sy = Math.max(0, Math.min(ih - sh, ih * focusY - sh / 2));
	surface.drawImage(image, x, y, w, h, sx, sy, sw, sh);
}

async function drawLayer(surface, layer, options = {}) {
	const { loadImageFn, exportProfileId = '' } = options;
	if (!layer || layer.visible === false) return;
	const { x, y, width, height, rotation, opacity, borderRadius, props = {}, type } = layer;

	surface.save();
	surface.setGlobalAlpha(opacity);
	surface.translate(x + width / 2, y + height / 2);
	if (rotation) {
		surface.rotate((rotation * Math.PI) / 180);
	}
	surface.translate(-width / 2, -height / 2);

	if (borderRadius > 0 && typeof surface.clipRoundedRect === 'function') {
		surface.clipRoundedRect(0, 0, width, height, borderRadius);
	}

	switch (type) {
		case 'background': {
			const backgroundColor = props.color || '#111111';
			const backgroundSrc = String(props.imageSrc || props.src || '').trim();
			if (backgroundSrc && !backgroundSrc.includes('{{')) {
				const img = await loadImage(backgroundSrc, loadImageFn);
				if (!img) {
					throw new Error(`Background image failed to load: ${backgroundSrc.slice(0, 120)}`);
				}
				if (isFacebookExportProfile(exportProfileId)) {
					drawFacebookBackgroundOnSurface(surface, img, 0, 0, width, height, {
						backgroundColor,
					});
				} else {
					surface.fillRect(0, 0, width, height, backgroundColor);
					drawCover(surface, img, 0, 0, width, height);
				}
			} else {
				surface.fillRect(0, 0, width, height, backgroundColor);
			}
			break;
		}
		case 'image':
		case 'aiImage':
		case 'sticker':
		case 'logo': {
			const layerSrc = String(props.src || '').trim();
			let img = null;
			try {
				img = await loadImage(layerSrc, loadImageFn);
			} catch (error) {
				if (type === 'image' || type === 'aiImage') {
					throw error;
				}
				img = null;
			}
			if (!img) {
				if (type === 'image' || type === 'aiImage') {
					throw new Error(`Image layer failed to load: ${layerSrc.slice(0, 120)}`);
				}
				surface.fillRect(0, 0, width, height, 'rgba(255,255,255,0.08)');
				break;
			}
			if (props.fit === 'fill') {
				surface.drawImage(img, 0, 0, width, height);
			} else if (props.fit === 'contain') {
				const iw = img.width || width;
				const ih = img.height || height;
				const scale = Math.min(width / iw, height / ih);
				const dw = iw * scale;
				const dh = ih * scale;
				surface.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
			} else if (isFacebookExportProfile(exportProfileId) && (type === 'image' || type === 'aiImage')) {
				drawFacebookBackgroundOnSurface(surface, img, 0, 0, width, height);
			} else {
				drawCover(surface, img, 0, 0, width, height, props.focusX, props.focusY);
			}
			break;
		}
		case 'text': {
			const font = `${props.fontWeight || 700} ${props.fontSize || 48}px ${props.fontFamily || 'sans-serif'}`;
			const lines = wrapText(surface, props.text, font, width, props.maxLines || 4);
			const lineHeight = (props.fontSize || 48) * (props.lineHeight || 1.1);
			let cursorY = 0;
			const align = props.align || 'left';
			for (const line of lines) {
				let tx = 0;
				if (align === 'center') tx = width / 2;
				if (align === 'right') tx = width;
				if (props.shadow) {
					surface.fillText(line, tx + 2, cursorY + 2, font, 'rgba(0,0,0,0.45)', align);
				}
				surface.fillText(line, tx, cursorY, font, props.color || '#fff', align);
				cursorY += lineHeight;
			}
			break;
		}
		case 'shape': {
			surface.beginPath();
			if (props.shape === 'ellipse') {
				surface.ellipse(width / 2, height / 2, width / 2, height / 2);
			} else {
				surface.rect(0, 0, width, height);
			}
			surface.fill(props.fill || '#fff');
			if (props.stroke && props.strokeWidth > 0) {
				surface.stroke(props.stroke, props.strokeWidth);
			}
			break;
		}
		case 'badge':
		case 'cta': {
			surface.beginPath();
			surface.rect(0, 0, width, height);
			surface.fill(props.fill || '#fff');
			const font = `700 ${props.fontSize || 28}px sans-serif`;
			surface.fillText(
				String(props.text || ''),
				width / 2,
				Math.max(0, (height - (props.fontSize || 28)) / 2),
				font,
				props.textColor || '#111',
				'center',
			);
			break;
		}
		case 'divider': {
			const thickness = props.thickness || 2;
			surface.fillRect(0, (height - thickness) / 2, width, thickness, props.color || '#fff');
			break;
		}
		case 'gradient': {
			const angle = ((props.angle || 90) * Math.PI) / 180;
			const cx = width / 2;
			const cy = height / 2;
			const len = Math.hypot(width, height) / 2;
			const x0 = cx - Math.cos(angle) * len;
			const y0 = cy - Math.sin(angle) * len;
			const x1 = cx + Math.cos(angle) * len;
			const y1 = cy + Math.sin(angle) * len;
			const gradient = surface.createLinearGradient(x0, y0, x1, y1);
			const colors = Array.isArray(props.colors) ? props.colors : ['transparent', '#000'];
			colors.forEach((color, index) => {
				const stop = colors.length === 1 ? 0 : index / (colors.length - 1);
				if (typeof gradient.addColorStop === 'function') {
					gradient.addColorStop(stop, color);
				}
			});
			surface.fillGradientRect(gradient, 0, 0, width, height);
			break;
		}
		default:
			break;
	}

	surface.restore();
}

/**
 * Draw a normalized (and optionally variable-resolved) document onto a surface.
 */
export async function composeDocument(doc, surface, options = {}) {
	const layers = getDrawableLayers(doc);
	for (const layer of layers) {
		await drawLayer(surface, layer, options);
	}
	return surface;
}

/**
 * Full pipeline: normalize → Variable Engine resolve → compose → encode.
 * Renderer never interprets {{tokens}}; it only paints resolved strings/URLs.
 */
export async function renderDocument(rawDocument, options = {}) {
	if (!isV2Document(rawDocument) && !Array.isArray(rawDocument?.layers)) {
		throw new Error('renderDocument expects a v2 layer document');
	}

	const format = String(options.format || 'png').toLowerCase();
	const target = getRenderTarget(format);

	let document = normalizeEditorDocument(rawDocument);
	const variableContext = mergeBrandKitIntoVariableContext(
		options.variables || options.context || {},
		options.brandKit || null,
	);
	// Resolve-before-render (Module 5) — compositor must not see raw expressions.
	document = resolveVariablesInDocument(document, variableContext, {
		replaceUnknown: options.replaceUnknown || 'empty',
	});

	const width = document.canvas.width;
	const height = document.canvas.height;
	const surface = options.createSurface
		? options.createSurface(width, height)
		: createBrowserCanvasSurface(width, height);

	await composeDocument(document, surface, {
		loadImageFn: options.loadImageFn,
		exportProfileId: options.exportProfileId || '',
	});

	const bytes = await target.encode(surface, {
		quality: options.quality,
		compression: options.compression,
		transparent: options.transparent,
		dpi: options.dpi,
	});

	return {
		bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
		mimeType: target.mimeType,
		document,
		format: target.id,
	};
}

export { isV2Document, normalizeEditorDocument };
