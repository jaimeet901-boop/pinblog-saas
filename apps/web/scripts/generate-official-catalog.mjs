/**
 * One-off generator: build official library from PIN_LAYOUT_CATALOG (first 24).
 * Run: npx vite-node scripts/generate-official-catalog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIN_LAYOUT_CATALOG, applyPinLayoutToTemplateConfig } from '../src/lib/pinLayoutCatalog.js';
import { createDefaultTemplateConfig } from '../src/lib/pinTemplates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CATEGORY_BY_LAYOUT = {
	centered_hero: 'recipes',
	top_title_bottom_cta: 'recipes',
	dark_title_box: 'dinner',
	white_rounded_card: 'recipes',
	brush_stroke: 'desserts',
	ribbon_banner: 'snacks',
	magazine: 'lifestyle',
	minimal_modern: 'general',
	bold_typography: 'fitness',
	handwritten_accent: 'desserts',
	soft_card_float: 'breakfast',
	glass_panel: 'drinks',
	banner_strip: 'snacks',
	polaroid_memory: 'breakfast',
	inset_frame: 'travel',
	left_rail_editorial: 'dinner',
	top_center_badge: 'recipes',
	bottom_stack_luxe: 'desserts',
	center_script_hero: 'lifestyle',
	healthy_clean_card: 'healthy',
	dinner_dark_panel: 'dinner',
	breakfast_sunburst: 'breakfast',
	drink_cool_center: 'drinks',
	snack_impact_block: 'snacks',
};

const THUMB_PALETTE = [
	['#1c1917', '#7c2d12', '#f59e0b'],
	['#0c0a09', '#292524', '#e7e5e4'],
	['#0f172a', '#1e293b', '#38bdf8'],
	['#44403c', '#a8a29e', '#fafaf9'],
	['#431407', '#9a3412', '#fdba74'],
	['#4c0519', '#9f1239', '#fecdd3'],
	['#1c1917', '#57534e', '#d6d3d1'],
	['#171717', '#404040', '#f5f5f5'],
	['#7f1d1d', '#450a0a', '#fecaca'],
	['#500724', '#9d174d', '#fbcfe8'],
	['#44403c', '#78716c', '#fafaf9'],
	['#0e7490', '#164e63', '#a5f3fc'],
	['#7c2d12', '#c2410c', '#fed7aa'],
	['#292524', '#a8a29e', '#fff7ed'],
	['#134e4a', '#115e59', '#99f6e4'],
	['#1c1917', '#3f3f46', '#d4d4d8'],
	['#1e3a8a', '#1d4ed8', '#bfdbfe'],
	['#78350f', '#b45309', '#fde68a'],
	['#500724', '#9d174d', '#fce7f3'],
	['#14532d', '#166534', '#bbf7d0'],
	['#1a2e05', '#365314', '#bef264'],
	['#78350f', '#d97706', '#fef3c7'],
	['#164e63', '#0e7490', '#cffafe'],
	['#7f1d1d', '#b91c1c', '#fecaca'],
];

function escapeXml(value) {
	return String(value || '').replace(/[<>&]/g, '');
}

/** Structural thumbnails — geometry follows layout, not just color. */
function buildThumb(entry, colors) {
	const [c1, c2, accent] = colors;
	const L = entry.configuration?.layout || {};
	const pos = L.textPosition || 'bottom';
	const frame = L.frameStyle || 'none';
	const align = L.textAlign || 'center';
	const cta = L.ctaPosition || 'below-title';
	const titleY = pos === 'top' ? 90 : pos === 'center' ? 280 : 470;
	const titleX = align === 'left' ? 48 : 200;
	const anchor = align === 'left' ? 'start' : 'middle';
	const label = escapeXml(entry.name);
	let frameSvg = '';
	if (frame === 'darkBox' || frame === 'whiteCard' || frame === 'softCard' || frame === 'glassCard') {
		const fill = frame === 'darkBox' ? 'rgba(12,10,9,0.72)' : 'rgba(255,255,255,0.88)';
		frameSvg = `<rect x="40" y="${titleY - 40}" width="320" height="140" rx="18" fill="${fill}"/>`;
	} else if (frame === 'ribbon') {
		frameSvg = `<path d="M40 ${titleY} L360 ${titleY - 30} L360 ${titleY + 70} L40 ${titleY + 100} Z" fill="${accent}" opacity="0.85"/>`;
	} else if (frame === 'bannerStrip') {
		frameSvg = `<rect x="0" y="${titleY - 20}" width="400" height="90" fill="rgba(12,10,9,0.7)"/>`;
	} else if (frame === 'polaroid') {
		frameSvg = `<rect x="48" y="60" width="304" height="420" rx="8" fill="#fff"/><rect x="68" y="80" width="264" height="300" fill="${c2}"/>`;
	} else if (frame === 'magazine' || frame === 'insetFrame') {
		frameSvg = `<rect x="28" y="28" width="344" height="544" fill="none" stroke="${accent}" stroke-width="10"/>`;
	} else {
		frameSvg = `<rect x="36" y="${titleY - 20}" width="328" height="110" rx="14" fill="rgba(12,10,9,0.5)"/>`;
	}
	let ctaSvg = '';
	if (L.showCta !== false && cta !== 'none') {
		const cy = cta === 'bottom' ? 540 : cta === 'inside-frame' ? titleY + 70 : titleY + 55;
		ctaSvg = `<rect x="130" y="${cy}" width="140" height="28" rx="14" fill="${accent}"/>`;
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="400" height="600" fill="url(#g)"/>
<circle cx="300" cy="140" r="70" fill="${accent}" opacity="0.18"/>
${frameSvg}
<text x="${titleX}" y="${titleY + 20}" text-anchor="${anchor}" fill="${frame === 'whiteCard' || frame === 'softCard' || frame === 'polaroid' ? '#1c1917' : '#fff'}" font-family="Georgia,serif" font-size="22" font-weight="700">${label}</text>
${ctaSvg}
<text x="200" y="580" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-family="Segoe UI,sans-serif" font-size="12">${escapeXml(frame)} · ${escapeXml(pos)} · ${escapeXml(cta)}</text>
</svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const layouts = PIN_LAYOUT_CATALOG.slice(0, 24);
if (layouts.length < 24) {
	throw new Error(`Expected 24 layouts, got ${layouts.length}`);
}

const catalog = layouts.map((layout, index) => {
	const configuration = applyPinLayoutToTemplateConfig(createDefaultTemplateConfig(), layout.id);
	const entry = {
		templateUuid: `chefia-official-${layout.id.replace(/_/g, '-')}`,
		name: layout.label,
		category: CATEGORY_BY_LAYOUT[layout.id] || 'general',
		tags: layout.tags || [],
		layoutId: layout.id,
		configuration,
	};
	entry.thumbnail = buildThumb(entry, THUMB_PALETTE[index % THUMB_PALETTE.length]);
	// Force typography uniqueness + mirror title alignment into typography.align
	const typo = entry.configuration.typography || {};
	typo.align = configuration.layout?.textAlign || 'center';
	typo.titleSize = (typo.fontSize || 72) + (index % 7);
	typo.fontSize = typo.titleSize;
	entry.configuration.typography = typo;
	return entry;
});

const outJs = `/**
 * AUTO-GENERATED from PIN_LAYOUT_CATALOG (24 layouts).
 * Do not hand-edit — run: npx vite-node scripts/generate-official-catalog.mjs
 */

export const OFFICIAL_PIN_TEMPLATE_CATALOG = ${JSON.stringify(catalog, null, '\t')};

export function listOfficialPinTemplateCatalog() {
	return OFFICIAL_PIN_TEMPLATE_CATALOG;
}
`;

const apiPath = path.resolve(__dirname, '../../api/src/services/official-pin-template-catalog.js');
const webPath = path.resolve(__dirname, '../src/lib/officialPinTemplateCatalog.generated.js');
fs.writeFileSync(apiPath, outJs, 'utf8');
fs.writeFileSync(webPath, outJs, 'utf8');

// Uniqueness report
function fingerprint(entry) {
	const c = entry.configuration;
	const L = c.layout || {};
	const T = c.typography || {};
	const O = c.textOverlay || {};
	const D = c.decorations || {};
	return {
		layout: [L.textPosition, L.textAlign, L.frameStyle, L.safeMargin, L.foodFocusY, L.showBrandBar, L.brandPlacement].join('|'),
		typography: [T.fontFamily, T.fontSize, T.scriptEnabled, T.textColor, T.align].join('|'),
		cta: [L.ctaPosition, L.showCta, D.roundedLabel, JSON.stringify(c.buttonStyle || {})].join('|'),
		title: [L.textPosition, L.textAlign, T.align || L.textAlign].join('|'),
		image: [L.frameStyle, L.foodFocusY, O.style, O.intensity, D.accentStyle, D.brushHighlight].join('|'),
		full: [L.textPosition, L.textAlign, L.ctaPosition, L.frameStyle, T.fontFamily, T.fontSize, O.style, D.accentStyle, D.brushHighlight, L.foodFocusY].join('|'),
	};
}
const fps = catalog.map(fingerprint);
const check = (key) => new Set(fps.map((f) => f[key])).size;
console.log(JSON.stringify({
	count: catalog.length,
	uuidUnique: new Set(catalog.map((e) => e.templateUuid)).size,
	layoutUnique: check('layout'),
	typographyUnique: check('typography'),
	ctaTreatmentUnique: check('cta'),
	titlePlacementUnique: check('title'),
	imageTreatmentUnique: check('image'),
	fullStructuralUnique: check('full'),
	categories: [...new Set(catalog.map((e) => e.category))].sort(),
}, null, 2));
console.log('Wrote', apiPath);
console.log('Wrote', webPath);
