/**
 * Distinct Pinterest pin layout catalog (BlogToPin / Canva style variety).
 * Premium presets: larger type, more whitespace, luxury font stacks, short headlines.
 */

import { createDefaultTemplateConfig, normalizeTemplateConfig } from '@/lib/pinTemplates';

export const PIN_LAYOUT_CATALOG = [
	{
		id: 'centered_hero',
		label: 'Big centered title',
		tags: ['hero', 'short', 'bold'],
		patch: {
			layout: { textPosition: 'center', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, showSubtitle: true, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 96, foodFocusY: 0.38 },
			textOverlay: { style: 'vignette', intensity: 0.62, color: '#000000' },
			typography: { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 98, minFontSize: 48, fontWeight: 800, textColor: '#FFFFFF', lineHeight: 1.05, letterSpacing: -1.6, maxLines: 3, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: true, underline: false, accentShapes: true, accentStyle: 'orbits', brushColor: '#E8B86D', accentColor: '#FFFFFF' },
			buttonStyle: { background: '#FFFFFF', textColor: '#1C1917', borderRadius: 999, padding: 18, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.42)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'top_title_bottom_cta',
		label: 'Title top + CTA bottom',
		tags: ['editorial', 'long', 'recipe'],
		patch: {
			layout: { textPosition: 'top', textAlign: 'left', showCta: true, showBrandBar: true, showDescription: false, showSubtitle: true, frameStyle: 'none', ctaPosition: 'bottom', brandPlacement: 'bottom-bar', safeMargin: 88, foodFocusY: 0.42 },
			textOverlay: { style: 'gradient', intensity: 0.68, color: '#000000' },
			typography: { fontFamily: 'Palatino Linotype, Palatino, "Book Antiqua", serif', fontSize: 84, minFontSize: 42, fontWeight: 700, textColor: '#FFFFFF', lineHeight: 1.1, letterSpacing: -0.6, maxLines: 3, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: false, underline: true, underlineColor: '#F5E6C8', accentShapes: true, accentStyle: 'corner', brushColor: '#C4A574', accentColor: '#F5E6C8' },
			buttonStyle: { background: '#C4A574', textColor: '#1C1917', borderRadius: 16, padding: 20, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.48)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'dark_title_box',
		label: 'Dark title box',
		tags: ['box', 'medium', 'contrast'],
		patch: {
			layout: { textPosition: 'center', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, showSubtitle: true, frameStyle: 'darkBox', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 80, foodFocusY: 0.4 },
			textOverlay: { style: 'gradient', intensity: 0.32, color: '#000000' },
			typography: { fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif', fontSize: 76, minFontSize: 40, fontWeight: 800, textColor: '#FFFFFF', lineHeight: 1.08, letterSpacing: -0.8, maxLines: 3, textShadow: false, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: true, underline: false, accentShapes: false, accentStyle: 'none', brushColor: '#111827', accentColor: '#FFFFFF' },
			buttonStyle: { background: '#E8B86D', textColor: '#1C1917', borderRadius: 999, padding: 16, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.52)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'white_rounded_card',
		label: 'White rounded card',
		tags: ['card', 'clean', 'recipe'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'center', showCta: true, showBrandBar: false, showDescription: false, showSubtitle: true, frameStyle: 'whiteCard', ctaPosition: 'inside-frame', brandPlacement: 'inside-card', safeMargin: 72, foodFocusY: 0.36 },
			textOverlay: { style: 'gradient', intensity: 0.36, color: '#000000' },
			typography: { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 72, minFontSize: 38, fontWeight: 700, textColor: '#1C1917', lineHeight: 1.12, letterSpacing: -0.4, maxLines: 3, textShadow: false, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: true, underline: false, accentShapes: false, accentStyle: 'none', brushColor: '#C4A574', accentColor: '#A16207' },
			buttonStyle: { background: '#1C1917', textColor: '#FFFFFF', borderRadius: 999, padding: 16, shadow: false },
			brandBar: { enabled: false, showLogo: true, showDomain: true, background: 'transparent', textColor: '#78716C' },
		},
	},
	{
		id: 'brush_stroke',
		label: 'Brush stroke headline',
		tags: ['brush', 'warm', 'food'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, showSubtitle: true, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 90, foodFocusY: 0.35 },
			textOverlay: { style: 'gradient', intensity: 0.6, color: '#000000' },
			typography: { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 90, minFontSize: 44, fontWeight: 800, textColor: '#FFFBEB', lineHeight: 1.06, letterSpacing: -1, maxLines: 3, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: true, brushColor: '#C4A574', brushOpacity: 0.88, roundedLabel: true, underline: false, accentShapes: true, accentStyle: 'arcs', accentColor: '#F5E6C8' },
			buttonStyle: { background: '#FFFFFF', textColor: '#78350F', borderRadius: 999, padding: 17, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.4)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'ribbon_banner',
		label: 'Ribbon banner',
		tags: ['ribbon', 'short', 'cta'],
		patch: {
			layout: { textPosition: 'center', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, showSubtitle: false, frameStyle: 'ribbon', ctaPosition: 'below-title', brandPlacement: 'corner', safeMargin: 80, foodFocusY: 0.4 },
			textOverlay: { style: 'dark', intensity: 0.24, color: '#000000' },
			typography: { fontFamily: '"Arial Black", Gadget, sans-serif', fontSize: 70, minFontSize: 36, fontWeight: 900, textColor: '#FFFFFF', lineHeight: 1.04, letterSpacing: 0.4, maxLines: 2, textShadow: false, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: false, underline: false, accentShapes: true, accentStyle: 'diamonds', brushColor: '#9F1239', accentColor: '#FFE4E6' },
			buttonStyle: { background: '#FFFFFF', textColor: '#9F1239', borderRadius: 10, padding: 16, shadow: true },
			brandBar: { enabled: false, showLogo: true, showDomain: true, background: 'transparent', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'magazine',
		label: 'Magazine style',
		tags: ['magazine', 'long', 'editorial'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'left', showCta: false, showBrandBar: true, showDescription: false, showSubtitle: true, frameStyle: 'magazine', ctaPosition: 'none', brandPlacement: 'bottom-bar', safeMargin: 84, foodFocusY: 0.38 },
			textOverlay: { style: 'gradient', intensity: 0.66, color: '#0C0A09' },
			typography: { fontFamily: 'Palatino Linotype, Palatino, "Book Antiqua", serif', fontSize: 82, minFontSize: 40, fontWeight: 700, textColor: '#FAFAF9', lineHeight: 1.12, letterSpacing: -0.3, maxLines: 3, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: false, underline: true, underlineColor: '#A8A29E', accentShapes: true, accentStyle: 'rule', accentColor: '#E7E5E4', brushColor: '#78716C' },
			buttonStyle: { background: '#FAFAF9', textColor: '#0C0A09', borderRadius: 4, padding: 14, shadow: false },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(12,10,9,0.72)', textColor: '#E7E5E4' },
		},
	},
	{
		id: 'minimal_modern',
		label: 'Minimal modern',
		tags: ['minimal', 'short', 'modern'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, showSubtitle: true, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 108, foodFocusY: 0.4 },
			textOverlay: { style: 'gradient', intensity: 0.44, color: '#000000' },
			typography: { fontFamily: '"Century Gothic", "Apple Gothic", sans-serif', fontSize: 68, minFontSize: 36, fontWeight: 600, textColor: '#FFFFFF', lineHeight: 1.16, letterSpacing: 2.2, maxLines: 3, textShadow: false, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: false, underline: true, underlineColor: '#FFFFFF', accentShapes: true, accentStyle: 'dots', brushColor: '#FFFFFF', accentColor: '#FFFFFF' },
			buttonStyle: { background: 'rgba(255,255,255,0.94)', textColor: '#1C1917', borderRadius: 0, padding: 14, shadow: false },
			brandBar: { enabled: true, showLogo: false, showDomain: true, background: 'rgba(0,0,0,0.26)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'bold_typography',
		label: 'Bold typography',
		tags: ['bold', 'short', 'impact'],
		patch: {
			layout: { textPosition: 'center', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, showSubtitle: false, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 72, foodFocusY: 0.42 },
			textOverlay: { style: 'dark', intensity: 0.4, color: '#000000' },
			typography: { fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif', fontSize: 108, minFontSize: 52, fontWeight: 900, textColor: '#FFFFFF', lineHeight: 0.96, letterSpacing: -2, maxLines: 2, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: true, underline: false, accentShapes: true, accentStyle: 'slash', brushColor: '#B91C1C', accentColor: '#FECACA' },
			buttonStyle: { background: '#B91C1C', textColor: '#FFFFFF', borderRadius: 8, padding: 18, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.5)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'handwritten_accent',
		label: 'Elegant handwritten accent',
		tags: ['script', 'elegant', 'dessert', 'medium'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, showSubtitle: true, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 92, foodFocusY: 0.36 },
			textOverlay: { style: 'gradient', intensity: 0.56, color: '#1C1917' },
			typography: {
				fontFamily: 'Georgia, "Times New Roman", serif',
				fontSize: 82,
				minFontSize: 40,
				fontWeight: 700,
				textColor: '#FFF7ED',
				lineHeight: 1.1,
				letterSpacing: -0.5,
				maxLines: 3,
				textShadow: true,
				scriptEnabled: true,
				scriptFontFamily: '"Segoe Script", "Brush Script MT", cursive',
				scriptColor: '#E8B86D',
			},
			decorations: { brushHighlight: true, brushColor: '#9F1239', brushOpacity: 0.72, roundedLabel: true, underline: false, accentShapes: true, accentStyle: 'flourish', accentColor: '#FBCFE8' },
			buttonStyle: { background: '#FFF7ED', textColor: '#9F1239', borderRadius: 999, padding: 17, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(28,25,23,0.52)', textColor: '#FEF3C7' },
		},
	},
];

export function getPinLayoutById(id) {
	return PIN_LAYOUT_CATALOG.find((item) => item.id === id) || null;
}

export function listPinLayoutIds() {
	return PIN_LAYOUT_CATALOG.map((item) => item.id);
}

function deepMerge(base, patch) {
	if (!patch || typeof patch !== 'object') return base;
	const out = { ...base };
	Object.keys(patch).forEach((key) => {
		const value = patch[key];
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			out[key] = deepMerge(base[key] && typeof base[key] === 'object' ? base[key] : {}, value);
		} else {
			out[key] = value;
		}
	});
	return out;
}

/**
 * Merge a catalog layout + optional brand kit into a renderable template config.
 */
export function applyPinLayoutToTemplateConfig(baseConfig, layoutId, { brandKit = null } = {}) {
	const layout = getPinLayoutById(layoutId) || PIN_LAYOUT_CATALOG[0];
	const base = normalizeTemplateConfig(baseConfig || createDefaultTemplateConfig());
	let merged = deepMerge(base, layout.patch || {});

	if (brandKit) {
		merged = deepMerge(merged, {
			decorations: {
				brushColor: brandKit.accentColor || merged.decorations.brushColor,
				accentColor: brandKit.secondaryColor || merged.decorations.accentColor,
			},
			typography: {
				fontFamily: brandKit.fontHeading || merged.typography.fontFamily,
			},
			buttonStyle: {
				background: brandKit.primaryColor && layout.id !== 'white_rounded_card'
					? (merged.buttonStyle.background === '#FFFFFF' ? merged.buttonStyle.background : brandKit.primaryColor)
					: merged.buttonStyle.background,
			},
		});
	}

	merged.layout = {
		...merged.layout,
		variantId: layout.id,
		variantLabel: layout.label,
	};

	return normalizeTemplateConfig({
		...merged,
		canvas: { width: 1000, height: 1500 },
	});
}
