/**
 * Distinct Pinterest pin layout catalog (BlogToPin / Canva style variety).
 * Each preset patches template config so the canvas renderer produces a unique look.
 */

import { createDefaultTemplateConfig, normalizeTemplateConfig } from '@/lib/pinTemplates';

export const PIN_LAYOUT_CATALOG = [
	{
		id: 'centered_hero',
		label: 'Big centered title',
		tags: ['hero', 'short', 'bold'],
		patch: {
			layout: { textPosition: 'center', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 80 },
			textOverlay: { style: 'vignette', intensity: 0.68, color: '#000000' },
			typography: { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 86, minFontSize: 40, fontWeight: 800, textColor: '#FFFFFF', lineHeight: 1.08, letterSpacing: -1.2, maxLines: 4, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: true, underline: false, accentShapes: true, brushColor: '#F59E0B', accentColor: '#FFFFFF' },
			buttonStyle: { background: '#FFFFFF', textColor: '#111827', borderRadius: 999, padding: 16, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.45)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'top_title_bottom_cta',
		label: 'Title top + CTA bottom',
		tags: ['editorial', 'long', 'recipe'],
		patch: {
			layout: { textPosition: 'top', textAlign: 'left', showCta: true, showBrandBar: true, showDescription: false, frameStyle: 'none', ctaPosition: 'bottom', brandPlacement: 'bottom-bar', safeMargin: 72 },
			textOverlay: { style: 'gradient', intensity: 0.72, color: '#000000' },
			typography: { fontFamily: 'Palatino Linotype, Palatino, "Book Antiqua", serif', fontSize: 72, minFontSize: 36, fontWeight: 700, textColor: '#FFFFFF', lineHeight: 1.14, letterSpacing: -0.4, maxLines: 5, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: false, underline: true, underlineColor: '#FDE68A', accentShapes: false, brushColor: '#F59E0B', accentColor: '#FDE68A' },
			buttonStyle: { background: '#F59E0B', textColor: '#111827', borderRadius: 14, padding: 18, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.5)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'dark_title_box',
		label: 'Dark title box',
		tags: ['box', 'medium', 'contrast'],
		patch: {
			layout: { textPosition: 'center', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, frameStyle: 'darkBox', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 64 },
			textOverlay: { style: 'gradient', intensity: 0.35, color: '#000000' },
			typography: { fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif', fontSize: 68, minFontSize: 34, fontWeight: 800, textColor: '#FFFFFF', lineHeight: 1.12, letterSpacing: -0.6, maxLines: 4, textShadow: false, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: true, underline: false, accentShapes: false, brushColor: '#111827', accentColor: '#FFFFFF' },
			buttonStyle: { background: '#F97316', textColor: '#FFFFFF', borderRadius: 999, padding: 14, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.55)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'white_rounded_card',
		label: 'White rounded card',
		tags: ['card', 'clean', 'recipe'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'center', showCta: true, showBrandBar: false, showDescription: false, frameStyle: 'whiteCard', ctaPosition: 'inside-frame', brandPlacement: 'inside-card', safeMargin: 56 },
			textOverlay: { style: 'gradient', intensity: 0.4, color: '#000000' },
			typography: { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 64, minFontSize: 32, fontWeight: 700, textColor: '#1F2937', lineHeight: 1.15, letterSpacing: -0.3, maxLines: 5, textShadow: false, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: true, underline: false, accentShapes: false, brushColor: '#F59E0B', accentColor: '#D97706' },
			buttonStyle: { background: '#111827', textColor: '#FFFFFF', borderRadius: 999, padding: 14, shadow: false },
			brandBar: { enabled: false, showLogo: true, showDomain: true, background: 'transparent', textColor: '#6B7280' },
		},
	},
	{
		id: 'brush_stroke',
		label: 'Brush stroke headline',
		tags: ['brush', 'warm', 'food'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 70 },
			textOverlay: { style: 'gradient', intensity: 0.66, color: '#000000' },
			typography: { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 78, minFontSize: 36, fontWeight: 800, textColor: '#FFFFFF', lineHeight: 1.1, letterSpacing: -0.8, maxLines: 4, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: true, brushColor: '#F59E0B', brushOpacity: 0.9, roundedLabel: true, underline: false, accentShapes: true, accentColor: '#FDE68A' },
			buttonStyle: { background: '#FFFFFF', textColor: '#92400E', borderRadius: 999, padding: 15, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.42)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'ribbon_banner',
		label: 'Ribbon banner',
		tags: ['ribbon', 'short', 'cta'],
		patch: {
			layout: { textPosition: 'center', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, frameStyle: 'ribbon', ctaPosition: 'below-title', brandPlacement: 'corner', safeMargin: 64 },
			textOverlay: { style: 'dark', intensity: 0.28, color: '#000000' },
			typography: { fontFamily: '"Arial Black", Gadget, sans-serif', fontSize: 62, minFontSize: 30, fontWeight: 900, textColor: '#FFFFFF', lineHeight: 1.08, letterSpacing: 0.2, maxLines: 3, textShadow: false, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: false, underline: false, accentShapes: true, brushColor: '#DC2626', accentColor: '#FEE2E2' },
			buttonStyle: { background: '#FFFFFF', textColor: '#B91C1C', borderRadius: 8, padding: 14, shadow: true },
			brandBar: { enabled: false, showLogo: true, showDomain: true, background: 'transparent', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'magazine',
		label: 'Magazine style',
		tags: ['magazine', 'long', 'editorial'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'left', showCta: false, showBrandBar: true, showDescription: true, frameStyle: 'magazine', ctaPosition: 'none', brandPlacement: 'bottom-bar', safeMargin: 68 },
			textOverlay: { style: 'gradient', intensity: 0.7, color: '#0F172A' },
			typography: { fontFamily: 'Palatino Linotype, Palatino, "Book Antiqua", serif', fontSize: 70, minFontSize: 34, fontWeight: 700, textColor: '#F8FAFC', lineHeight: 1.18, letterSpacing: -0.2, maxLines: 5, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: false, underline: true, underlineColor: '#94A3B8', accentShapes: true, accentColor: '#E2E8F0', brushColor: '#64748B' },
			buttonStyle: { background: '#F8FAFC', textColor: '#0F172A', borderRadius: 4, padding: 12, shadow: false },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(15,23,42,0.72)', textColor: '#E2E8F0' },
		},
	},
	{
		id: 'minimal_modern',
		label: 'Minimal modern',
		tags: ['minimal', 'short', 'modern'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'center', showCta: false, showBrandBar: true, showDescription: false, frameStyle: 'none', ctaPosition: 'none', brandPlacement: 'bottom-bar', safeMargin: 88 },
			textOverlay: { style: 'gradient', intensity: 0.48, color: '#000000' },
			typography: { fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif', fontSize: 58, minFontSize: 30, fontWeight: 600, textColor: '#FFFFFF', lineHeight: 1.2, letterSpacing: 1.4, maxLines: 4, textShadow: false, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: false, underline: true, underlineColor: '#FFFFFF', accentShapes: false, brushColor: '#FFFFFF', accentColor: '#FFFFFF' },
			buttonStyle: { background: 'rgba(255,255,255,0.92)', textColor: '#111827', borderRadius: 0, padding: 12, shadow: false },
			brandBar: { enabled: true, showLogo: false, showDomain: true, background: 'rgba(0,0,0,0.28)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'bold_typography',
		label: 'Bold typography',
		tags: ['bold', 'short', 'impact'],
		patch: {
			layout: { textPosition: 'center', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 56 },
			textOverlay: { style: 'dark', intensity: 0.45, color: '#000000' },
			typography: { fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif', fontSize: 92, minFontSize: 42, fontWeight: 900, textColor: '#FFFFFF', lineHeight: 0.98, letterSpacing: -1.5, maxLines: 3, textShadow: true, scriptEnabled: false },
			decorations: { brushHighlight: false, roundedLabel: true, underline: false, accentShapes: true, brushColor: '#EF4444', accentColor: '#FCA5A5' },
			buttonStyle: { background: '#EF4444', textColor: '#FFFFFF', borderRadius: 6, padding: 16, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(0,0,0,0.55)', textColor: '#FFFFFF' },
		},
	},
	{
		id: 'handwritten_accent',
		label: 'Elegant handwritten accent',
		tags: ['script', 'elegant', 'dessert', 'medium'],
		patch: {
			layout: { textPosition: 'bottom', textAlign: 'center', showCta: true, showBrandBar: true, showDescription: false, frameStyle: 'none', ctaPosition: 'below-title', brandPlacement: 'bottom-bar', safeMargin: 72 },
			textOverlay: { style: 'gradient', intensity: 0.6, color: '#1E1B4B' },
			typography: {
				fontFamily: 'Georgia, "Times New Roman", serif',
				fontSize: 70,
				minFontSize: 34,
				fontWeight: 700,
				textColor: '#FFF7ED',
				lineHeight: 1.16,
				letterSpacing: -0.4,
				maxLines: 5,
				textShadow: true,
				scriptEnabled: true,
				scriptFontFamily: '"Segoe Script", "Brush Script MT", cursive',
				scriptColor: '#FDE68A',
			},
			decorations: { brushHighlight: true, brushColor: '#7C3AED', brushOpacity: 0.75, roundedLabel: true, underline: false, accentShapes: true, accentColor: '#DDD6FE' },
			buttonStyle: { background: '#FDE68A', textColor: '#4C1D95', borderRadius: 999, padding: 15, shadow: true },
			brandBar: { enabled: true, showLogo: true, showDomain: true, background: 'rgba(49,46,129,0.55)', textColor: '#EDE9FE' },
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
