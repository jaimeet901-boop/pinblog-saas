/**
 * Premium Pinterest Design System — reusable design tokens.
 * Layouts compose from these tokens; do not hardcode one-off styles.
 */

export const PIN_SAFE_MARGIN = Object.freeze({
	tight: 72,
	standard: 88,
	generous: 104,
	luxury: 120,
});

export const PIN_SPACING = Object.freeze({
	gapAfterCta: 28,
	gapAfterTitle: 26,
	gapAfterSubtitle: 22,
	gapAfterUnderline: 40,
	brandBarHeight: 100,
	ctaReserve: 78,
	subtitleReserve: 44,
});

/** 22 professional font pairings (heading + script/accent). */
export const PIN_FONT_PAIRS = Object.freeze([
	{ id: 'georgia-script', label: 'Georgia + Script', heading: 'Georgia, "Times New Roman", serif', script: '"Segoe Script", "Brush Script MT", cursive', mood: 'classic' },
	{ id: 'palatino-georgia', label: 'Palatino Editorial', heading: 'Palatino Linotype, Palatino, "Book Antiqua", serif', script: 'Georgia, "Times New Roman", serif', mood: 'editorial' },
	{ id: 'century-georgia', label: 'Century Minimal', heading: '"Century Gothic", "Apple Gothic", sans-serif', script: 'Georgia, "Times New Roman", serif', mood: 'minimal' },
	{ id: 'trebuchet-script', label: 'Trebuchet Modern', heading: '"Trebuchet MS", "Segoe UI", sans-serif', script: '"Segoe Script", "Brush Script MT", cursive', mood: 'modern' },
	{ id: 'impact-georgia', label: 'Impact Bold', heading: 'Impact, Haettenschweiler, "Arial Black", sans-serif', script: 'Georgia, "Times New Roman", serif', mood: 'impact' },
	{ id: 'arial-black-brush', label: 'Arial Black + Brush', heading: '"Arial Black", Gadget, sans-serif', script: '"Brush Script MT", "Segoe Script", cursive', mood: 'bold' },
	{ id: 'garamond-script', label: 'Garamond Luxury', heading: 'Garamond, "Times New Roman", serif', script: '"Segoe Script", "Brush Script MT", cursive', mood: 'luxury' },
	{ id: 'baskerville-italic', label: 'Baskerville Soft', heading: 'Baskerville, "Times New Roman", serif', script: 'Georgia, "Times New Roman", serif', mood: 'soft' },
	{ id: 'cambria-script', label: 'Cambria Warm', heading: 'Cambria, Georgia, serif', script: '"Segoe Script", cursive', mood: 'warm' },
	{ id: 'verdana-georgia', label: 'Verdana Clean', heading: 'Verdana, Geneva, sans-serif', script: 'Georgia, "Times New Roman", serif', mood: 'clean' },
	{ id: 'tahoma-script', label: 'Tahoma Fresh', heading: 'Tahoma, Geneva, sans-serif', script: '"Segoe Script", cursive', mood: 'fresh' },
	{ id: 'lucida-georgia', label: 'Lucida Bright', heading: '"Lucida Bright", Georgia, serif', script: 'Georgia, italic', mood: 'bright' },
	{ id: 'copperplate-georgia', label: 'Copperplate Luxe', heading: 'Copperplate, "Copperplate Gothic Light", fantasy', script: 'Georgia, "Times New Roman", serif', mood: 'luxe' },
	{ id: 'optima-script', label: 'Optima Elegant', heading: 'Optima, Candara, sans-serif', script: '"Segoe Script", cursive', mood: 'elegant' },
	{ id: 'futura-georgia', label: 'Futura Geometric', heading: 'Futura, "Trebuchet MS", sans-serif', script: 'Georgia, "Times New Roman", serif', mood: 'geometric' },
	{ id: 'didot-script', label: 'Didot Fashion', heading: 'Didot, "Bodoni MT", serif', script: '"Segoe Script", cursive', mood: 'fashion' },
	{ id: 'rockwell-georgia', label: 'Rockwell Strong', heading: 'Rockwell, "Courier New", serif', script: 'Georgia, "Times New Roman", serif', mood: 'strong' },
	{ id: 'gill-script', label: 'Gill Sans Soft', heading: '"Gill Sans", "Trebuchet MS", sans-serif', script: '"Brush Script MT", cursive', mood: 'friendly' },
	{ id: 'perpetua-script', label: 'Perpetua Classic', heading: 'Perpetua, Georgia, serif', script: '"Segoe Script", cursive', mood: 'classic' },
	{ id: 'candara-georgia', label: 'Candara Airy', heading: 'Candara, Calibri, sans-serif', script: 'Georgia, "Times New Roman", serif', mood: 'airy' },
	{ id: 'constantia-script', label: 'Constantia Rich', heading: 'Constantia, Georgia, serif', script: '"Segoe Script", cursive', mood: 'rich' },
	{ id: 'segoe-ui-script', label: 'Segoe UI Crisp', heading: '"Segoe UI", Calibri, sans-serif', script: '"Segoe Script", cursive', mood: 'crisp' },
]);

/** Recipe-family color palettes (multiple variants each). */
export const PIN_PALETTES = Object.freeze({
	dessert: [
		{ id: 'rose-gold', primary: '#9F1239', secondary: '#FFE4E6', accent: '#E8B86D', text: '#FFF8F1', overlay: '#3F0A1A', ctaBg: '#FFF7ED', ctaText: '#9F1239', brush: '#BE123C', brandBar: 'rgba(63,10,26,0.52)' },
		{ id: 'cocoa-cream', primary: '#7C2D12', secondary: '#FFEDD5', accent: '#D6B17A', text: '#FFFBEB', overlay: '#1C1917', ctaBg: '#FEF3C7', ctaText: '#7C2D12', brush: '#A16207', brandBar: 'rgba(28,25,23,0.55)' },
		{ id: 'berry-blush', primary: '#BE185D', secondary: '#FCE7F3', accent: '#F9A8D4', text: '#FFF1F2', overlay: '#500724', ctaBg: '#FFFFFF', ctaText: '#9D174D', brush: '#DB2777', brandBar: 'rgba(80,7,36,0.5)' },
	],
	healthy: [
		{ id: 'sage-fresh', primary: '#166534', secondary: '#DCFCE7', accent: '#86EFAC', text: '#FFFFFF', overlay: '#052E16', ctaBg: '#FFFFFF', ctaText: '#14532D', brush: '#16A34A', brandBar: 'rgba(5,46,22,0.48)' },
		{ id: 'olive-clean', primary: '#3F6212', secondary: '#ECFCCB', accent: '#A3E635', text: '#F7FEE7', overlay: '#1A2E05', ctaBg: '#F7FEE7', ctaText: '#365314', brush: '#65A30D', brandBar: 'rgba(26,46,5,0.48)' },
		{ id: 'mint-air', primary: '#0F766E', secondary: '#CCFBF1', accent: '#5EEAD4', text: '#F0FDFA', overlay: '#134E4A', ctaBg: '#FFFFFF', ctaText: '#115E59', brush: '#14B8A6', brandBar: 'rgba(19,78,74,0.48)' },
	],
	dinner: [
		{ id: 'amber-hearth', primary: '#7C2D12', secondary: '#FFEDD5', accent: '#C4A574', text: '#FFF7ED', overlay: '#1C1917', ctaBg: '#C4A574', ctaText: '#1C1917', brush: '#9A3412', brandBar: 'rgba(28,25,23,0.62)' },
		{ id: 'wine-savory', primary: '#7F1D1D', secondary: '#FEE2E2', accent: '#E8B86D', text: '#FFF7ED', overlay: '#450A0A', ctaBg: '#FFF7ED', ctaText: '#7F1D1D', brush: '#B91C1C', brandBar: 'rgba(69,10,10,0.55)' },
		{ id: 'espresso', primary: '#44403C', secondary: '#E7E5E4', accent: '#D6B17A', text: '#FAFAF9', overlay: '#1C1917', ctaBg: '#D6B17A', ctaText: '#1C1917', brush: '#78716C', brandBar: 'rgba(28,25,23,0.65)' },
	],
	breakfast: [
		{ id: 'honey-sun', primary: '#B45309', secondary: '#FEF3C7', accent: '#F5E6C8', text: '#FFFFFF', overlay: '#78350F', ctaBg: '#FFFFFF', ctaText: '#92400E', brush: '#D97706', brandBar: 'rgba(120,53,15,0.48)' },
		{ id: 'butter-cream', primary: '#A16207', secondary: '#FEF9C3', accent: '#FDE68A', text: '#FFFBEB', overlay: '#713F12', ctaBg: '#FEF3C7', ctaText: '#854D0E', brush: '#CA8A04', brandBar: 'rgba(113,63,18,0.48)' },
		{ id: 'berry-morning', primary: '#9F1239', secondary: '#FFE4E6', accent: '#FDBA74', text: '#FFF7ED', overlay: '#4C0519', ctaBg: '#FFFFFF', ctaText: '#9F1239', brush: '#E11D48', brandBar: 'rgba(76,5,25,0.48)' },
	],
	drinks: [
		{ id: 'aqua-cool', primary: '#0E7490', secondary: '#CFFAFE', accent: '#67E8F9', text: '#ECFEFF', overlay: '#164E63', ctaBg: '#ECFEFF', ctaText: '#155E75', brush: '#0891B2', brandBar: 'rgba(22,78,99,0.52)' },
		{ id: 'citrus-spark', primary: '#CA8A04', secondary: '#FEF9C3', accent: '#FDE047', text: '#FFFFFF', overlay: '#422006', ctaBg: '#FFFFFF', ctaText: '#854D0E', brush: '#EAB308', brandBar: 'rgba(66,32,6,0.5)' },
		{ id: 'indigo-sip', primary: '#4338CA', secondary: '#E0E7FF', accent: '#A5B4FC', text: '#EEF2FF', overlay: '#1E1B4B', ctaBg: '#EEF2FF', ctaText: '#3730A3', brush: '#6366F1', brandBar: 'rgba(30,27,75,0.52)' },
	],
	snacks: [
		{ id: 'chili-crave', primary: '#B91C1C', secondary: '#FEE2E2', accent: '#FDBA74', text: '#FFFFFF', overlay: '#450A0A', ctaBg: '#FFFFFF', ctaText: '#991B1B', brush: '#DC2626', brandBar: 'rgba(69,10,10,0.52)' },
		{ id: 'nacho-gold', primary: '#C2410C', secondary: '#FFEDD5', accent: '#FDBA74', text: '#FFF7ED', overlay: '#431407', ctaBg: '#FFF7ED', ctaText: '#9A3412', brush: '#EA580C', brandBar: 'rgba(67,20,7,0.5)' },
	],
	general: [
		{ id: 'warm-classic', primary: '#92400E', secondary: '#FEF3C7', accent: '#E8B86D', text: '#FFFFFF', overlay: '#1C1917', ctaBg: '#FFFFFF', ctaText: '#78350F', brush: '#B45309', brandBar: 'rgba(28,25,23,0.48)' },
		{ id: 'stone-neutral', primary: '#57534E', secondary: '#E7E5E4', accent: '#D6D3D1', text: '#FAFAF9', overlay: '#1C1917', ctaBg: '#FAFAF9', ctaText: '#292524', brush: '#78716C', brandBar: 'rgba(28,25,23,0.55)' },
	],
});

export const PIN_OVERLAY_TOKENS = Object.freeze({
	softGradient: { style: 'gradient', intensity: 0.42 },
	richGradient: { style: 'gradient', intensity: 0.62 },
	deepGradient: { style: 'gradient', intensity: 0.72 },
	softVignette: { style: 'vignette', intensity: 0.48 },
	richVignette: { style: 'vignette', intensity: 0.62 },
	softDark: { style: 'dark', intensity: 0.28 },
	richDark: { style: 'dark', intensity: 0.42 },
});

export const PIN_CTA_TOKENS = Object.freeze({
	pillLight: { background: '#FFFFFF', textColor: '#1C1917', borderRadius: 999, padding: 18, shadow: true, variant: 'pill' },
	pillDark: { background: '#1C1917', textColor: '#FFFFFF', borderRadius: 999, padding: 18, shadow: true, variant: 'pill' },
	pillGold: { background: '#E8B86D', textColor: '#1C1917', borderRadius: 999, padding: 17, shadow: true, variant: 'pill' },
	pillSoft: { background: 'rgba(255,255,255,0.94)', textColor: '#1C1917', borderRadius: 999, padding: 16, shadow: false, variant: 'pill' },
	capsuleWarm: { background: '#C4A574', textColor: '#1C1917', borderRadius: 18, padding: 18, shadow: true, variant: 'capsule' },
	sharpBadge: { background: '#B91C1C', textColor: '#FFFFFF', borderRadius: 8, padding: 16, shadow: true, variant: 'sharp' },
	squareClean: { background: '#FFFFFF', textColor: '#1C1917', borderRadius: 0, padding: 14, shadow: false, variant: 'square' },
	outlineLight: { background: 'rgba(255,255,255,0.12)', textColor: '#FFFFFF', borderRadius: 999, padding: 16, shadow: false, variant: 'outline' },
});

export const PIN_ACCENT_STYLES = Object.freeze([
	'none', 'orbits', 'arcs', 'diamonds', 'corner', 'dots', 'slash', 'flourish', 'rule', 'spark', 'brackets',
]);

export const PIN_FRAME_STYLES = Object.freeze([
	'none', 'darkBox', 'whiteCard', 'softCard', 'glassCard', 'ribbon', 'bannerStrip', 'magazine', 'polaroid', 'insetFrame',
]);

export const PIN_TYPOGRAPHY_SCALE = Object.freeze({
	hero: { fontSize: 104, minFontSize: 52, fontWeight: 800, lineHeight: 1.02, letterSpacing: -1.8, maxLines: 2 },
	display: { fontSize: 92, minFontSize: 46, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.4, maxLines: 3 },
	editorial: { fontSize: 82, minFontSize: 42, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.6, maxLines: 3 },
	card: { fontSize: 72, minFontSize: 38, fontWeight: 700, lineHeight: 1.12, letterSpacing: -0.4, maxLines: 3 },
	minimal: { fontSize: 66, minFontSize: 36, fontWeight: 600, lineHeight: 1.16, letterSpacing: 1.8, maxLines: 3 },
	impact: { fontSize: 112, minFontSize: 54, fontWeight: 900, lineHeight: 0.96, letterSpacing: -2.2, maxLines: 2 },
	scriptLead: { fontSize: 80, minFontSize: 40, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.5, maxLines: 3 },
});

/**
 * Dynamic spacing from headline length (word count / visual weight).
 */
export function resolveDynamicSpacing({ wordCount = 4, lineHint = 2 } = {}) {
	const words = Math.max(1, Number(wordCount) || 4);
	const lines = Math.max(1, Number(lineHint) || 2);
	if (words <= 3 && lines <= 2) {
		return {
			safeMargin: PIN_SAFE_MARGIN.luxury,
			gapAfterTitle: 32,
			titleScaleBoost: 1.08,
			subtitleOpacity: 0.88,
		};
	}
	if (words <= 4) {
		return {
			safeMargin: PIN_SAFE_MARGIN.generous,
			gapAfterTitle: 28,
			titleScaleBoost: 1.04,
			subtitleOpacity: 0.86,
		};
	}
	if (words <= 5) {
		return {
			safeMargin: PIN_SAFE_MARGIN.standard,
			gapAfterTitle: 24,
			titleScaleBoost: 1,
			subtitleOpacity: 0.84,
		};
	}
	return {
		safeMargin: PIN_SAFE_MARGIN.tight,
		gapAfterTitle: 20,
		titleScaleBoost: 0.94,
		subtitleOpacity: 0.8,
	};
}

export function getFontPairById(id) {
	return PIN_FONT_PAIRS.find((item) => item.id === id) || PIN_FONT_PAIRS[0];
}

export function getPaletteVariants(family) {
	return PIN_PALETTES[family] || PIN_PALETTES.general;
}

export function hashPick(seed, list) {
	const items = Array.isArray(list) ? list.filter(Boolean) : [];
	if (items.length === 0) return null;
	let hash = 2166136261;
	const text = String(seed || '');
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return items[(hash >>> 0) % items.length];
}

/**
 * Compose a layout patch from design tokens.
 */
export function composeLayoutPatch({
	fontPairId = 'georgia-script',
	typeScale = 'display',
	overlay = 'richGradient',
	cta = 'pillLight',
	frameStyle = 'none',
	textPosition = 'bottom',
	textAlign = 'center',
	ctaPosition = 'below-title',
	brandPlacement = 'bottom-bar',
	showCta = true,
	showSubtitle = true,
	showBrandBar = true,
	brushHighlight = false,
	roundedLabel = true,
	underline = false,
	accentShapes = true,
	accentStyle = 'orbits',
	scriptEnabled = false,
	safeMargin = PIN_SAFE_MARGIN.generous,
	foodFocusY = 0.38,
	textColor = '#FFFFFF',
	underlineColor = '#FFFFFF',
	brushColor = '#E8B86D',
	accentColor = '#FFFFFF',
	brushOpacity = 0.82,
	brandBarBg = 'rgba(0,0,0,0.42)',
	brandBarText = '#FFFFFF',
} = {}) {
	const pair = getFontPairById(fontPairId);
	const scale = PIN_TYPOGRAPHY_SCALE[typeScale] || PIN_TYPOGRAPHY_SCALE.display;
	const overlayToken = PIN_OVERLAY_TOKENS[overlay] || PIN_OVERLAY_TOKENS.richGradient;
	const ctaToken = PIN_CTA_TOKENS[cta] || PIN_CTA_TOKENS.pillLight;

	return {
		layout: {
			textPosition,
			textAlign,
			showCta,
			showBrandBar,
			showDescription: false,
			showSubtitle,
			frameStyle,
			ctaPosition,
			brandPlacement,
			safeMargin,
			foodFocusY,
		},
		textOverlay: {
			style: overlayToken.style,
			intensity: overlayToken.intensity,
			color: '#000000',
		},
		typography: {
			fontFamily: pair.heading,
			fontSize: scale.fontSize,
			minFontSize: scale.minFontSize,
			fontWeight: scale.fontWeight,
			textColor,
			lineHeight: scale.lineHeight,
			letterSpacing: scale.letterSpacing,
			maxLines: scale.maxLines,
			textShadow: frameStyle !== 'whiteCard' && frameStyle !== 'softCard' && frameStyle !== 'polaroid',
			scriptEnabled,
			scriptFontFamily: pair.script,
			scriptColor: brushColor,
		},
		decorations: {
			brushHighlight,
			brushColor,
			brushOpacity,
			roundedLabel,
			underline,
			underlineColor,
			accentShapes,
			accentStyle,
			accentColor,
		},
		buttonStyle: { ...ctaToken },
		brandBar: {
			enabled: showBrandBar && brandPlacement === 'bottom-bar',
			showLogo: brandPlacement !== 'hidden',
			showDomain: brandPlacement !== 'hidden',
			background: brandBarBg,
			textColor: brandBarText,
		},
	};
}
