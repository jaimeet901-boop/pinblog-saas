/**
 * Premium layout catalog — 32 layouts composed from design tokens.
 * Visual variety comes from token combinations, not one-off CSS.
 */

import { createDefaultTemplateConfig, normalizeTemplateConfig } from '@/lib/pinTemplates';
import {
	PIN_SAFE_MARGIN,
	composeLayoutPatch,
} from '@/lib/pinDesignTokens';

function layout(id, label, tags, tokenOptions, meta = {}) {
	return {
		id,
		label,
		tags,
		patch: composeLayoutPatch(tokenOptions),
		channel: meta.channel || 'pinterest',
		canvas: meta.canvas || { width: 1000, height: 1500 },
		sourceLayoutId: meta.sourceLayoutId || id,
	};
}

export const PIN_LAYOUT_CATALOG = [
	layout('centered_hero', 'Centered hero', ['hero', 'short', 'bold'], {
		fontPairId: 'georgia-script', typeScale: 'hero', overlay: 'softVignette', cta: 'pillLight',
		textPosition: 'center', ctaPosition: 'below-title', roundedLabel: true, accentStyle: 'orbits',
		safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.38,
	}),
	layout('top_title_bottom_cta', 'Title top · CTA bottom', ['editorial', 'recipe'], {
		fontPairId: 'palatino-georgia', typeScale: 'editorial', overlay: 'richGradient', cta: 'capsuleWarm',
		textPosition: 'top', textAlign: 'left', ctaPosition: 'bottom', roundedLabel: false, underline: true,
		accentStyle: 'corner', underlineColor: '#F5E6C8', brushColor: '#C4A574', accentColor: '#F5E6C8',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.42,
	}),
	layout('dark_title_box', 'Dark title box', ['box', 'contrast'], {
		fontPairId: 'trebuchet-script', typeScale: 'editorial', overlay: 'softGradient', cta: 'pillGold',
		textPosition: 'center', frameStyle: 'darkBox', roundedLabel: true, accentShapes: false, accentStyle: 'none',
		safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.4,
	}),
	layout('white_rounded_card', 'White rounded card', ['card', 'clean'], {
		fontPairId: 'georgia-script', typeScale: 'card', overlay: 'softGradient', cta: 'pillDark',
		textPosition: 'bottom', frameStyle: 'whiteCard', ctaPosition: 'inside-frame', brandPlacement: 'inside-card',
		showBrandBar: false, textColor: '#1C1917', roundedLabel: true, accentShapes: false, accentStyle: 'none',
		safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.36,
	}),
	layout('brush_stroke', 'Brush stroke headline', ['brush', 'warm', 'food'], {
		fontPairId: 'georgia-script', typeScale: 'display', overlay: 'richGradient', cta: 'pillLight',
		textPosition: 'bottom', brushHighlight: true, roundedLabel: true, accentStyle: 'arcs',
		brushColor: '#C4A574', accentColor: '#F5E6C8', safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.35,
	}),
	layout('ribbon_banner', 'Ribbon banner', ['ribbon', 'short', 'cta'], {
		fontPairId: 'arial-black-brush', typeScale: 'editorial', overlay: 'softDark', cta: 'pillLight',
		textPosition: 'center', frameStyle: 'ribbon', brandPlacement: 'corner', showBrandBar: false,
		showSubtitle: false, roundedLabel: false, accentStyle: 'diamonds', brushColor: '#9F1239',
		accentColor: '#FFE4E6', safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.4,
	}),
	layout('magazine', 'Magazine editorial', ['magazine', 'editorial'], {
		fontPairId: 'palatino-georgia', typeScale: 'editorial', overlay: 'deepGradient', cta: 'squareClean',
		textPosition: 'bottom', textAlign: 'left', frameStyle: 'magazine', showCta: false, ctaPosition: 'none',
		roundedLabel: false, underline: true, underlineColor: '#A8A29E', accentStyle: 'rule',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.38, brandBarBg: 'rgba(12,10,9,0.72)',
	}),
	layout('minimal_modern', 'Minimal modern', ['minimal', 'short', 'modern'], {
		fontPairId: 'century-georgia', typeScale: 'minimal', overlay: 'softGradient', cta: 'squareClean',
		textPosition: 'bottom', roundedLabel: false, underline: true, accentStyle: 'dots',
		safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.4, brandBarBg: 'rgba(0,0,0,0.26)',
	}),
	layout('bold_typography', 'Bold typography', ['bold', 'short', 'impact'], {
		fontPairId: 'impact-georgia', typeScale: 'impact', overlay: 'richDark', cta: 'sharpBadge',
		textPosition: 'center', showSubtitle: false, roundedLabel: true, accentStyle: 'slash',
		brushColor: '#B91C1C', accentColor: '#FECACA', safeMargin: PIN_SAFE_MARGIN.tight, foodFocusY: 0.42,
	}),
	layout('handwritten_accent', 'Handwritten accent', ['script', 'elegant', 'dessert'], {
		fontPairId: 'georgia-script', typeScale: 'scriptLead', overlay: 'richGradient', cta: 'pillSoft',
		textPosition: 'bottom', brushHighlight: true, scriptEnabled: true, accentStyle: 'flourish',
		brushColor: '#9F1239', accentColor: '#FBCFE8', textColor: '#FFF7ED',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.36, brandBarBg: 'rgba(28,25,23,0.52)',
	}),
	layout('soft_card_float', 'Soft floating card', ['card', 'soft', 'clean'], {
		fontPairId: 'baskerville-italic', typeScale: 'card', overlay: 'softGradient', cta: 'pillSoft',
		textPosition: 'bottom', frameStyle: 'softCard', ctaPosition: 'inside-frame', brandPlacement: 'inside-card',
		showBrandBar: false, textColor: '#1C1917', roundedLabel: true, accentShapes: false, accentStyle: 'none',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.37,
	}),
	layout('glass_panel', 'Glass panel', ['glass', 'modern', 'drinks'], {
		fontPairId: 'optima-script', typeScale: 'editorial', overlay: 'softVignette', cta: 'outlineLight',
		textPosition: 'center', frameStyle: 'glassCard', roundedLabel: false, accentStyle: 'orbits',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.4,
	}),
	layout('banner_strip', 'Banner strip', ['banner', 'short'], {
		fontPairId: 'futura-georgia', typeScale: 'display', overlay: 'softDark', cta: 'pillGold',
		textPosition: 'center', frameStyle: 'bannerStrip', showSubtitle: false, roundedLabel: false,
		accentStyle: 'spark', safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.39,
	}),
	layout('polaroid_memory', 'Polaroid memory', ['card', 'playful', 'breakfast'], {
		fontPairId: 'gill-script', typeScale: 'card', overlay: 'softGradient', cta: 'pillDark',
		textPosition: 'bottom', frameStyle: 'polaroid', ctaPosition: 'inside-frame', brandPlacement: 'inside-card',
		showBrandBar: false, textColor: '#292524', roundedLabel: false, underline: true, underlineColor: '#A8A29E',
		accentShapes: false, accentStyle: 'none', safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.34,
	}),
	layout('inset_frame', 'Inset luxury frame', ['frame', 'luxury', 'editorial'], {
		fontPairId: 'didot-script', typeScale: 'editorial', overlay: 'deepGradient', cta: 'pillGold',
		textPosition: 'bottom', frameStyle: 'insetFrame', roundedLabel: true, accentStyle: 'brackets',
		safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.38,
	}),
	layout('left_rail_editorial', 'Left-rail editorial', ['editorial', 'long', 'dinner'], {
		fontPairId: 'garamond-script', typeScale: 'editorial', overlay: 'richGradient', cta: 'capsuleWarm',
		textPosition: 'bottom', textAlign: 'left', ctaPosition: 'below-title', roundedLabel: false,
		underline: true, accentStyle: 'rule', underlineColor: '#E8B86D',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.4,
	}),
	layout('top_center_badge', 'Top badge + title', ['hero', 'cta', 'short'], {
		fontPairId: 'segoe-ui-script', typeScale: 'display', overlay: 'softGradient', cta: 'pillLight',
		textPosition: 'top', textAlign: 'center', ctaPosition: 'below-title', roundedLabel: true,
		accentStyle: 'dots', safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.41,
	}),
	layout('bottom_stack_luxe', 'Bottom luxury stack', ['luxury', 'dessert', 'food'], {
		fontPairId: 'copperplate-georgia', typeScale: 'display', overlay: 'deepGradient', cta: 'pillGold',
		textPosition: 'bottom', brushHighlight: true, scriptEnabled: true, accentStyle: 'flourish',
		brushColor: '#E8B86D', safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.35,
	}),
	layout('center_script_hero', 'Center script hero', ['script', 'elegant', 'short'], {
		fontPairId: 'perpetua-script', typeScale: 'scriptLead', overlay: 'richVignette', cta: 'pillSoft',
		textPosition: 'center', scriptEnabled: true, roundedLabel: true, accentStyle: 'arcs',
		safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.39,
	}),
	layout('healthy_clean_card', 'Healthy clean card', ['card', 'clean', 'healthy'], {
		fontPairId: 'verdana-georgia', typeScale: 'card', overlay: 'softGradient', cta: 'pillDark',
		textPosition: 'bottom', frameStyle: 'whiteCard', ctaPosition: 'inside-frame', brandPlacement: 'inside-card',
		showBrandBar: false, textColor: '#14532D', roundedLabel: true, accentShapes: false, accentStyle: 'none',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.4,
	}),
	layout('dinner_dark_panel', 'Dinner dark panel', ['box', 'dinner', 'savory'], {
		fontPairId: 'constantia-script', typeScale: 'editorial', overlay: 'softGradient', cta: 'capsuleWarm',
		textPosition: 'center', frameStyle: 'darkBox', roundedLabel: true, accentShapes: false, accentStyle: 'none',
		safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.38,
	}),
	layout('breakfast_sunburst', 'Breakfast sunburst', ['brush', 'bright', 'breakfast'], {
		fontPairId: 'cambria-script', typeScale: 'display', overlay: 'richGradient', cta: 'pillLight',
		textPosition: 'top', brushHighlight: true, accentStyle: 'spark', brushColor: '#D97706',
		accentColor: '#FEF3C7', safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.34,
	}),
	layout('drink_cool_center', 'Cool drink center', ['hero', 'drinks', 'cool'], {
		fontPairId: 'candara-georgia', typeScale: 'hero', overlay: 'richVignette', cta: 'outlineLight',
		textPosition: 'center', roundedLabel: false, underline: true, underlineColor: '#67E8F9',
		accentStyle: 'orbits', brandPlacement: 'corner', showBrandBar: false,
		safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.42,
	}),
	layout('snack_impact_block', 'Snack impact block', ['bold', 'snacks', 'impact'], {
		fontPairId: 'rockwell-georgia', typeScale: 'impact', overlay: 'richDark', cta: 'sharpBadge',
		textPosition: 'center', showSubtitle: false, roundedLabel: true, accentStyle: 'slash',
		safeMargin: PIN_SAFE_MARGIN.tight, foodFocusY: 0.4,
	}),
	layout('asymmetric_top_left', 'Asymmetric top-left', ['editorial', 'modern'], {
		fontPairId: 'tahoma-script', typeScale: 'editorial', overlay: 'richGradient', cta: 'pillSoft',
		textPosition: 'top', textAlign: 'left', ctaPosition: 'below-title', roundedLabel: false,
		underline: true, accentStyle: 'corner', safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.4,
	}),
	layout('lower_third_serif', 'Lower-third serif', ['editorial', 'food'], {
		fontPairId: 'lucida-georgia', typeScale: 'display', overlay: 'deepGradient', cta: 'pillGold',
		textPosition: 'bottom', roundedLabel: true, accentStyle: 'rule',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.36,
	}),
	layout('ribbon_elegant', 'Elegant ribbon', ['ribbon', 'elegant', 'dessert'], {
		fontPairId: 'didot-script', typeScale: 'editorial', overlay: 'softDark', cta: 'pillSoft',
		textPosition: 'center', frameStyle: 'ribbon', brandPlacement: 'corner', showBrandBar: false,
		showSubtitle: true, roundedLabel: false, accentStyle: 'flourish', brushColor: '#9F1239',
		safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.38,
	}),
	layout('glass_bottom_stack', 'Glass bottom stack', ['glass', 'modern'], {
		fontPairId: 'futura-georgia', typeScale: 'editorial', overlay: 'softVignette', cta: 'pillLight',
		textPosition: 'bottom', frameStyle: 'glassCard', ctaPosition: 'inside-frame', roundedLabel: true,
		accentStyle: 'dots', safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.37,
	}),
	layout('magazine_right_rule', 'Magazine right rule', ['magazine', 'dinner'], {
		fontPairId: 'palatino-georgia', typeScale: 'editorial', overlay: 'deepGradient', cta: 'outlineLight',
		textPosition: 'bottom', textAlign: 'left', frameStyle: 'magazine', showCta: true, ctaPosition: 'below-title',
		roundedLabel: false, underline: true, accentStyle: 'brackets',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.39,
	}),
	layout('inset_center_title', 'Inset center title', ['frame', 'luxury', 'short'], {
		fontPairId: 'optima-script', typeScale: 'hero', overlay: 'richGradient', cta: 'pillGold',
		textPosition: 'center', frameStyle: 'insetFrame', showSubtitle: false, roundedLabel: true,
		accentStyle: 'orbits', safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.4,
	}),
	layout('polaroid_script', 'Polaroid script', ['card', 'script', 'breakfast'], {
		fontPairId: 'georgia-script', typeScale: 'scriptLead', overlay: 'softGradient', cta: 'pillDark',
		textPosition: 'bottom', frameStyle: 'polaroid', ctaPosition: 'inside-frame', brandPlacement: 'inside-card',
		showBrandBar: false, textColor: '#1C1917', scriptEnabled: true, roundedLabel: false,
		accentShapes: false, accentStyle: 'none', safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.35,
	}),
	layout('banner_editorial', 'Banner editorial', ['banner', 'editorial'], {
		fontPairId: 'garamond-script', typeScale: 'display', overlay: 'softDark', cta: 'capsuleWarm',
		textPosition: 'center', frameStyle: 'bannerStrip', roundedLabel: false, accentStyle: 'rule',
		safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.4,
	}),
	layout('banner_editorial', 'Banner editorial', ['banner', 'editorial'], {
		fontPairId: 'garamond-script', typeScale: 'display', overlay: 'softDark', cta: 'capsuleWarm',
		textPosition: 'center', frameStyle: 'bannerStrip', roundedLabel: false, accentStyle: 'rule',
		safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.4,
	}),
	layout('recipe_card_bottom_panel', 'Recipe Card — Bottom Panel', ['recipe', 'recipes', 'card', 'clean'], {
		fontPairId: 'baskerville-italic', typeScale: 'card', overlay: 'softGradient', cta: 'pillSoft',
		textPosition: 'bottom', frameStyle: 'softCard', ctaPosition: 'inside-frame', brandPlacement: 'inside-card',
		showBrandBar: false, showDescription: true, textColor: '#1C1917', roundedLabel: true,
		accentShapes: false, accentStyle: 'none', safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.32,
	}),
	layout('recipe_hero_center_title', 'Recipe Hero — Center Title', ['recipe', 'recipes', 'hero', 'short'], {
		fontPairId: 'didot-script', typeScale: 'hero', overlay: 'richVignette', cta: 'pillLight',
		textPosition: 'center', scriptEnabled: true, roundedLabel: true, accentStyle: 'arcs',
		safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.46,
	}),
	layout('recipe_dark_overlay', 'Dark Recipe Overlay', ['recipe', 'recipes', 'dark', 'editorial'], {
		fontPairId: 'constantia-script', typeScale: 'editorial', overlay: 'richDark', cta: 'capsuleWarm',
		textPosition: 'bottom', showDescription: true, underline: true, accentStyle: 'rule',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.29,
	}),
	layout('recipe_magazine', 'Magazine Recipe', ['recipe', 'recipes', 'magazine', 'editorial'], {
		fontPairId: 'garamond-script', typeScale: 'editorial', overlay: 'deepGradient', cta: 'squareClean',
		textPosition: 'bottom', textAlign: 'left', frameStyle: 'magazine', showCta: true, ctaPosition: 'below-title',
		showDescription: true, roundedLabel: false, underline: true, accentStyle: 'rule',
		safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.41, brandBarBg: 'rgba(12,10,9,0.72)',
	}),
	layout('recipe_minimal', 'Minimal Recipe', ['recipe', 'recipes', 'minimal', 'short'], {
		fontPairId: 'futura-georgia', typeScale: 'minimal', overlay: 'softVignette', cta: 'squareClean',
		textPosition: 'bottom', showSubtitle: false, roundedLabel: false, accentStyle: 'none',
		ctaPosition: 'bottom', safeMargin: PIN_SAFE_MARGIN.luxury, foodFocusY: 0.44, brandBarBg: 'rgba(0,0,0,0.26)',
	}),
	layout('recipe_spotlight', 'Recipe Spotlight', ['recipe', 'recipes', 'glass', 'modern'], {
		fontPairId: 'optima-script', typeScale: 'editorial', overlay: 'softVignette', cta: 'outlineLight',
		textPosition: 'bottom', frameStyle: 'glassCard', ctaPosition: 'inside-frame', showDescription: true,
		roundedLabel: true, accentStyle: 'dots', safeMargin: PIN_SAFE_MARGIN.generous, foodFocusY: 0.27,
	}),
	layout('recipe_elegant_white_card', 'Elegant White Card', ['recipe', 'recipes', 'card', 'elegant'], {
		fontPairId: 'garamond-script', typeScale: 'card', overlay: 'softGradient', cta: 'pillGold',
		textPosition: 'bottom', frameStyle: 'whiteCard', ctaPosition: 'inside-frame', brandPlacement: 'inside-card',
		showBrandBar: false, scriptEnabled: true, textColor: '#1C1917', roundedLabel: true,
		accentShapes: false, accentStyle: 'flourish', safeMargin: PIN_SAFE_MARGIN.standard, foodFocusY: 0.30,
	}),
	layout('recipe_bold_food_type', 'Bold Food Typography', ['recipe', 'recipes', 'bold', 'impact'], {
		fontPairId: 'arial-black-brush', typeScale: 'impact', overlay: 'richGradient', cta: 'sharpBadge',
		textPosition: 'center', roundedLabel: true, accentStyle: 'spark',
		safeMargin: PIN_SAFE_MARGIN.tight, foodFocusY: 0.49,
	}),
];

/** Landscape link-post layouts for Facebook (F6-4). */
const FACEBOOK_SOURCE_LAYOUT_IDS = Object.freeze([
	'centered_hero',
	'top_title_bottom_cta',
	'dark_title_box',
	'white_rounded_card',
	'brush_stroke',
	'ribbon_banner',
	'magazine',
	'minimal_modern',
]);

export const FACEBOOK_PIN_LAYOUT_CATALOG = FACEBOOK_SOURCE_LAYOUT_IDS.map((sourceId) => {
	const source = PIN_LAYOUT_CATALOG.find((item) => item.id === sourceId);
	if (!source) {
		throw new Error(`Missing Facebook source layout: ${sourceId}`);
	}
	return {
		id: `fb_${sourceId}`,
		label: `${source.label} · Link Post`,
		tags: [...source.tags, 'facebook', 'link-post'],
		patch: source.patch,
		channel: 'facebook',
		canvas: { width: 1200, height: 630 },
		sourceLayoutId: sourceId,
	};
});

export const ALL_PIN_LAYOUT_CATALOG = Object.freeze([
	...PIN_LAYOUT_CATALOG,
	...FACEBOOK_PIN_LAYOUT_CATALOG,
]);

export function getPinLayoutById(id) {
	return ALL_PIN_LAYOUT_CATALOG.find((item) => item.id === id) || null;
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

export function applyPinLayoutToTemplateConfig(baseConfig, layoutId, { brandKit = null } = {}) {
	const layoutDef = getPinLayoutById(layoutId) || PIN_LAYOUT_CATALOG[0];
	const base = normalizeTemplateConfig(baseConfig || createDefaultTemplateConfig());
	let merged = deepMerge(base, layoutDef.patch || {});

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
				background: brandKit.primaryColor && layoutDef.id !== 'white_rounded_card'
					? (merged.buttonStyle.background === '#FFFFFF' ? merged.buttonStyle.background : brandKit.primaryColor)
					: merged.buttonStyle.background,
			},
		});
	}

	merged.layout = {
		...merged.layout,
		variantId: layoutDef.id,
		variantLabel: layoutDef.label,
	};

	return normalizeTemplateConfig({
		...merged,
		canvas: {
			width: layoutDef.canvas?.width || 1000,
			height: layoutDef.canvas?.height || 1500,
		},
	});
}
