/**
 * One-off generator: build official library from PIN_LAYOUT_CATALOG (Pinterest + Facebook).
 * Run: npx vite-node scripts/generate-official-catalog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PIN_LAYOUT_CATALOG,
	FACEBOOK_PIN_LAYOUT_CATALOG,
	applyPinLayoutToTemplateConfig,
} from '../src/lib/pinLayoutCatalog.js';
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
	recipe_card_bottom_panel: 'recipes',
	recipe_hero_center_title: 'recipes',
	recipe_dark_overlay: 'recipes',
	recipe_magazine: 'recipes',
	recipe_minimal: 'recipes',
	recipe_spotlight: 'recipes',
	recipe_elegant_white_card: 'recipes',
	recipe_bold_food_type: 'recipes',
};

/** First 24 official Pinterest layouts — never insert/reorder. */
const FROZEN_OFFICIAL_PINTEREST_LAYOUT_IDS = Object.freeze([
	'centered_hero',
	'top_title_bottom_cta',
	'dark_title_box',
	'white_rounded_card',
	'brush_stroke',
	'ribbon_banner',
	'magazine',
	'minimal_modern',
	'bold_typography',
	'handwritten_accent',
	'soft_card_float',
	'glass_panel',
	'banner_strip',
	'polaroid_memory',
	'inset_frame',
	'left_rail_editorial',
	'top_center_badge',
	'bottom_stack_luxe',
	'center_script_hero',
	'healthy_clean_card',
	'dinner_dark_panel',
	'breakfast_sunburst',
	'drink_cool_center',
	'snack_impact_block',
]);

/** Phase A recipe pack — included by named ID, not by array slice. */
const PHASE_A_RECIPE_PACK_IDS = Object.freeze([
	'recipe_card_bottom_panel',
	'recipe_hero_center_title',
	'recipe_dark_overlay',
	'recipe_magazine',
	'recipe_minimal',
	'recipe_spotlight',
	'recipe_elegant_white_card',
	'recipe_bold_food_type',
]);

function selectOfficialPinterestLayouts(catalog) {
	const frozen = catalog.slice(0, 24);
	const frozenIds = frozen.map((item) => item.id);
	if (frozenIds.join('|') !== FROZEN_OFFICIAL_PINTEREST_LAYOUT_IDS.join('|')) {
		throw new Error(
			`Official first 24 Pinterest layouts were reordered or mutated. Expected ${FROZEN_OFFICIAL_PINTEREST_LAYOUT_IDS.join(', ')}; got ${frozenIds.join(', ')}`,
		);
	}
	const pack = PHASE_A_RECIPE_PACK_IDS.map((id) => {
		const layout = catalog.find((item) => item.id === id);
		if (!layout) {
			throw new Error(`Missing Phase A recipe pack layout: ${id}`);
		}
		return layout;
	});
	return [...frozen, ...pack];
}

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
function buildPortraitThumb(entry, colors) {
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

function buildLandscapeThumb(entry, colors) {
	const [c1, c2, accent] = colors;
	const L = entry.configuration?.layout || {};
	const pos = L.textPosition || 'bottom';
	const frame = L.frameStyle || 'none';
	const align = L.textAlign || 'center';
	const titleY = pos === 'top' ? 48 : pos === 'center' ? 105 : 170;
	const titleX = align === 'left' ? 36 : 200;
	const anchor = align === 'left' ? 'start' : 'middle';
	const label = escapeXml(entry.name);
	let frameSvg = '';
	if (frame === 'darkBox' || frame === 'whiteCard' || frame === 'softCard' || frame === 'glassCard') {
		const fill = frame === 'darkBox' ? 'rgba(12,10,9,0.72)' : 'rgba(255,255,255,0.88)';
		frameSvg = `<rect x="28" y="${titleY - 24}" width="344" height="72" rx="12" fill="${fill}"/>`;
	} else if (frame === 'ribbon' || frame === 'bannerStrip') {
		frameSvg = `<rect x="0" y="${titleY - 12}" width="400" height="56" fill="rgba(12,10,9,0.72)"/>`;
	} else {
		frameSvg = `<rect x="24" y="${titleY - 16}" width="352" height="64" rx="12" fill="rgba(12,10,9,0.5)"/>`;
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="210" viewBox="0 0 400 210">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="400" height="210" fill="url(#g)"/>
<circle cx="320" cy="56" r="36" fill="${accent}" opacity="0.18"/>
${frameSvg}
<text x="${titleX}" y="${titleY + 12}" text-anchor="${anchor}" fill="${frame === 'whiteCard' || frame === 'softCard' ? '#1c1917' : '#fff'}" font-family="Georgia,serif" font-size="18" font-weight="700">${label}</text>
<text x="200" y="198" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-family="Segoe UI,sans-serif" font-size="10">Facebook · ${escapeXml(frame)} · ${escapeXml(pos)}</text>
</svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildCatalogEntry(layout, index, { channel, uuidPrefix, thumbBuilder, tagExtras = [] }) {
	const configuration = applyPinLayoutToTemplateConfig(createDefaultTemplateConfig(), layout.id);
	const sourceId = layout.sourceLayoutId || layout.id;
	const entry = {
		templateUuid: `${uuidPrefix}-${sourceId.replace(/^fb_/, '').replace(/_/g, '-')}`,
		name: layout.label,
		category: CATEGORY_BY_LAYOUT[sourceId.replace(/^fb_/, '')] || 'general',
		tags: [...new Set([...(layout.tags || []), ...tagExtras])],
		layoutId: layout.id,
		channel,
		configuration,
	};
	entry.thumbnail = thumbBuilder(entry, THUMB_PALETTE[index % THUMB_PALETTE.length]);
	const typo = entry.configuration.typography || {};
	typo.align = configuration.layout?.textAlign || 'center';
	typo.titleSize = (typo.fontSize || 72) + (index % 7);
	typo.fontSize = typo.titleSize;
	entry.configuration.typography = typo;
	return entry;
}

const pinterestLayouts = selectOfficialPinterestLayouts(PIN_LAYOUT_CATALOG);

const pinterestCatalog = pinterestLayouts.map((layout, index) => buildCatalogEntry(layout, index, {
	channel: 'pinterest',
	uuidPrefix: 'chefia-official',
	thumbBuilder: buildPortraitThumb,
	tagExtras: ['pinterest'],
}));

const facebookCatalog = FACEBOOK_PIN_LAYOUT_CATALOG.map((layout, index) => buildCatalogEntry(layout, index, {
	channel: 'facebook',
	uuidPrefix: 'chefia-official-facebook',
	thumbBuilder: buildLandscapeThumb,
	tagExtras: ['facebook', 'link-post'],
}));

const catalog = [...pinterestCatalog, ...facebookCatalog];

const outJs = `/**
 * AUTO-GENERATED from PIN_LAYOUT_CATALOG (${pinterestCatalog.length} Pinterest + ${facebookCatalog.length} Facebook layouts).
 * Do not hand-edit — run: npx vite-node scripts/generate-official-catalog.mjs
 */

export const OFFICIAL_PIN_TEMPLATE_CATALOG = ${JSON.stringify(catalog, null, '\t')};

export function listOfficialPinTemplateCatalog() {
	return OFFICIAL_PIN_TEMPLATE_CATALOG;
}

export function listOfficialPinterestPinTemplateCatalog() {
	return OFFICIAL_PIN_TEMPLATE_CATALOG.filter((entry) => entry.channel === 'pinterest');
}

export function listOfficialFacebookPinTemplateCatalog() {
	return OFFICIAL_PIN_TEMPLATE_CATALOG.filter((entry) => entry.channel === 'facebook');
}
`;

const apiPath = path.resolve(__dirname, '../../api/src/services/official-pin-template-catalog.js');
const webPath = path.resolve(__dirname, '../src/lib/officialPinTemplateCatalog.generated.js');
fs.writeFileSync(apiPath, outJs, 'utf8');
fs.writeFileSync(webPath, outJs, 'utf8');

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
		full: [L.textPosition, L.textAlign, L.ctaPosition, L.frameStyle, T.fontFamily, T.fontSize, O.style, D.accentStyle, D.brushHighlight, L.foodFocusY, c.canvas?.width, c.canvas?.height].join('|'),
	};
}

const fps = catalog.map(fingerprint);
const check = (key) => new Set(fps.map((f) => f[key])).size;
console.log(JSON.stringify({
	total: catalog.length,
	pinterest: pinterestCatalog.length,
	facebook: facebookCatalog.length,
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
