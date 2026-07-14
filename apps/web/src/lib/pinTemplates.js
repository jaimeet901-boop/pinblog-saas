export const PINTEREST_CANVAS_PRESETS = [
	{ label: 'Pinterest Standard 1000x1500', width: 1000, height: 1500 },
	{ label: 'Pinterest Tall 1000x2100', width: 1000, height: 2100 },
	{ label: 'Pinterest Story 1080x1920', width: 1080, height: 1920 },
];

export const TEMPLATE_VARIABLES = ['{{title}}', '{{description}}', '{{category}}', '{{website}}', '{{author}}'];

export function createDefaultTemplateConfig() {
	return {
		canvas: {
			width: 1000,
			height: 1500,
		},
		background: {
			color: '#F6F1E9',
			imageUrl: '',
			opacity: 1,
		},
		placeholders: {
			featuredImage: true,
			websiteLogo: true,
			backgroundPattern: false,
		},
		positions: {
			title: { x: 8, y: 10 },
			description: { x: 8, y: 28 },
			overlayText: { x: 8, y: 64 },
			logo: { x: 74, y: 88 },
		},
		typography: {
			fontFamily: 'Georgia',
			fontSize: 46,
			fontWeight: 700,
			textColor: '#1E1E1E',
		},
		buttonStyle: {
			background: '#D97706',
			textColor: '#FFFFFF',
			borderRadius: 18,
			padding: 12,
			shadow: true,
			opacity: 1,
		},
		container: {
			borderRadius: 30,
			padding: 28,
			shadow: true,
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

export function normalizeTemplateConfig(inputConfig) {
	const base = createDefaultTemplateConfig();
	const input = inputConfig && typeof inputConfig === 'object' ? inputConfig : {};

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
		positions: {
			title: normalizePosition(input?.positions?.title, base.positions.title),
			description: normalizePosition(input?.positions?.description, base.positions.description),
			overlayText: normalizePosition(input?.positions?.overlayText, base.positions.overlayText),
			logo: normalizePosition(input?.positions?.logo, base.positions.logo),
		},
		typography: {
			fontFamily: String(input?.typography?.fontFamily || base.typography.fontFamily),
			fontSize: clampNumber(input?.typography?.fontSize, 12, 140, base.typography.fontSize),
			fontWeight: clampNumber(input?.typography?.fontWeight, 300, 900, base.typography.fontWeight),
			textColor: String(input?.typography?.textColor || base.typography.textColor),
		},
		buttonStyle: {
			background: String(input?.buttonStyle?.background || base.buttonStyle.background),
			textColor: String(input?.buttonStyle?.textColor || base.buttonStyle.textColor),
			borderRadius: clampNumber(input?.buttonStyle?.borderRadius, 0, 80, base.buttonStyle.borderRadius),
			padding: clampNumber(input?.buttonStyle?.padding, 0, 64, base.buttonStyle.padding),
			shadow: Boolean(input?.buttonStyle?.shadow ?? base.buttonStyle.shadow),
			opacity: clampNumber(input?.buttonStyle?.opacity, 0, 1, base.buttonStyle.opacity),
		},
		container: {
			borderRadius: clampNumber(input?.container?.borderRadius, 0, 120, base.container.borderRadius),
			padding: clampNumber(input?.container?.padding, 0, 120, base.container.padding),
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

export function createTemplateThumbnail(config) {
	const safeConfig = normalizeTemplateConfig(config);
	const color = encodeURIComponent(safeConfig.background.color || '#f2f2f2');
	const text = encodeURIComponent('Template');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="${color}"/><rect x="18" y="18" width="264" height="414" rx="24" fill="rgba(255,255,255,0.82)"/><text x="28" y="90" fill="${safeConfig.typography.textColor}" font-family="${safeConfig.typography.fontFamily}" font-size="34" font-weight="${safeConfig.typography.fontWeight}">${text}</text></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
