/**
 * Local pin canvas renderer — featured image + template overlays.
 * No AI providers. Used for Featured Image mode.
 */

import { applyTemplateVariables, normalizeTemplateConfig } from '@/lib/pinTemplates';
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

/**
 * Fetch remote image via same-origin API proxy so canvas export is not tainted.
 */
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

function wrapText(ctx, text, maxWidth, maxLines = 6) {
	const words = String(text || '').trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const lines = [];
	let current = '';
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (ctx.measureText(next).width <= maxWidth) {
			current = next;
		} else {
			if (current) lines.push(current);
			current = word;
			if (lines.length >= maxLines) break;
		}
	}
	if (current && lines.length < maxLines) lines.push(current);
	if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
		const last = lines[maxLines - 1];
		lines[maxLines - 1] = `${last.replace(/\s+\S*$/, '')}…`;
	}
	return lines;
}

/**
 * Render a pin to a PNG Blob using featured image + template config.
 */
export async function renderFeaturedPinToBlob({
	featuredImageUrl,
	templateConfig,
	context = {},
	logoUrl = '',
	watermarkText = '',
}) {
	const config = normalizeTemplateConfig(templateConfig);
	const width = config.canvas.width;
	const height = config.canvas.height;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas is not available in this browser');
	}

	ctx.fillStyle = config.background.color || '#F6F1E9';
	ctx.fillRect(0, 0, width, height);

	if (featuredImageUrl) {
		const featured = await fetchImageForCanvas(featuredImageUrl);
		drawCoverImage(ctx, featured, width, height);
		const dim = Math.max(0, Math.min(1, 1 - Number(config.background.opacity ?? 1)));
		if (dim > 0) {
			ctx.fillStyle = `rgba(0,0,0,${dim})`;
			ctx.fillRect(0, 0, width, height);
		}
	}

	if (config.placeholders.backgroundPattern) {
		ctx.fillStyle = 'rgba(255,255,255,0.28)';
		for (let y = 0; y < height; y += 14) {
			for (let x = 0; x < width; x += 14) {
				ctx.beginPath();
				ctx.arc(x, y, 1, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	const baseContext = {
		title: context.title || 'Pin Title',
		description: context.description || '',
		category: context.category || '',
		website: context.website || '',
		author: context.author || '',
	};

	const pad = config.container.padding || 28;
	const maxTextWidth = width - pad * 2;
	const titleX = (config.positions.title.x / 100) * width;
	const titleY = (config.positions.title.y / 100) * height;
	const descX = (config.positions.description.x / 100) * width;
	const descY = (config.positions.description.y / 100) * height;
	const overlayX = (config.positions.overlayText.x / 100) * width;
	const overlayY = (config.positions.overlayText.y / 100) * height;
	const logoX = (config.positions.logo.x / 100) * width;
	const logoY = (config.positions.logo.y / 100) * height;

	ctx.textBaseline = 'top';
	ctx.fillStyle = config.typography.textColor;
	ctx.font = `${config.typography.fontWeight} ${config.typography.fontSize}px ${config.typography.fontFamily}`;
	const titleLines = wrapText(
		ctx,
		applyTemplateVariables('{{title}}', baseContext),
		Math.min(maxTextWidth, width - titleX - pad),
		5,
	);
	const titleLineHeight = config.typography.fontSize * 1.15;
	titleLines.forEach((line, index) => {
		ctx.fillText(line, titleX, titleY + index * titleLineHeight);
	});

	const descSize = Math.max(18, Math.round(config.typography.fontSize * 0.42));
	ctx.globalAlpha = 0.86;
	ctx.font = `${Math.max(400, config.typography.fontWeight - 200)} ${descSize}px ${config.typography.fontFamily}`;
	const descLines = wrapText(
		ctx,
		applyTemplateVariables('{{description}}', baseContext),
		Math.min(maxTextWidth, width - descX - pad),
		4,
	);
	const descLineHeight = descSize * 1.25;
	descLines.forEach((line, index) => {
		ctx.fillText(line, descX, descY + index * descLineHeight);
	});
	ctx.globalAlpha = 1;

	const overlayLabel = String(context.overlayText || 'Read More').trim() || 'Read More';
	const btnPad = config.buttonStyle.padding || 12;
	const btnFontSize = Math.max(18, Math.round(config.typography.fontSize * 0.38));
	ctx.font = `${config.typography.fontWeight} ${btnFontSize}px ${config.typography.fontFamily}`;
	const btnTextWidth = ctx.measureText(overlayLabel).width;
	const btnW = btnTextWidth + btnPad * 2;
	const btnH = btnFontSize + btnPad * 1.4;
	const btnRadius = config.buttonStyle.borderRadius || 18;

	ctx.globalAlpha = config.buttonStyle.opacity ?? 1;
	if (config.buttonStyle.shadow) {
		ctx.shadowColor = 'rgba(0,0,0,0.25)';
		ctx.shadowBlur = 18;
		ctx.shadowOffsetY = 8;
	}
	ctx.fillStyle = config.buttonStyle.background;
	ctx.beginPath();
	if (typeof ctx.roundRect === 'function') {
		ctx.roundRect(overlayX, overlayY, btnW, btnH, btnRadius);
	} else {
		ctx.rect(overlayX, overlayY, btnW, btnH);
	}
	ctx.fill();
	ctx.shadowColor = 'transparent';
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;
	ctx.fillStyle = config.buttonStyle.textColor;
	ctx.fillText(overlayLabel, overlayX + btnPad, overlayY + btnPad * 0.55);
	ctx.globalAlpha = 1;

	if (config.placeholders.websiteLogo && logoUrl) {
		try {
			const logo = await fetchImageForCanvas(logoUrl);
			const logoSize = Math.min(width, height) * 0.08;
			ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
		} catch {
			// Logo is optional — skip if unavailable
		}
	}

	if (watermarkText) {
		ctx.globalAlpha = 0.55;
		ctx.fillStyle = config.typography.textColor;
		ctx.font = `500 ${Math.max(14, Math.round(config.typography.fontSize * 0.28))}px ${config.typography.fontFamily}`;
		ctx.fillText(String(watermarkText).slice(0, 60), pad, height - pad - 24);
		ctx.globalAlpha = 1;
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
