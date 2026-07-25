export const PINTEREST_CANVAS_PRESETS = [
	{ label: 'Pinterest Standard 1000x1500', width: 1000, height: 1500 },
	{ label: 'Pinterest Tall 1000x2100', width: 1000, height: 2100 },
	{ label: 'Pinterest Story 1080x1920', width: 1080, height: 1920 },
];

export const TEMPLATE_VARIABLES = ['{{title}}', '{{description}}', '{{category}}', '{{website}}', '{{author}}'];

export const TEXT_POSITIONS = [
	{ id: 'top', label: 'Top' },
	{ id: 'center', label: 'Center' },
	{ id: 'bottom', label: 'Bottom' },
];

export const OVERLAY_STYLES = [
	{ id: 'gradient', label: 'Gradient' },
	{ id: 'dark', label: 'Dark scrim' },
	{ id: 'vignette', label: 'Vignette' },
	{ id: 'none', label: 'None' },
];

export const HEADING_FONT_PRESETS = [
	{ id: 'georgia', label: 'Georgia (classic)', value: 'Georgia, "Times New Roman", serif' },
	{ id: 'palatino', label: 'Palatino (editorial)', value: 'Palatino Linotype, Palatino, "Book Antiqua", serif' },
	{ id: 'impact', label: 'Impact (bold pin)', value: 'Impact, Haettenschweiler, "Arial Black", sans-serif' },
	{ id: 'arial-black', label: 'Arial Black', value: '"Arial Black", Gadget, sans-serif' },
	{ id: 'helvetica', label: 'Helvetica Bold', value: 'Helvetica Neue, Helvetica, Arial, sans-serif' },
];

export const SCRIPT_FONT_PRESETS = [
	{ id: 'segoe-script', label: 'Segoe Script', value: '"Segoe Script", "Brush Script MT", cursive' },
	{ id: 'brush', label: 'Brush Script', value: '"Brush Script MT", "Segoe Script", cursive' },
	{ id: 'georgia-italic', label: 'Georgia Italic', value: 'Georgia, "Times New Roman", serif' },
];

export function createDefaultTemplateConfig() {
	return {
		canvas: {
			width: 1000,
			height: 1500,
		},
		background: {
			color: '#111111',
			imageUrl: '',
			opacity: 1,
		},
		placeholders: {
			featuredImage: true,
			websiteLogo: true,
			backgroundPattern: false,
		},
		layout: {
			textPosition: 'bottom',
			textAlign: 'center',
			safeMargin: 72,
			showDescription: false,
			showCta: true,
			showBrandBar: true,
		},
		textOverlay: {
			style: 'gradient',
			intensity: 0.62,
			color: '#000000',
		},
		positions: {
			title: { x: 50, y: 58 },
			description: { x: 50, y: 72 },
			overlayText: { x: 50, y: 78 },
			logo: { x: 50, y: 92 },
		},
		typography: {
			fontFamily: 'Georgia, "Times New Roman", serif',
			fontSize: 78,
			minFontSize: 36,
			fontWeight: 800,
			textColor: '#FFFFFF',
			lineHeight: 1.12,
			letterSpacing: -0.8,
			maxLines: 5,
			textShadow: true,
			scriptEnabled: false,
			scriptFontFamily: '"Segoe Script", "Brush Script MT", cursive',
			scriptColor: '#FDE68A',
		},
		decorations: {
			brushHighlight: true,
			brushColor: '#F59E0B',
			brushOpacity: 0.88,
			roundedLabel: true,
			underline: false,
			underlineColor: '#FFFFFF',
			accentShapes: true,
			accentColor: '#FFFFFF',
		},
		brandBar: {
			enabled: true,
			showLogo: true,
			showDomain: true,
			background: 'rgba(0,0,0,0.42)',
			textColor: '#FFFFFF',
		},
		buttonStyle: {
			background: '#FFFFFF',
			textColor: '#111827',
			borderRadius: 999,
			padding: 16,
			shadow: true,
			opacity: 1,
		},
		container: {
			borderRadius: 0,
			padding: 72,
			shadow: false,
			opacity: 1,
		},
	};
}

function clampNumber(value, min, max, fallback) {
	const num = Number(value);
	if (!Number.isFinite(num)) {
		return fallback;
	}
	return Math.max(min, Math.min(max, num));
}

function normalizePosition(position, fallback) {
	const source = position && typeof position === 'object' ? position : fallback;
	return {
		x: clampNumber(source.x, 0, 100, fallback.x),
		y: clampNumber(source.y, 0, 100, fallback.y),
	};
}

function normalizeTextPosition(value, fallback = 'bottom') {
	const raw = String(value || '').toLowerCase();
	if (['top', 'center', 'bottom'].includes(raw)) return raw;
	return fallback;
}

function normalizeOverlayStyle(value, fallback = 'gradient') {
	const raw = String(value || '').toLowerCase();
	if (['gradient', 'dark', 'vignette', 'none'].includes(raw)) return raw;
	return fallback;
}

export function normalizeTemplateConfig(inputConfig) {
	const base = createDefaultTemplateConfig();
	const input = inputConfig && typeof inputConfig === 'object' ? inputConfig : {};
	const layoutInput = input.layout && typeof input.layout === 'object' ? input.layout : {};
	const overlayInput = input.textOverlay && typeof input.textOverlay === 'object' ? input.textOverlay : {};
	const decorationsInput = input.decorations && typeof input.decorations === 'object' ? input.decorations : {};
	const brandInput = input.brandBar && typeof input.brandBar === 'object' ? input.brandBar : {};
	const typographyInput = input.typography && typeof input.typography === 'object' ? input.typography : {};

	const textPosition = normalizeTextPosition(
		layoutInput.textPosition || input.textPosition,
		base.layout.textPosition,
	);

	// Migrate older absolute Y positions into a coarse textPosition when layout is missing.
	const legacyTitleY = Number(input?.positions?.title?.y);
	const migratedPosition = layoutInput.textPosition
		? textPosition
		: (Number.isFinite(legacyTitleY)
			? (legacyTitleY < 28 ? 'top' : legacyTitleY < 55 ? 'center' : 'bottom')
			: textPosition);

	return {
		canvas: {
			width: clampNumber(input?.canvas?.width, 400, 4000, base.canvas.width),
			height: clampNumber(input?.canvas?.height, 400, 6000, base.canvas.height),
		},
		background: {
			color: String(input?.background?.color || base.background.color),
			imageUrl: String(input?.background?.imageUrl || ''),
			opacity: clampNumber(input?.background?.opacity, 0, 1, base.background.opacity),
		},
		placeholders: {
			featuredImage: Boolean(input?.placeholders?.featuredImage ?? base.placeholders.featuredImage),
			websiteLogo: Boolean(input?.placeholders?.websiteLogo ?? base.placeholders.websiteLogo),
			backgroundPattern: Boolean(input?.placeholders?.backgroundPattern ?? base.placeholders.backgroundPattern),
		},
		layout: {
			textPosition: migratedPosition,
			textAlign: ['left', 'center', 'right'].includes(String(layoutInput.textAlign || '').toLowerCase())
				? String(layoutInput.textAlign).toLowerCase()
				: base.layout.textAlign,
			safeMargin: clampNumber(layoutInput.safeMargin ?? input?.container?.padding, 40, 160, base.layout.safeMargin),
			showDescription: Boolean(layoutInput.showDescription ?? base.layout.showDescription),
			showCta: Boolean(layoutInput.showCta ?? base.layout.showCta),
			showBrandBar: Boolean(layoutInput.showBrandBar ?? brandInput.enabled ?? base.layout.showBrandBar),
		},
		textOverlay: {
			style: normalizeOverlayStyle(overlayInput.style, base.textOverlay.style),
			intensity: clampNumber(overlayInput.intensity, 0, 1, base.textOverlay.intensity),
			color: String(overlayInput.color || base.textOverlay.color),
		},
		positions: {
			title: normalizePosition(input?.positions?.title, base.positions.title),
			description: normalizePosition(input?.positions?.description, base.positions.description),
			overlayText: normalizePosition(input?.positions?.overlayText, base.positions.overlayText),
			logo: normalizePosition(input?.positions?.logo, base.positions.logo),
		},
		typography: {
			fontFamily: String(typographyInput.fontFamily || base.typography.fontFamily),
			fontSize: clampNumber(typographyInput.fontSize, 24, 160, base.typography.fontSize),
			minFontSize: clampNumber(typographyInput.minFontSize, 18, 80, base.typography.minFontSize),
			fontWeight: clampNumber(typographyInput.fontWeight, 300, 900, base.typography.fontWeight),
			textColor: String(typographyInput.textColor || base.typography.textColor),
			lineHeight: clampNumber(typographyInput.lineHeight, 0.9, 1.6, base.typography.lineHeight),
			letterSpacing: clampNumber(typographyInput.letterSpacing, -4, 8, base.typography.letterSpacing),
			maxLines: clampNumber(typographyInput.maxLines, 2, 8, base.typography.maxLines),
			textShadow: Boolean(typographyInput.textShadow ?? base.typography.textShadow),
			scriptEnabled: Boolean(typographyInput.scriptEnabled ?? base.typography.scriptEnabled),
			scriptFontFamily: String(typographyInput.scriptFontFamily || base.typography.scriptFontFamily),
			scriptColor: String(typographyInput.scriptColor || base.typography.scriptColor),
		},
		decorations: {
			brushHighlight: Boolean(decorationsInput.brushHighlight ?? base.decorations.brushHighlight),
			brushColor: String(decorationsInput.brushColor || base.decorations.brushColor),
			brushOpacity: clampNumber(decorationsInput.brushOpacity, 0, 1, base.decorations.brushOpacity),
			roundedLabel: Boolean(decorationsInput.roundedLabel ?? base.decorations.roundedLabel),
			underline: Boolean(decorationsInput.underline ?? base.decorations.underline),
			underlineColor: String(decorationsInput.underlineColor || base.decorations.underlineColor),
			accentShapes: Boolean(decorationsInput.accentShapes ?? base.decorations.accentShapes),
			accentColor: String(decorationsInput.accentColor || base.decorations.accentColor),
		},
		brandBar: {
			enabled: Boolean(brandInput.enabled ?? layoutInput.showBrandBar ?? base.brandBar.enabled),
			showLogo: Boolean(brandInput.showLogo ?? input?.placeholders?.websiteLogo ?? base.brandBar.showLogo),
			showDomain: Boolean(brandInput.showDomain ?? base.brandBar.showDomain),
			background: String(brandInput.background || base.brandBar.background),
			textColor: String(brandInput.textColor || base.brandBar.textColor),
		},
		buttonStyle: {
			background: String(input?.buttonStyle?.background || base.buttonStyle.background),
			textColor: String(input?.buttonStyle?.textColor || base.buttonStyle.textColor),
			borderRadius: clampNumber(input?.buttonStyle?.borderRadius, 0, 999, base.buttonStyle.borderRadius),
			padding: clampNumber(input?.buttonStyle?.padding, 0, 64, base.buttonStyle.padding),
			shadow: Boolean(input?.buttonStyle?.shadow ?? base.buttonStyle.shadow),
			opacity: clampNumber(input?.buttonStyle?.opacity, 0, 1, base.buttonStyle.opacity),
		},
		container: {
			borderRadius: clampNumber(input?.container?.borderRadius, 0, 120, base.container.borderRadius),
			padding: clampNumber(input?.container?.padding, 0, 160, base.container.padding),
			shadow: Boolean(input?.container?.shadow ?? base.container.shadow),
			opacity: clampNumber(input?.container?.opacity, 0.05, 1, base.container.opacity),
		},
	};
}

export function applyTemplateVariables(value, context) {
	const raw = String(value || '');
	return raw
		.replaceAll('{{title}}', context.title || '')
		.replaceAll('{{description}}', context.description || '')
		.replaceAll('{{category}}', context.category || '')
		.replaceAll('{{website}}', context.website || '')
		.replaceAll('{{author}}', context.author || '');
}

export function resolveTitleBand(config) {
	const position = config?.layout?.textPosition || 'bottom';
	if (position === 'top') {
		return { start: 0.10, end: 0.42 };
	}
	if (position === 'center') {
		return { start: 0.32, end: 0.68 };
	}
	return { start: 0.48, end: 0.78 };
}

export function formatPinDomain(website) {
	const raw = String(website || '').trim();
	if (!raw) return '';
	try {
		const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
		const host = new URL(withProtocol).hostname.replace(/^www\./i, '');
		return host || raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
	} catch {
		return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
	}
}

function luminance(hexColor) {
	const hex = String(hexColor || '').replace('#', '');
	const full = hex.length === 3
		? hex.split('').map((ch) => ch + ch).join('')
		: hex.padEnd(6, '0').slice(0, 6);
	if (!/^[0-9a-fA-F]{6}$/.test(full)) return 1;
	const r = Number.parseInt(full.slice(0, 2), 16) / 255;
	const g = Number.parseInt(full.slice(2, 4), 16) / 255;
	const b = Number.parseInt(full.slice(4, 6), 16) / 255;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Force BlogToPin-style chrome for Featured Image canvas renders.
 * Legacy saved templates often have dark title text / no overlay and would
 * look like a plain photo if used as-is over a featured image.
 */
export function resolveFeaturedTemplateConfig(inputConfig) {
	const base = createDefaultTemplateConfig();
	const normalized = normalizeTemplateConfig(inputConfig);
	const darkTitle = luminance(normalized.typography.textColor) < 0.55;

	return normalizeTemplateConfig({
		...normalized,
		canvas: { width: 1000, height: 1500 },
		typography: {
			...normalized.typography,
			textColor: darkTitle ? base.typography.textColor : normalized.typography.textColor,
			fontSize: Math.max(normalized.typography.fontSize, 64),
			fontWeight: Math.max(normalized.typography.fontWeight, 700),
			textShadow: true,
			maxLines: normalized.typography.maxLines || 5,
		},
		textOverlay: {
			...normalized.textOverlay,
			style: normalized.textOverlay.style === 'none' ? 'gradient' : normalized.textOverlay.style,
			intensity: Math.max(Number(normalized.textOverlay.intensity) || 0, 0.58),
		},
		layout: {
			...normalized.layout,
			showBrandBar: true,
			showCta: normalized.layout.showCta !== false,
			safeMargin: Math.max(normalized.layout.safeMargin || 0, 64),
		},
		decorations: {
			...normalized.decorations,
			brushHighlight: normalized.decorations.brushHighlight !== false,
			roundedLabel: normalized.decorations.roundedLabel !== false,
		},
		brandBar: {
			...normalized.brandBar,
			enabled: true,
			showLogo: normalized.brandBar.showLogo !== false,
			showDomain: normalized.brandBar.showDomain !== false,
		},
	});
}

export function createTemplateThumbnail(config) {
	const safeConfig = normalizeTemplateConfig(config);
	const color = encodeURIComponent(safeConfig.background.color || '#111111');
	const text = encodeURIComponent('Pin Title');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="40%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="rgba(0,0,0,0.75)"/></linearGradient></defs><rect width="300" height="450" fill="${color}"/><rect width="300" height="450" fill="url(#g)"/><rect x="36" y="250" width="228" height="28" rx="8" fill="${encodeURIComponent(safeConfig.decorations.brushColor)}" opacity="0.85"/><text x="150" y="270" text-anchor="middle" fill="${safeConfig.typography.textColor}" font-family="${safeConfig.typography.fontFamily}" font-size="28" font-weight="${safeConfig.typography.fontWeight}">${text}</text></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
