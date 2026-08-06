/**
 * Professional Pinterest-style Featured Image composer (local canvas only).
 * BlogToPin-inspired: full-bleed photo, readability overlay, large title,
 * decorations, brand bar — no AI image generation.
 */

import {
	applyTemplateVariables,
	formatPinDomain,
	isV2TemplateConfig,
	resolveFeaturedTemplateConfig,
	resolveTitleBand,
} from '@/lib/pinTemplates';
import { API_SERVER_URL } from '@/lib/apiServerClient';
import { getPocketbaseAuthHeader } from '@/lib/pocketbaseClient';
import { renderDocument } from '@/lib/pinLayerCompositor';
import { applyExportCanvasSize } from '@/lib/pinExportEngine';
import { getExportProfile } from '@/lib/pinExportProfiles';
import { traceImageLifecycle } from '@/services/ai-pins/imageLifecycleTrace.js';

function loadImageFromUrl(url) {
	return new Promise((resolve, reject) => {
		if (!url) {
			reject(new Error('Image URL is empty'));
			return;
		}
		const img = new Image();
		// Must be fully decoded before canvas drawImage — async onload can fire too early,
		// producing a successful compose with a blank photo background.
		img.decoding = 'sync';
		img.onload = () => {
			const finish = () => {
				if (!img.naturalWidth || !img.naturalHeight) {
					reject(new Error(`Image decoded with empty dimensions: ${String(url).slice(0, 120)}`));
					return;
				}
				resolve(img);
			};
			if (typeof img.decode === 'function') {
				img.decode().then(finish).catch(() => finish());
			} else {
				finish();
			}
		};
		img.onerror = () => reject(new Error(`Failed to load image: ${String(url).slice(0, 120)}`));
		img.src = url;
	});
}

export async function fetchImageForCanvas(remoteUrl) {
	const source = String(remoteUrl || '').trim();
	if (!source) {
		throw new Error('Featured image URL is required');
	}
	if (source.startsWith('data:') || source.startsWith('blob:')) {
		return loadImageFromUrl(source);
	}

	const authorization = getPocketbaseAuthHeader();
	const proxyUrl = `${API_SERVER_URL}/ai-pin-images/proxy?url=${encodeURIComponent(source)}`;
	console.info('[pin-canvas] fetch featured image for compose', { source: source.slice(0, 160) });
	const response = await fetch(proxyUrl, {
		method: 'GET',
		headers: {
			...(authorization ? { Authorization: authorization } : {}),
		},
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => ({}));
		throw new Error(payload?.message || `Failed to fetch featured image (${response.status})`);
	}
	const blob = await response.blob();
	if (!blob || blob.size <= 0) {
		throw new Error('Featured image proxy returned an empty body');
	}

	// Prefer ImageBitmap so pixels are ready before drawImage (no async-decode race).
	if (typeof createImageBitmap === 'function') {
		const bitmap = await createImageBitmap(blob);
		if (!bitmap.width || !bitmap.height) {
			bitmap.close?.();
			throw new Error('Featured image bitmap has empty dimensions');
		}
		console.info('[pin-canvas] featured image ready', { width: bitmap.width, height: bitmap.height, bytes: blob.size });
		return bitmap;
	}

	const objectUrl = URL.createObjectURL(blob);
	try {
		const img = await loadImageFromUrl(objectUrl);
		console.info('[pin-canvas] featured image ready', {
			width: img.naturalWidth || img.width,
			height: img.naturalHeight || img.height,
			bytes: blob.size,
		});
		return img;
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

function drawCoverImage(ctx, img, width, height, { focusY = 0.38, focusX = 0.5 } = {}) {
	const iw = Number(img.naturalWidth || img.width) || 0;
	const ih = Number(img.naturalHeight || img.height) || 0;
	if (!iw || !ih) {
		throw new Error('Cannot draw featured image with empty dimensions');
	}
	const scale = Math.max(width / iw, height / ih);
	const drawW = iw * scale;
	const drawH = ih * scale;
	const focalY = Math.max(0.2, Math.min(0.65, Number(focusY) || 0.38));
	const focalX = Math.max(0.3, Math.min(0.7, Number(focusX) || 0.5));
	const srcFocusY = focalY * drawH;
	const destFocusY = height * 0.4;
	let y = destFocusY - srcFocusY;
	const minY = Math.min(0, height - drawH);
	y = Math.max(minY, Math.min(0, y));
	const srcFocusX = focalX * drawW;
	const destFocusX = width * 0.5;
	let x = destFocusX - srcFocusX;
	const minX = Math.min(0, width - drawW);
	x = Math.max(minX, Math.min(0, x));
	ctx.drawImage(img, x, y, drawW, drawH);
}

/**
 * Sample average luminance in the title band to auto-tune overlay + text contrast.
 */
function sampleBandBrightness(ctx, width, height, band) {
	try {
		const y0 = Math.max(0, Math.floor(height * (band?.start ?? 0.5)));
		const y1 = Math.min(height, Math.floor(height * (band?.end ?? 0.78)));
		const sampleH = Math.max(8, y1 - y0);
		const step = 12;
		const data = ctx.getImageData(0, y0, width, sampleH).data;
		let sum = 0;
		let count = 0;
		for (let py = 0; py < sampleH; py += step) {
			for (let px = 0; px < width; px += step) {
				const i = (py * width + px) * 4;
				const r = data[i];
				const g = data[i + 1];
				const b = data[i + 2];
				sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
				count += 1;
			}
		}
		return count ? sum / count / 255 : 0.45;
	} catch {
		return 0.45;
	}
}

function applyAutoContrast(config, brightness) {
	const next = {
		...config,
		textOverlay: { ...config.textOverlay },
		typography: { ...config.typography },
	};
	const frame = config.layout.frameStyle || 'none';
	const framed = ['darkBox', 'whiteCard', 'softCard', 'glassCard', 'ribbon', 'bannerStrip', 'polaroid', 'insetFrame'].includes(frame);
	if (framed) return { config: next, brightness };

	if (brightness > 0.62) {
		next.textOverlay.intensity = Math.min(0.88, Math.max(next.textOverlay.intensity || 0.5, 0.68));
		next.textOverlay.style = next.textOverlay.style === 'none' ? 'gradient' : next.textOverlay.style;
		next.typography.textColor = '#FFFFFF';
		next.typography.textShadow = true;
	} else if (brightness < 0.28) {
		next.textOverlay.intensity = Math.max(0.28, Math.min(next.textOverlay.intensity || 0.5, 0.42));
		next.typography.textColor = '#FFFBEB';
		next.typography.textShadow = true;
	} else {
		next.textOverlay.intensity = Math.max(next.textOverlay.intensity || 0.5, 0.52);
	}
	return { config: next, brightness };
}

function hexToRgba(color, alpha = 1) {
	const raw = String(color || '#000000').trim();
	if (raw.startsWith('rgba') || raw.startsWith('rgb')) {
		return raw;
	}
	const hex = raw.replace('#', '');
	const full = hex.length === 3
		? hex.split('').map((ch) => ch + ch).join('')
		: hex.padEnd(6, '0').slice(0, 6);
	const r = Number.parseInt(full.slice(0, 2), 16) || 0;
	const g = Number.parseInt(full.slice(2, 4), 16) || 0;
	const b = Number.parseInt(full.slice(4, 6), 16) || 0;
	return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function roundRectPath(ctx, x, y, w, h, radius) {
	const r = Math.max(0, Math.min(radius, w / 2, h / 2));
	ctx.beginPath();
	if (typeof ctx.roundRect === 'function') {
		ctx.roundRect(x, y, w, h, r);
		return;
	}
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/**
 * Greedy wrap, then rebalance line lengths for a more editorial look.
 */
export function wrapTitleBalanced(ctx, text, maxWidth, maxLines = 5) {
	const words = String(text || '').trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];

	const fits = (line) => ctx.measureText(line).width <= maxWidth;

	const greedy = [];
	let current = '';
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (!current || fits(next)) {
			current = next;
			continue;
		}
		greedy.push(current);
		current = word;
		if (greedy.length >= maxLines) break;
	}
	if (current && greedy.length < maxLines) greedy.push(current);

	if (greedy.length === maxLines) {
		const used = greedy.join(' ').split(/\s+/).length;
		if (used < words.length) {
			const last = greedy[maxLines - 1];
			greedy[maxLines - 1] = `${last.replace(/\s+\S*$/, '').trim()}…`;
		}
	}

	// Balance: pull words from longer lines into shorter neighbors.
	const lines = [...greedy];
	for (let pass = 0; pass < 4; pass += 1) {
		for (let i = 0; i < lines.length - 1; i += 1) {
			const left = lines[i].split(/\s+/);
			const right = lines[i + 1].split(/\s+/);
			if (left.length < 2) continue;
			const candidateLeft = left.slice(0, -1).join(' ');
			const moved = left[left.length - 1];
			const candidateRight = `${moved} ${right.join(' ')}`.trim();
			if (!fits(candidateLeft) || !fits(candidateRight)) continue;
			const before = Math.abs(ctx.measureText(lines[i]).width - ctx.measureText(lines[i + 1]).width);
			const after = Math.abs(ctx.measureText(candidateLeft).width - ctx.measureText(candidateRight).width);
			if (after + 8 < before) {
				lines[i] = candidateLeft;
				lines[i + 1] = candidateRight;
			}
		}
	}

	return lines.filter(Boolean);
}

function measureLinesHeight(fontSize, lineCount, lineHeight) {
	return fontSize * lineHeight * Math.max(1, lineCount);
}

export function fitTitleBlock(ctx, {
	text,
	maxWidth,
	maxHeight,
	maxFontSize,
	minFontSize,
	fontFamily,
	fontWeight,
	lineHeight,
	maxLines,
	letterSpacing = 0,
}) {
	let lo = minFontSize;
	let hi = maxFontSize;
	let best = {
		fontSize: minFontSize,
		lines: wrapTitleBalanced(ctx, text, maxWidth, maxLines),
	};

	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2);
		ctx.font = `${fontWeight} ${mid}px ${fontFamily}`;
		try {
			if (letterSpacing) ctx.letterSpacing = `${letterSpacing}px`;
		} catch {
			// letterSpacing is not supported in all browsers
		}
		const lines = wrapTitleBalanced(ctx, text, maxWidth, maxLines);
		const height = measureLinesHeight(mid, lines.length, lineHeight);
		const overflow = lines.some((line) => ctx.measureText(line).width > maxWidth + 1);
		if (!overflow && height <= maxHeight && lines.length > 0) {
			best = { fontSize: mid, lines };
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}

	try {
		ctx.letterSpacing = '0px';
	} catch {
		// ignore
	}
	return best;
}

function drawReadabilityOverlay(ctx, width, height, config) {
	const { style, intensity, color } = config.textOverlay;
	if (style === 'none' || intensity <= 0) return;

	const position = config.layout.textPosition;
	const alpha = intensity;

	if (style === 'dark') {
		ctx.fillStyle = hexToRgba(color, alpha * 0.55);
		ctx.fillRect(0, 0, width, height);
		return;
	}

	if (style === 'vignette') {
		const gradient = ctx.createRadialGradient(
			width / 2,
			height / 2,
			Math.min(width, height) * 0.15,
			width / 2,
			height / 2,
			Math.max(width, height) * 0.72,
		);
		gradient.addColorStop(0, hexToRgba(color, 0));
		gradient.addColorStop(1, hexToRgba(color, alpha));
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, width, height);
		return;
	}

	// gradient (default) — stronger behind the title band
	if (position === 'top') {
		const g = ctx.createLinearGradient(0, 0, 0, height * 0.55);
		g.addColorStop(0, hexToRgba(color, Math.min(0.92, alpha + 0.15)));
		g.addColorStop(0.55, hexToRgba(color, alpha * 0.45));
		g.addColorStop(1, hexToRgba(color, 0));
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, width, height * 0.55);
	} else if (position === 'center') {
		const g = ctx.createLinearGradient(0, height * 0.2, 0, height * 0.8);
		g.addColorStop(0, hexToRgba(color, 0));
		g.addColorStop(0.35, hexToRgba(color, alpha * 0.72));
		g.addColorStop(0.65, hexToRgba(color, alpha * 0.72));
		g.addColorStop(1, hexToRgba(color, 0));
		ctx.fillStyle = g;
		ctx.fillRect(0, height * 0.2, width, height * 0.6);
		const soft = ctx.createLinearGradient(0, height * 0.75, 0, height);
		soft.addColorStop(0, hexToRgba(color, 0));
		soft.addColorStop(1, hexToRgba(color, alpha * 0.45));
		ctx.fillStyle = soft;
		ctx.fillRect(0, height * 0.75, width, height * 0.25);
	} else {
		const g = ctx.createLinearGradient(0, height * 0.28, 0, height);
		g.addColorStop(0, hexToRgba(color, 0));
		g.addColorStop(0.35, hexToRgba(color, alpha * 0.35));
		g.addColorStop(0.7, hexToRgba(color, Math.min(0.9, alpha + 0.08)));
		g.addColorStop(1, hexToRgba(color, Math.min(0.95, alpha + 0.2)));
		ctx.fillStyle = g;
		ctx.fillRect(0, height * 0.28, width, height * 0.72);
	}
}

function drawBrushHighlight(ctx, {
	x, y, width, height, color, opacity,
}) {
	ctx.save();
	ctx.globalAlpha = opacity;
	ctx.fillStyle = color;
	ctx.beginPath();
	const midY = y + height / 2;
	ctx.moveTo(x, midY + height * 0.15);
	ctx.bezierCurveTo(
		x + width * 0.15, y - height * 0.1,
		x + width * 0.45, y - height * 0.2,
		x + width * 0.55, midY - height * 0.05,
	);
	ctx.bezierCurveTo(
		x + width * 0.7, y + height * 1.05,
		x + width * 0.9, y + height * 0.95,
		x + width, midY + height * 0.2,
	);
	ctx.bezierCurveTo(
		x + width * 0.85, y + height * 1.15,
		x + width * 0.4, y + height * 1.2,
		x, midY + height * 0.35,
	);
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

function drawAccentShapes(ctx, {
	width, height, margin, color, position, style = 'orbits', seed = '',
}) {
	if (style === 'none') return;
	ctx.save();
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	const size = Math.max(10, width * 0.016);
	const variant = String(seed || style || position);

	const drawDiamond = (cx, cy, r) => {
		ctx.beginPath();
		ctx.moveTo(cx, cy - r);
		ctx.lineTo(cx + r, cy);
		ctx.lineTo(cx, cy + r);
		ctx.lineTo(cx - r, cy);
		ctx.closePath();
		ctx.fill();
	};

	if (style === 'diamonds' || /ribbon|bold/.test(variant)) {
		ctx.globalAlpha = 0.5;
		drawDiamond(width - margin - size * 1.4, margin + size * 2.2, size);
		ctx.globalAlpha = 0.28;
		drawDiamond(margin + size * 1.6, height * 0.48, size * 0.7);
	} else if (style === 'arcs' || style === 'flourish') {
		ctx.globalAlpha = 0.45;
		ctx.lineWidth = Math.max(2, size * 0.35);
		ctx.beginPath();
		ctx.arc(width - margin - size * 2, margin + size * 3, size * 2.4, Math.PI * 1.1, Math.PI * 1.85);
		ctx.stroke();
		ctx.globalAlpha = 0.28;
		ctx.beginPath();
		ctx.arc(margin + size * 2.2, height * 0.52, size * 1.8, Math.PI * 0.15, Math.PI * 0.85);
		ctx.stroke();
		if (style === 'flourish') {
			ctx.globalAlpha = 0.35;
			ctx.beginPath();
			ctx.moveTo(width * 0.5 - size * 3, margin + size);
			ctx.quadraticCurveTo(width * 0.5, margin - size * 0.5, width * 0.5 + size * 3, margin + size);
			ctx.stroke();
		}
	} else if (style === 'corner') {
		ctx.globalAlpha = 0.4;
		ctx.lineWidth = Math.max(3, size * 0.4);
		ctx.beginPath();
		ctx.moveTo(margin, margin + size * 3.5);
		ctx.lineTo(margin, margin);
		ctx.lineTo(margin + size * 3.5, margin);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(width - margin, height * 0.42);
		ctx.lineTo(width - margin, height * 0.42 - size * 3.5);
		ctx.lineTo(width - margin - size * 3.5, height * 0.42 - size * 3.5);
		ctx.stroke();
	} else if (style === 'dots') {
		ctx.globalAlpha = 0.45;
		for (let i = 0; i < 3; i += 1) {
			ctx.beginPath();
			ctx.arc(width - margin - size * (1 + i * 1.8), margin + size * 2, size * (0.55 - i * 0.08), 0, Math.PI * 2);
			ctx.fill();
		}
	} else if (style === 'slash') {
		ctx.globalAlpha = 0.38;
		ctx.lineWidth = Math.max(4, size * 0.55);
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(width - margin - size * 4, margin + size);
		ctx.lineTo(width - margin - size, margin + size * 4.5);
		ctx.stroke();
	} else if (style === 'rule') {
		ctx.globalAlpha = 0.5;
		roundRectPath(ctx, margin, height * 0.5 - size * 0.2, size * 4.5, size * 0.35, size);
		ctx.fill();
	} else if (style === 'spark') {
		ctx.globalAlpha = 0.5;
		const cx = width - margin - size * 2;
		const cy = margin + size * 2.5;
		for (let i = 0; i < 4; i += 1) {
			const ang = (Math.PI / 2) * i;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(cx + Math.cos(ang) * size * 2.2, cy + Math.sin(ang) * size * 2.2);
			ctx.lineWidth = Math.max(2, size * 0.28);
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
		ctx.fill();
	} else if (style === 'brackets') {
		ctx.globalAlpha = 0.45;
		ctx.lineWidth = Math.max(3, size * 0.4);
		ctx.beginPath();
		ctx.moveTo(margin + size * 2, margin + size);
		ctx.lineTo(margin, margin + size);
		ctx.lineTo(margin, margin + size * 4);
		ctx.lineTo(margin + size * 2, margin + size * 4);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(width - margin - size * 2, height * 0.48);
		ctx.lineTo(width - margin, height * 0.48);
		ctx.lineTo(width - margin, height * 0.48 + size * 3);
		ctx.lineTo(width - margin - size * 2, height * 0.48 + size * 3);
		ctx.stroke();
	} else {
		// orbits (default)
		ctx.globalAlpha = 0.42;
		ctx.beginPath();
		ctx.arc(width - margin - size * 1.4, margin + size * 2.4, size, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 0.22;
		ctx.lineWidth = Math.max(2, size * 0.28);
		ctx.beginPath();
		ctx.arc(width - margin - size * 1.4, margin + size * 2.4, size * 2.1, 0, Math.PI * 2);
		ctx.stroke();
		if (position === 'bottom' || position === 'center') {
			ctx.globalAlpha = 0.28;
			roundRectPath(ctx, margin, height * 0.46, size * 3.2, size * 0.35, size);
			ctx.fill();
		}
	}
	ctx.restore();
}

function drawPremiumBadge(ctx, {
	text,
	x,
	y,
	align = 'center',
	background,
	textColor,
	fontFamily,
	padding = 16,
	borderRadius = 999,
	shadow = true,
	variant = 'pill',
}) {
	const label = String(text || '').trim();
	if (!label) return { height: 0, width: 0 };
	const fontSize = 24;
	ctx.font = `700 ${fontSize}px ${fontFamily}`;
	try {
		ctx.letterSpacing = '1px';
	} catch {
		// ignore
	}
	const display = label.toUpperCase();
	const textWidth = ctx.measureText(display).width;
	const w = textWidth + padding * 2.5;
	const h = fontSize + padding * 1.2;
	const radius = borderRadius >= 999 ? h / 2 : Math.min(borderRadius, h / 2);
	const drawX = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
	const isOutline = variant === 'outline' || String(background).includes('rgba(255,255,255,0.1');

	ctx.save();
	if (shadow && !isOutline) {
		ctx.shadowColor = 'rgba(0,0,0,0.28)';
		ctx.shadowBlur = 16;
		ctx.shadowOffsetY = 5;
	}
	if (isOutline) {
		ctx.fillStyle = 'rgba(255,255,255,0.1)';
		roundRectPath(ctx, drawX, y, w, h, radius);
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,255,255,0.85)';
		ctx.lineWidth = 2;
		roundRectPath(ctx, drawX, y, w, h, radius);
		ctx.stroke();
	} else {
		ctx.fillStyle = background;
		roundRectPath(ctx, drawX, y, w, h, radius);
		ctx.fill();
		ctx.shadowColor = 'transparent';
		ctx.shadowBlur = 0;
		ctx.strokeStyle = 'rgba(255,255,255,0.32)';
		ctx.lineWidth = 1.5;
		roundRectPath(ctx, drawX + 2, y + 2, w - 4, h - 4, Math.max(0, radius - 2));
		ctx.stroke();
	}
	ctx.shadowColor = 'transparent';
	ctx.shadowBlur = 0;
	ctx.fillStyle = textColor;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	ctx.fillText(display, drawX + padding * 1.25, y + h / 2 + 1);
	ctx.restore();
	try {
		ctx.letterSpacing = '0px';
	} catch {
		// ignore
	}
	return { height: h + 22, width: w };
}

function drawRoundedLabel(ctx, options) {
	return drawPremiumBadge(ctx, options);
}

function drawDarkTitleBox(ctx, { x, y, width, height, radius = 28 }) {
	ctx.save();
	ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
	roundRectPath(ctx, x, y, width, height, radius);
	ctx.fill();
	ctx.restore();
}

function drawWhiteCard(ctx, { x, y, width, height, radius = 36 }) {
	ctx.save();
	ctx.shadowColor = 'rgba(0,0,0,0.28)';
	ctx.shadowBlur = 28;
	ctx.shadowOffsetY = 10;
	ctx.fillStyle = 'rgba(255,255,255,0.96)';
	roundRectPath(ctx, x, y, width, height, radius);
	ctx.fill();
	ctx.restore();
}

function drawSoftCard(ctx, { x, y, width, height, radius = 44 }) {
	ctx.save();
	ctx.shadowColor = 'rgba(0,0,0,0.22)';
	ctx.shadowBlur = 36;
	ctx.shadowOffsetY = 14;
	ctx.fillStyle = 'rgba(255,251,235,0.95)';
	roundRectPath(ctx, x, y, width, height, radius);
	ctx.fill();
	ctx.restore();
}

function drawGlassCard(ctx, { x, y, width, height, radius = 28 }) {
	ctx.save();
	ctx.fillStyle = 'rgba(255,255,255,0.18)';
	roundRectPath(ctx, x, y, width, height, radius);
	ctx.fill();
	ctx.strokeStyle = 'rgba(255,255,255,0.45)';
	ctx.lineWidth = 1.5;
	roundRectPath(ctx, x, y, width, height, radius);
	ctx.stroke();
	ctx.restore();
}

function drawBannerStrip(ctx, { x, y, width, height, color = 'rgba(28,25,23,0.82)' }) {
	ctx.save();
	ctx.fillStyle = color;
	ctx.fillRect(x, y, width, height);
	ctx.fillStyle = 'rgba(255,255,255,0.12)';
	ctx.fillRect(x, y, width, 3);
	ctx.fillRect(x, y + height - 3, width, 3);
	ctx.restore();
}

function drawPolaroid(ctx, { x, y, width, height }) {
	ctx.save();
	ctx.shadowColor = 'rgba(0,0,0,0.3)';
	ctx.shadowBlur = 24;
	ctx.shadowOffsetY = 10;
	ctx.fillStyle = '#FAFAF9';
	roundRectPath(ctx, x, y, width, height + 36, 8);
	ctx.fill();
	ctx.restore();
}

function drawInsetFrame(ctx, { margin, width, height, brandReserved }) {
	ctx.save();
	ctx.strokeStyle = 'rgba(255,255,255,0.55)';
	ctx.lineWidth = 2;
	const inset = margin * 0.55;
	ctx.strokeRect(inset, inset, width - inset * 2, height - brandReserved - inset * 0.6);
	ctx.strokeStyle = 'rgba(255,255,255,0.22)';
	ctx.lineWidth = 1;
	ctx.strokeRect(inset + 10, inset + 10, width - inset * 2 - 20, height - brandReserved - inset * 0.6 - 20);
	ctx.restore();
}

function drawRibbonBanner(ctx, { x, y, width, height, color = '#B91C1C' }) {
	ctx.save();
	ctx.fillStyle = color;
	ctx.beginPath();
	const notch = Math.min(36, height * 0.45);
	ctx.moveTo(x + notch, y);
	ctx.lineTo(x + width - notch, y);
	ctx.lineTo(x + width, y + height / 2);
	ctx.lineTo(x + width - notch, y + height);
	ctx.lineTo(x + notch, y + height);
	ctx.lineTo(x, y + height / 2);
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

function drawMagazineFrame(ctx, { margin, width, height, brandReserved }) {
	ctx.save();
	ctx.strokeStyle = 'rgba(248,250,252,0.55)';
	ctx.lineWidth = 2;
	ctx.strokeRect(margin * 0.55, margin * 0.55, width - margin * 1.1, height - brandReserved - margin * 0.4);
	ctx.fillStyle = 'rgba(248,250,252,0.9)';
	ctx.fillRect(margin, height * 0.52, 8, Math.min(180, height * 0.18));
	ctx.restore();
}

function drawCornerBrand(ctx, { width, margin, logoImage, domain, textColor, fontFamily }) {
	ctx.save();
	const y = margin + 8;
	let x = width - margin;
	if (domain) {
		ctx.fillStyle = textColor || '#FFFFFF';
		ctx.font = `600 20px ${fontFamily}`;
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		ctx.globalAlpha = 0.92;
		ctx.fillText(domain, x, y + 22);
		x -= ctx.measureText(domain).width + 12;
	}
	if (logoImage) {
		const size = 36;
		ctx.globalAlpha = 1;
		ctx.drawImage(logoImage, x - size, y, size, size);
	}
	ctx.restore();
}

function drawBrandBar(ctx, {
	width, height, margin, brandBar, logoImage, domain, fontFamily,
}) {
	if (!brandBar.enabled) return;
	const barH = 96;
	const y = height - barH;
	ctx.save();
	ctx.fillStyle = brandBar.background;
	ctx.fillRect(0, y, width, barH);

	const contentY = y + barH / 2;
	let cursorX = margin;
	const logoSize = 44;

	if (brandBar.showLogo && logoImage) {
		const aspect = logoImage.width / Math.max(1, logoImage.height);
		const drawH = logoSize;
		const drawW = Math.min(120, drawH * aspect);
		ctx.drawImage(logoImage, cursorX, contentY - drawH / 2, drawW, drawH);
		cursorX += drawW + 16;
	}

	if (brandBar.showDomain && domain) {
		ctx.fillStyle = brandBar.textColor;
		ctx.font = `600 24px ${fontFamily}`;
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'left';
		ctx.globalAlpha = 0.92;
		ctx.fillText(domain, cursorX, contentY);
	}
	ctx.restore();
}

/**
 * Render a professional Featured pin to PNG Blob.
 * Dual-path: v2 layer documents → shared compositor; else procedural v1 renderer.
 */
export async function renderFeaturedPinToBlob({
	featuredImageUrl,
	templateConfig,
	context = {},
	logoUrl = '',
	watermarkText = '',
	websiteDomain = '',
	traceId = '',
	exportProfileId = 'pinterest_standard',
}) {
	const profile = getExportProfile(exportProfileId);
	const width = profile.width;
	const height = profile.height;

	await traceImageLifecycle('3_image_download_start', {
		traceId,
		imageUrl: featuredImageUrl,
		functionName: 'renderFeaturedPinToBlob',
		fileName: 'apps/web/src/lib/pinCanvasRenderer.js',
		lineNumber: 757,
		meta: { exportProfileId: profile.id, width, height },
	});

	if (isV2TemplateConfig(templateConfig)) {
		const sizedDocument = (templateConfig.canvas?.width === width && templateConfig.canvas?.height === height)
			? templateConfig
			: applyExportCanvasSize(templateConfig, width, height);
		const { bytes, mimeType } = await renderDocument(sizedDocument, {
			format: 'png',
			variables: {
				...context,
				image: featuredImageUrl || context.image || context.imageUrl || '',
				imageUrl: featuredImageUrl || context.imageUrl || '',
				featuredImageUrl: featuredImageUrl || '',
				logo: logoUrl || context.logo || '',
				logoUrl: logoUrl || context.logoUrl || '',
				website: websiteDomain || context.website || watermarkText || '',
				websiteDomain: websiteDomain || '',
				cta: context.overlayText || context.cta || context.category || '',
			},
			loadImageFn: fetchImageForCanvas,
		});
		const blob = new Blob([bytes], { type: mimeType || 'image/png' });
		await traceImageLifecycle('5_canvas_rendering_v2', {
			traceId,
			blob,
			sampleBlob: true,
			imageUrl: featuredImageUrl,
			functionName: 'renderFeaturedPinToBlob',
			fileName: 'apps/web/src/lib/pinCanvasRenderer.js',
			lineNumber: 780,
		});
		return blob;
	}

	let config = resolveFeaturedTemplateConfig(templateConfig);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas is not available in this browser');
	}

	ctx.fillStyle = config.background.color || '#111111';
	ctx.fillRect(0, 0, width, height);

	const bandPreview = resolveTitleBand(config);
	if (featuredImageUrl) {
		const featured = await fetchImageForCanvas(featuredImageUrl);
		await traceImageLifecycle('4_image_decoding', {
			traceId,
			imageUrl: featuredImageUrl,
			dimensions: {
				width: featured.naturalWidth || featured.width || 0,
				height: featured.naturalHeight || featured.height || 0,
			},
			functionName: 'fetchImageForCanvas',
			fileName: 'apps/web/src/lib/pinCanvasRenderer.js',
			lineNumber: 47,
		});
		drawCoverImage(ctx, featured, width, height, {
			focusY: config.layout.foodFocusY ?? 0.38,
			focusX: 0.5,
		});
		if (typeof featured.close === 'function') {
			try { featured.close(); } catch { /* ImageBitmap cleanup */ }
		}
		try {
			const sample = ctx.getImageData(0, 0, Math.min(64, width), Math.min(64, height)).data;
			let nonDark = 0;
			for (let i = 0; i < sample.length; i += 4) {
				const y = (sample[i] * 0.299) + (sample[i + 1] * 0.587) + (sample[i + 2] * 0.114);
				if (y > 18) nonDark += 1;
			}
			await traceImageLifecycle('5_canvas_rendering_after_drawCover', {
				traceId,
				imageUrl: featuredImageUrl,
				dimensions: { width, height },
				functionName: 'drawCoverImage',
				fileName: 'apps/web/src/lib/pinCanvasRenderer.js',
				lineNumber: 99,
				meta: {
					nonDarkRatio: Number((nonDark / (sample.length / 4)).toFixed(4)),
				},
			});
		} catch {
			/* ignore sample failures */
		}
		const brightness = sampleBandBrightness(ctx, width, height, bandPreview);
		const contrast = applyAutoContrast(config, brightness);
		config = contrast.config;
	} else {
		throw new Error('Featured image URL is required for pin compose');
	}

	// Dynamic spacing from headline length
	const titleWordCount = String(context.title || '').trim().split(/\s+/).filter(Boolean).length;
	const dynMargin = titleWordCount <= 3
		? Math.max(config.layout.safeMargin, 112)
		: titleWordCount <= 5
			? Math.max(config.layout.safeMargin, 88)
			: Math.max(72, config.layout.safeMargin - 8);
	config = {
		...config,
		layout: {
			...config.layout,
			safeMargin: dynMargin,
			dynamicGapAfterTitle: config.layout.dynamicGapAfterTitle
				|| (titleWordCount <= 3 ? 32 : titleWordCount <= 5 ? 26 : 20),
		},
		typography: {
			...config.typography,
			fontSize: Math.round(config.typography.fontSize * (titleWordCount <= 3 ? 1.06 : titleWordCount >= 6 ? 0.94 : 1)),
		},
	};

	drawReadabilityOverlay(ctx, width, height, config);

	const margin = config.layout.safeMargin;
	const align = config.layout.textAlign || 'center';
	const frameStyle = config.layout.frameStyle || 'none';
	const ctaPosition = config.layout.ctaPosition || 'below-title';
	const brandPlacement = config.layout.brandPlacement || 'bottom-bar';
	const band = resolveTitleBand(config);
	const useBottomBar = brandPlacement === 'bottom-bar' && (config.brandBar.enabled || config.layout.showBrandBar);
	const brandReserved = useBottomBar ? 110 : margin;
	const bandTop = height * band.start;
	const bandBottom = Math.min(height * band.end, height - brandReserved - 24);

	const baseContext = {
		title: context.title || 'Pin Title',
		description: context.description || '',
		subtitle: context.subtitle || '',
		category: context.category || '',
		website: context.website || websiteDomain || '',
		author: context.author || '',
	};

	const titleText = applyTemplateVariables('{{title}}', baseContext).trim() || 'Pin Title';
	const subtitleText = String(baseContext.subtitle || '').trim();
	const domain = formatPinDomain(websiteDomain || baseContext.website || watermarkText);
	const centerX = width / 2;
	const ctaLabel = String(context.overlayText || context.category || '').trim();

	let logoImage = null;
	if ((config.brandBar.showLogo || config.placeholders.websiteLogo || brandPlacement === 'corner' || brandPlacement === 'inside-card') && logoUrl) {
		try {
			logoImage = await fetchImageForCanvas(logoUrl);
		} catch {
			logoImage = null;
		}
	}

	if (config.decorations.accentShapes && frameStyle === 'none') {
		drawAccentShapes(ctx, {
			width,
			height,
			margin,
			color: config.decorations.accentColor,
			position: config.layout.textPosition,
			style: config.decorations.accentStyle || 'orbits',
			seed: config.layout.variantId || '',
		});
	}

	if (frameStyle === 'magazine') {
		drawMagazineFrame(ctx, { margin, width, height, brandReserved });
	} else if (frameStyle === 'insetFrame') {
		drawInsetFrame(ctx, { margin, width, height, brandReserved });
	}

	let cursorY = bandTop;
	const framedContent = ['whiteCard', 'softCard', 'glassCard', 'darkBox', 'polaroid'].includes(frameStyle);
	const framePad = framedContent ? 36 : 0;
	const contentWidth = width - margin * 2 - framePad * 2;
	const textMaxWidth = Math.max(280, contentWidth);

	// Estimate title size first so framed layouts can size the box.
	const probeFit = fitTitleBlock(ctx, {
		text: titleText,
		maxWidth: textMaxWidth,
		maxHeight: Math.max(100, bandBottom - bandTop - 40),
		maxFontSize: config.typography.fontSize,
		minFontSize: config.typography.minFontSize,
		fontFamily: config.typography.fontFamily,
		fontWeight: config.typography.fontWeight,
		lineHeight: config.typography.lineHeight,
		maxLines: config.typography.maxLines,
		letterSpacing: config.typography.letterSpacing,
	});
	const probeLineH = probeFit.fontSize * config.typography.lineHeight;
	const probeBlockH = probeFit.lines.length * probeLineH;
	const subtitleReserve = (config.layout.showSubtitle && subtitleText) ? 42 : 0;
	const labelReserve = (config.decorations.roundedLabel && ctaLabel && ctaPosition !== 'bottom' && ctaPosition !== 'none') ? 64 : 0;
	const ctaReserve = (config.layout.showCta && ctaPosition === 'inside-frame' && ctaLabel) ? 76 : 0;
	const brandInsideReserve = brandPlacement === 'inside-card' ? 48 : 0;
	const frameHeight = probeBlockH + subtitleReserve + labelReserve + ctaReserve + brandInsideReserve + framePad * 2 + 36;
	const frameWidth = width - margin * 2;
	const frameX = margin;
	let frameY = bandTop + Math.max(0, ((bandBottom - bandTop) - frameHeight) * 0.35);

	if (frameStyle === 'darkBox') {
		drawDarkTitleBox(ctx, { x: frameX, y: frameY, width: frameWidth, height: frameHeight, radius: 28 });
		cursorY = frameY + framePad + 8;
	} else if (frameStyle === 'whiteCard') {
		drawWhiteCard(ctx, { x: frameX, y: frameY, width: frameWidth, height: frameHeight, radius: 36 });
		cursorY = frameY + framePad + 8;
	} else if (frameStyle === 'softCard') {
		drawSoftCard(ctx, { x: frameX, y: frameY, width: frameWidth, height: frameHeight, radius: 44 });
		cursorY = frameY + framePad + 8;
	} else if (frameStyle === 'glassCard') {
		drawGlassCard(ctx, { x: frameX, y: frameY, width: frameWidth, height: frameHeight, radius: 28 });
		cursorY = frameY + framePad + 8;
	} else if (frameStyle === 'polaroid') {
		drawPolaroid(ctx, { x: frameX, y: frameY, width: frameWidth, height: frameHeight });
		cursorY = frameY + framePad + 8;
	} else if (frameStyle === 'bannerStrip') {
		const stripH = Math.max(probeBlockH + 56, 140);
		frameY = (bandTop + bandBottom) / 2 - stripH / 2;
		drawBannerStrip(ctx, {
			x: 0,
			y: frameY,
			width,
			height: stripH,
			color: hexToRgba(config.decorations.brushColor || '#1C1917', 0.82),
		});
		cursorY = frameY + (stripH - probeBlockH) / 2;
	} else if (frameStyle === 'ribbon') {
		const ribbonH = Math.max(probeBlockH + 48, 120);
		frameY = (bandTop + bandBottom) / 2 - ribbonH / 2;
		drawRibbonBanner(ctx, {
			x: margin * 0.35,
			y: frameY,
			width: width - margin * 0.7,
			height: ribbonH,
			color: config.decorations.brushColor || '#B91C1C',
		});
		cursorY = frameY + (ribbonH - probeBlockH) / 2;
	}

	if (config.decorations.roundedLabel && ctaLabel && ctaPosition !== 'bottom' && ctaPosition !== 'none' && ctaPosition !== 'inside-frame') {
		const labelResult = drawPremiumBadge(ctx, {
			text: ctaLabel.slice(0, 36),
			x: align === 'left' ? margin + framePad : align === 'right' ? width - margin - framePad : centerX,
			y: cursorY,
			align,
			background: config.buttonStyle.background,
			textColor: config.buttonStyle.textColor,
			fontFamily: config.typography.fontFamily,
			padding: Math.max(12, config.buttonStyle.padding * 0.75),
			borderRadius: config.buttonStyle.borderRadius,
			shadow: config.buttonStyle.shadow,
		});
		cursorY += labelResult.height || 0;
	}

	const titleMaxHeight = Math.max(80, (frameStyle === 'none' ? bandBottom : frameY + frameHeight - framePad) - cursorY - 12);
	const fitted = fitTitleBlock(ctx, {
		text: titleText,
		maxWidth: textMaxWidth,
		maxHeight: titleMaxHeight,
		maxFontSize: config.typography.fontSize,
		minFontSize: config.typography.minFontSize,
		fontFamily: config.typography.fontFamily,
		fontWeight: config.typography.fontWeight,
		lineHeight: config.typography.lineHeight,
		maxLines: config.typography.maxLines,
		letterSpacing: config.typography.letterSpacing,
	});

	const lineHeightPx = fitted.fontSize * config.typography.lineHeight;
	const blockHeight = fitted.lines.length * lineHeightPx;
	if (frameStyle === 'none') {
		const remaining = bandBottom - cursorY;
		if (blockHeight < remaining * 0.92) {
			cursorY += (remaining - blockHeight) * (config.layout.textPosition === 'top' ? 0.15 : 0.35);
		}
	}

	const blockTop = cursorY;
	const longest = fitted.lines.reduce((max, line) => {
		ctx.font = `${config.typography.fontWeight} ${fitted.fontSize}px ${config.typography.fontFamily}`;
		return Math.max(max, ctx.measureText(line).width);
	}, 0);
	const brushPadX = 28;
	const brushPadY = 18;
	const brushX = align === 'left'
		? margin + framePad - brushPadX * 0.3
		: align === 'right'
			? width - margin - framePad - longest - brushPadX * 0.3
			: centerX - longest / 2 - brushPadX;
	const brushW = longest + brushPadX * 2;

	if (config.decorations.brushHighlight && fitted.lines.length > 0 && frameStyle === 'none') {
		drawBrushHighlight(ctx, {
			x: brushX,
			y: blockTop - brushPadY,
			width: brushW,
			height: blockHeight + brushPadY * 2,
			color: config.decorations.brushColor,
			opacity: config.decorations.brushOpacity,
		});
	}

	ctx.save();
	ctx.font = `${config.typography.fontWeight} ${fitted.fontSize}px ${config.typography.fontFamily}`;
	ctx.fillStyle = config.typography.textColor;
	ctx.textBaseline = 'top';
	ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
	try {
		if (config.typography.letterSpacing) {
			ctx.letterSpacing = `${config.typography.letterSpacing}px`;
		}
	} catch {
		// ignore
	}
	if (config.typography.textShadow && !['whiteCard', 'softCard', 'polaroid'].includes(frameStyle)) {
		ctx.shadowColor = 'rgba(0,0,0,0.45)';
		ctx.shadowBlur = 18;
		ctx.shadowOffsetY = 4;
	}

	const textX = align === 'left'
		? margin + framePad
		: align === 'right'
			? width - margin - framePad
			: centerX;
	fitted.lines.forEach((line, index) => {
		const isLast = index === fitted.lines.length - 1;
		const useScript = config.typography.scriptEnabled && isLast && fitted.lines.length > 1;
		if (useScript) {
			ctx.font = `600 ${Math.round(fitted.fontSize * 0.92)}px ${config.typography.scriptFontFamily}`;
			ctx.fillStyle = config.typography.scriptColor;
		} else {
			ctx.font = `${config.typography.fontWeight} ${fitted.fontSize}px ${config.typography.fontFamily}`;
			ctx.fillStyle = config.typography.textColor;
		}
		ctx.fillText(line, textX, blockTop + index * lineHeightPx);
	});
	ctx.restore();

	const titleBottom = blockTop + blockHeight;

	if (config.decorations.underline && fitted.lines.length > 0) {
		ctx.save();
		ctx.strokeStyle = config.decorations.underlineColor;
		ctx.lineWidth = Math.max(3, fitted.fontSize * 0.055);
		ctx.lineCap = 'round';
		const underlineW = Math.min(longest * 0.48, textMaxWidth * 0.38);
		const ux = align === 'left' ? textX : align === 'right' ? textX - underlineW : centerX - underlineW / 2;
		const uy = titleBottom + 16;
		ctx.beginPath();
		ctx.moveTo(ux, uy);
		ctx.lineTo(ux + underlineW, uy);
		ctx.stroke();
		ctx.restore();
	}

	let afterTitleY = titleBottom + (config.decorations.underline
		? Math.max(36, config.layout.dynamicGapAfterTitle || 26) + 12
		: (config.layout.dynamicGapAfterTitle || 26));

	if (config.layout.showSubtitle && subtitleText) {
		const subSize = Math.max(22, Math.round(fitted.fontSize * 0.28));
		ctx.save();
		ctx.font = `500 ${subSize}px ${config.typography.fontFamily}`;
		ctx.fillStyle = config.typography.textColor;
		ctx.globalAlpha = config.layout.subtitleOpacity
			?? (['whiteCard', 'softCard', 'polaroid'].includes(frameStyle) ? 0.72 : 0.86);
		ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
		ctx.textBaseline = 'top';
		const subLines = wrapTitleBalanced(ctx, subtitleText, textMaxWidth * 0.92, 2);
		subLines.forEach((line, index) => {
			ctx.fillText(line, textX, afterTitleY + index * subSize * 1.3);
		});
		afterTitleY += subLines.length * subSize * 1.3 + 22;
		ctx.restore();
	}

	if (config.layout.showDescription && baseContext.description) {
		const descSize = Math.max(20, Math.round(fitted.fontSize * 0.28));
		ctx.save();
		ctx.font = `500 ${descSize}px ${config.typography.fontFamily}`;
		ctx.fillStyle = config.typography.textColor;
		ctx.globalAlpha = 0.84;
		ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
		ctx.textBaseline = 'top';
		const descLines = wrapTitleBalanced(ctx, baseContext.description, textMaxWidth, 2);
		descLines.forEach((line, index) => {
			ctx.fillText(line, textX, afterTitleY + index * descSize * 1.25);
		});
		afterTitleY += descLines.length * descSize * 1.25 + 20;
		ctx.restore();
	}

	const badgeOpts = {
		background: config.buttonStyle.background,
		textColor: config.buttonStyle.textColor,
		fontFamily: config.typography.fontFamily,
		padding: config.buttonStyle.padding,
		borderRadius: config.buttonStyle.borderRadius,
		shadow: config.buttonStyle.shadow,
		variant: config.buttonStyle.variant || 'pill',
	};

	if (config.layout.showCta && ctaLabel && (ctaPosition === 'below-title' || ctaPosition === 'inside-frame') && !config.decorations.roundedLabel) {
		drawPremiumBadge(ctx, {
			...badgeOpts,
			text: ctaLabel.slice(0, 40),
			x: textX,
			y: Math.min(afterTitleY, height - brandReserved - 78),
			align,
		});
		afterTitleY += 72;
	} else if (config.layout.showCta && ctaLabel && ctaPosition === 'inside-frame' && config.decorations.roundedLabel) {
		drawPremiumBadge(ctx, {
			...badgeOpts,
			text: ctaLabel.slice(0, 36),
			x: centerX,
			y: Math.min(afterTitleY, frameY + frameHeight - framePad - 56),
			align: 'center',
		});
		afterTitleY += 68;
	}

	if (config.layout.showCta && ctaLabel && ctaPosition === 'bottom') {
		drawPremiumBadge(ctx, {
			...badgeOpts,
			text: ctaLabel.slice(0, 40),
			x: centerX,
			y: height - brandReserved - 84,
			align: 'center',
		});
	}

	if (brandPlacement === 'inside-card' && (logoImage || domain)) {
		ctx.save();
		const by = Math.min(afterTitleY + 8, frameY + frameHeight - 40);
		ctx.fillStyle = config.brandBar.textColor || '#6B7280';
		ctx.font = `600 18px ${config.typography.fontFamily}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		if (logoImage) {
			ctx.drawImage(logoImage, centerX - 70, by - 14, 28, 28);
			ctx.fillText(domain || 'website', centerX + 10, by);
		} else if (domain) {
			ctx.fillText(domain, centerX, by);
		}
		ctx.restore();
	}

	if (brandPlacement === 'corner') {
		drawCornerBrand(ctx, {
			width,
			margin,
			logoImage: config.brandBar.showLogo ? logoImage : null,
			domain: config.brandBar.showDomain ? domain : '',
			textColor: config.brandBar.textColor || '#FFFFFF',
			fontFamily: config.typography.fontFamily,
		});
	}

	if (useBottomBar) {
		drawBrandBar(ctx, {
			width,
			height,
			margin,
			brandBar: {
				...config.brandBar,
				enabled: true,
			},
			logoImage,
			domain,
			fontFamily: config.typography.fontFamily,
		});
	}

	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error('Failed to export pin canvas'));
				return;
			}
			resolve(blob);
		}, 'image/png');
	});
}
