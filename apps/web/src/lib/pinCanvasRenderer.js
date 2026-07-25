/**
 * Professional Pinterest-style Featured Image composer (local canvas only).
 * BlogToPin-inspired: full-bleed photo, readability overlay, large title,
 * decorations, brand bar — no AI image generation.
 */

import {
	applyTemplateVariables,
	formatPinDomain,
	resolveFeaturedTemplateConfig,
	resolveTitleBand,
} from '@/lib/pinTemplates';
import { API_SERVER_URL } from '@/lib/apiServerClient';
import { getPocketbaseAuthHeader } from '@/lib/pocketbaseClient';

function loadImageFromUrl(url) {
	return new Promise((resolve, reject) => {
		if (!url) {
			reject(new Error('Image URL is empty'));
			return;
		}
		const img = new Image();
		img.decoding = 'async';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`Failed to load image: ${url.slice(0, 120)}`));
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
	const objectUrl = URL.createObjectURL(blob);
	try {
		return await loadImageFromUrl(objectUrl);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

function drawCoverImage(ctx, img, width, height) {
	const scale = Math.max(width / img.width, height / img.height);
	const drawW = img.width * scale;
	const drawH = img.height * scale;
	const x = (width - drawW) / 2;
	const y = (height - drawH) / 2;
	ctx.drawImage(img, x, y, drawW, drawH);
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
	width, height, margin, color, position,
}) {
	ctx.save();
	ctx.fillStyle = color;
	ctx.globalAlpha = 0.55;
	const size = Math.max(10, width * 0.018);
	if (position === 'top') {
		ctx.beginPath();
		ctx.arc(width - margin - size, margin + size * 2, size, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 0.35;
		roundRectPath(ctx, margin, margin + size * 0.5, size * 3.2, size * 0.45, size);
		ctx.fill();
	} else if (position === 'center') {
		ctx.globalAlpha = 0.4;
		roundRectPath(ctx, width / 2 - size * 2, height * 0.3 - size, size * 4, size * 0.4, size);
		ctx.fill();
	} else {
		ctx.beginPath();
		ctx.arc(margin + size * 1.2, height * 0.46, size * 0.7, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 0.3;
		roundRectPath(ctx, width - margin - size * 3.5, height * 0.5, size * 3.2, size * 0.4, size);
		ctx.fill();
	}
	ctx.restore();
}

function drawRoundedLabel(ctx, {
	text, x, y, align = 'center', background, textColor, fontFamily, padding = 14,
}) {
	const label = String(text || '').trim();
	if (!label) return { height: 0 };
	const fontSize = 22;
	ctx.font = `700 ${fontSize}px ${fontFamily}`;
	const textWidth = ctx.measureText(label).width;
	const w = textWidth + padding * 2.2;
	const h = fontSize + padding * 1.1;
	const drawX = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
	ctx.save();
	if (ctx.shadowBlur !== undefined) {
		ctx.shadowColor = 'rgba(0,0,0,0.25)';
		ctx.shadowBlur = 12;
		ctx.shadowOffsetY = 4;
	}
	ctx.fillStyle = background;
	roundRectPath(ctx, drawX, y, w, h, h / 2);
	ctx.fill();
	ctx.shadowColor = 'transparent';
	ctx.shadowBlur = 0;
	ctx.fillStyle = textColor;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	ctx.fillText(label, drawX + padding * 1.1, y + h / 2 + 1);
	ctx.restore();
	return { height: h + 16, width: w };
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
 */
export async function renderFeaturedPinToBlob({
	featuredImageUrl,
	templateConfig,
	context = {},
	logoUrl = '',
	watermarkText = '',
	websiteDomain = '',
}) {
	const config = resolveFeaturedTemplateConfig(templateConfig);
	const width = 1000;
	const height = 1500;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas is not available in this browser');
	}

	ctx.fillStyle = config.background.color || '#111111';
	ctx.fillRect(0, 0, width, height);

	if (featuredImageUrl) {
		const featured = await fetchImageForCanvas(featuredImageUrl);
		drawCoverImage(ctx, featured, width, height);
	}

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
		category: context.category || '',
		website: context.website || websiteDomain || '',
		author: context.author || '',
	};

	const titleText = applyTemplateVariables('{{title}}', baseContext).trim() || 'Pin Title';
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
		});
	}

	if (frameStyle === 'magazine') {
		drawMagazineFrame(ctx, { margin, width, height, brandReserved });
	}

	let cursorY = bandTop;
	const framePad = frameStyle === 'whiteCard' || frameStyle === 'darkBox' ? 36 : 0;
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
	const labelReserve = (config.decorations.roundedLabel && ctaLabel && ctaPosition !== 'bottom' && ctaPosition !== 'none') ? 56 : 0;
	const ctaReserve = (config.layout.showCta && ctaPosition === 'inside-frame' && ctaLabel) ? 70 : 0;
	const brandInsideReserve = brandPlacement === 'inside-card' ? 48 : 0;
	const frameHeight = probeBlockH + labelReserve + ctaReserve + brandInsideReserve + framePad * 2 + 28;
	const frameWidth = width - margin * 2;
	const frameX = margin;
	let frameY = bandTop + Math.max(0, ((bandBottom - bandTop) - frameHeight) * 0.35);

	if (frameStyle === 'darkBox') {
		drawDarkTitleBox(ctx, { x: frameX, y: frameY, width: frameWidth, height: frameHeight, radius: 28 });
		cursorY = frameY + framePad + 8;
	} else if (frameStyle === 'whiteCard') {
		drawWhiteCard(ctx, { x: frameX, y: frameY, width: frameWidth, height: frameHeight, radius: 36 });
		cursorY = frameY + framePad + 8;
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
		const labelResult = drawRoundedLabel(ctx, {
			text: ctaLabel.slice(0, 42),
			x: align === 'left' ? margin + framePad : align === 'right' ? width - margin - framePad : centerX,
			y: cursorY,
			align,
			background: config.buttonStyle.background,
			textColor: config.buttonStyle.textColor,
			fontFamily: config.typography.fontFamily,
			padding: Math.max(10, config.buttonStyle.padding * 0.7),
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
	if (config.typography.textShadow && frameStyle !== 'whiteCard') {
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
		ctx.lineWidth = Math.max(3, fitted.fontSize * 0.06);
		ctx.lineCap = 'round';
		const underlineW = Math.min(longest * 0.55, textMaxWidth * 0.45);
		const ux = align === 'left' ? textX : align === 'right' ? textX - underlineW : centerX - underlineW / 2;
		const uy = titleBottom + 14;
		ctx.beginPath();
		ctx.moveTo(ux, uy);
		ctx.lineTo(ux + underlineW, uy);
		ctx.stroke();
		ctx.restore();
	}

	let afterTitleY = titleBottom + (config.decorations.underline ? 36 : 22);

	if (config.layout.showDescription && baseContext.description) {
		const descSize = Math.max(20, Math.round(fitted.fontSize * 0.3));
		ctx.save();
		ctx.font = `500 ${descSize}px ${config.typography.fontFamily}`;
		ctx.fillStyle = config.typography.textColor;
		ctx.globalAlpha = 0.88;
		ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
		ctx.textBaseline = 'top';
		const descLines = wrapTitleBalanced(ctx, baseContext.description, textMaxWidth, 3);
		descLines.forEach((line, index) => {
			ctx.fillText(line, textX, afterTitleY + index * descSize * 1.25);
		});
		afterTitleY += descLines.length * descSize * 1.25 + 18;
		ctx.restore();
	}

	if (config.layout.showCta && ctaLabel && (ctaPosition === 'below-title' || ctaPosition === 'inside-frame') && !config.decorations.roundedLabel) {
		drawRoundedLabel(ctx, {
			text: ctaLabel.slice(0, 48),
			x: textX,
			y: Math.min(afterTitleY, height - brandReserved - 70),
			align,
			background: config.buttonStyle.background,
			textColor: config.buttonStyle.textColor,
			fontFamily: config.typography.fontFamily,
			padding: config.buttonStyle.padding,
		});
		afterTitleY += 64;
	} else if (config.layout.showCta && ctaLabel && ctaPosition === 'inside-frame' && config.decorations.roundedLabel) {
		drawRoundedLabel(ctx, {
			text: ctaLabel.slice(0, 42),
			x: centerX,
			y: Math.min(afterTitleY, frameY + frameHeight - framePad - 52),
			align: 'center',
			background: config.buttonStyle.background,
			textColor: config.buttonStyle.textColor,
			fontFamily: config.typography.fontFamily,
			padding: config.buttonStyle.padding,
		});
		afterTitleY += 60;
	}

	if (config.layout.showCta && ctaLabel && ctaPosition === 'bottom') {
		drawRoundedLabel(ctx, {
			text: ctaLabel.slice(0, 48),
			x: centerX,
			y: height - brandReserved - 78,
			align: 'center',
			background: config.buttonStyle.background,
			textColor: config.buttonStyle.textColor,
			fontFamily: config.typography.fontFamily,
			padding: config.buttonStyle.padding,
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
