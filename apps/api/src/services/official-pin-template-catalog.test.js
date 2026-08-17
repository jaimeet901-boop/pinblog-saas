/**
 * F6-4 / AI-PINS-06 — official pin template catalog tests (Pinterest + Facebook packs).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	listOfficialPinTemplateCatalog,
	listOfficialFacebookPinTemplateCatalog,
	listOfficialPinterestPinTemplateCatalog,
} from './official-pin-template-catalog.js';
import { TEMPLATE_CATEGORIES } from '../constants/pin-engine.js';
import { validateTemplateConfiguration } from '../utils/template-config-validation.js';
import { filterOfficialCatalogByPack } from './studio/template-pack.js';

function structuralKey(entry) {
	const c = entry.configuration || {};
	const L = c.layout || {};
	const T = c.typography || {};
	const O = c.textOverlay || {};
	const D = c.decorations || {};
	return [
		L.textPosition, L.textAlign, L.ctaPosition, L.frameStyle, L.foodFocusY,
		T.fontFamily, T.fontSize || T.titleSize, T.scriptEnabled, T.textColor,
		O.style, O.intensity, D.accentStyle, D.brushHighlight,
		c.canvas?.width, c.canvas?.height,
	].join('|');
}

const FROZEN_OFFICIAL_PINTEREST = Object.freeze([
	{ uuid: 'chefia-official-centered-hero', layoutId: 'centered_hero', name: 'Centered hero', key: 'center|center|below-title|none|0.38|Georgia, "Times New Roman", serif|104|false|#FFFFFF|vignette|0.48|orbits|false|1000|1500' },
	{ uuid: 'chefia-official-top-title-bottom-cta', layoutId: 'top_title_bottom_cta', name: 'Title top · CTA bottom', key: 'top|left|bottom|none|0.42|Palatino Linotype, Palatino, "Book Antiqua", serif|83|false|#FFFFFF|gradient|0.62|corner|false|1000|1500' },
	{ uuid: 'chefia-official-dark-title-box', layoutId: 'dark_title_box', name: 'Dark title box', key: 'center|center|below-title|darkBox|0.4|"Trebuchet MS", "Segoe UI", sans-serif|84|false|#FFFFFF|gradient|0.42|none|false|1000|1500' },
	{ uuid: 'chefia-official-white-rounded-card', layoutId: 'white_rounded_card', name: 'White rounded card', key: 'bottom|center|inside-frame|whiteCard|0.36|Georgia, "Times New Roman", serif|75|false|#1C1917|gradient|0.42|none|false|1000|1500' },
	{ uuid: 'chefia-official-brush-stroke', layoutId: 'brush_stroke', name: 'Brush stroke headline', key: 'bottom|center|below-title|none|0.35|Georgia, "Times New Roman", serif|96|false|#FFFFFF|gradient|0.62|arcs|true|1000|1500' },
	{ uuid: 'chefia-official-ribbon-banner', layoutId: 'ribbon_banner', name: 'Ribbon banner', key: 'center|center|below-title|ribbon|0.4|"Arial Black", Gadget, sans-serif|87|false|#FFFFFF|dark|0.28|diamonds|false|1000|1500' },
	{ uuid: 'chefia-official-magazine', layoutId: 'magazine', name: 'Magazine editorial', key: 'bottom|left|none|magazine|0.38|Palatino Linotype, Palatino, "Book Antiqua", serif|88|false|#FFFFFF|gradient|0.72|rule|false|1000|1500' },
	{ uuid: 'chefia-official-minimal-modern', layoutId: 'minimal_modern', name: 'Minimal modern', key: 'bottom|center|below-title|none|0.4|"Century Gothic", "Apple Gothic", sans-serif|66|false|#FFFFFF|gradient|0.42|dots|false|1000|1500' },
	{ uuid: 'chefia-official-bold-typography', layoutId: 'bold_typography', name: 'Bold typography', key: 'center|center|below-title|none|0.42|Impact, Haettenschweiler, "Arial Black", sans-serif|113|false|#FFFFFF|dark|0.42|slash|false|1000|1500' },
	{ uuid: 'chefia-official-handwritten-accent', layoutId: 'handwritten_accent', name: 'Handwritten accent', key: 'bottom|center|below-title|none|0.36|Georgia, "Times New Roman", serif|82|true|#FFF7ED|gradient|0.62|flourish|true|1000|1500' },
	{ uuid: 'chefia-official-soft-card-float', layoutId: 'soft_card_float', name: 'Soft floating card', key: 'bottom|center|inside-frame|softCard|0.37|Baskerville, "Times New Roman", serif|75|false|#1C1917|gradient|0.42|none|false|1000|1500' },
	{ uuid: 'chefia-official-glass-panel', layoutId: 'glass_panel', name: 'Glass panel', key: 'center|center|below-title|glassCard|0.4|Optima, Candara, sans-serif|86|false|#FFFFFF|vignette|0.48|orbits|false|1000|1500' },
	{ uuid: 'chefia-official-banner-strip', layoutId: 'banner_strip', name: 'Banner strip', key: 'center|center|below-title|bannerStrip|0.39|Futura, "Trebuchet MS", sans-serif|97|false|#FFFFFF|dark|0.28|spark|false|1000|1500' },
	{ uuid: 'chefia-official-polaroid-memory', layoutId: 'polaroid_memory', name: 'Polaroid memory', key: 'bottom|center|inside-frame|polaroid|0.34|"Gill Sans", "Trebuchet MS", sans-serif|78|false|#292524|gradient|0.42|none|false|1000|1500' },
	{ uuid: 'chefia-official-inset-frame', layoutId: 'inset_frame', name: 'Inset luxury frame', key: 'bottom|center|below-title|insetFrame|0.38|Didot, "Bodoni MT", serif|82|false|#FFFFFF|gradient|0.72|brackets|false|1000|1500' },
	{ uuid: 'chefia-official-left-rail-editorial', layoutId: 'left_rail_editorial', name: 'Left-rail editorial', key: 'bottom|left|below-title|none|0.4|Garamond, "Times New Roman", serif|83|false|#FFFFFF|gradient|0.62|rule|false|1000|1500' },
	{ uuid: 'chefia-official-top-center-badge', layoutId: 'top_center_badge', name: 'Top badge + title', key: 'top|center|below-title|none|0.41|"Segoe UI", Calibri, sans-serif|94|false|#FFFFFF|gradient|0.42|dots|false|1000|1500' },
	{ uuid: 'chefia-official-bottom-stack-luxe', layoutId: 'bottom_stack_luxe', name: 'Bottom luxury stack', key: 'bottom|center|below-title|none|0.35|Copperplate, "Copperplate Gothic Light", fantasy|95|true|#FFFFFF|gradient|0.72|flourish|true|1000|1500' },
	{ uuid: 'chefia-official-center-script-hero', layoutId: 'center_script_hero', name: 'Center script hero', key: 'center|center|below-title|none|0.39|Perpetua, Georgia, serif|84|true|#FFFFFF|vignette|0.62|arcs|false|1000|1500' },
	{ uuid: 'chefia-official-healthy-clean-card', layoutId: 'healthy_clean_card', name: 'Healthy clean card', key: 'bottom|center|inside-frame|whiteCard|0.4|Verdana, Geneva, sans-serif|77|false|#14532D|gradient|0.42|none|false|1000|1500' },
	{ uuid: 'chefia-official-dinner-dark-panel', layoutId: 'dinner_dark_panel', name: 'Dinner dark panel', key: 'center|center|below-title|darkBox|0.38|Constantia, Georgia, serif|88|false|#FFFFFF|gradient|0.42|none|false|1000|1500' },
	{ uuid: 'chefia-official-breakfast-sunburst', layoutId: 'breakfast_sunburst', name: 'Breakfast sunburst', key: 'top|center|below-title|none|0.34|Cambria, Georgia, serif|92|false|#FFFFFF|gradient|0.62|spark|true|1000|1500' },
	{ uuid: 'chefia-official-drink-cool-center', layoutId: 'drink_cool_center', name: 'Cool drink center', key: 'center|center|below-title|none|0.42|Candara, Calibri, sans-serif|105|false|#FFFFFF|vignette|0.62|orbits|false|1000|1500' },
	{ uuid: 'chefia-official-snack-impact-block', layoutId: 'snack_impact_block', name: 'Snack impact block', key: 'center|center|below-title|none|0.4|Rockwell, "Courier New", serif|114|false|#FFFFFF|dark|0.42|slash|false|1000|1500' },
]);

const FROZEN_OFFICIAL_FACEBOOK = Object.freeze([
	{ uuid: 'chefia-official-facebook-centered-hero', layoutId: 'fb_centered_hero', name: 'Centered hero · Link Post' },
	{ uuid: 'chefia-official-facebook-top-title-bottom-cta', layoutId: 'fb_top_title_bottom_cta', name: 'Title top · CTA bottom · Link Post' },
	{ uuid: 'chefia-official-facebook-dark-title-box', layoutId: 'fb_dark_title_box', name: 'Dark title box · Link Post' },
	{ uuid: 'chefia-official-facebook-white-rounded-card', layoutId: 'fb_white_rounded_card', name: 'White rounded card · Link Post' },
	{ uuid: 'chefia-official-facebook-brush-stroke', layoutId: 'fb_brush_stroke', name: 'Brush stroke headline · Link Post' },
	{ uuid: 'chefia-official-facebook-ribbon-banner', layoutId: 'fb_ribbon_banner', name: 'Ribbon banner · Link Post' },
	{ uuid: 'chefia-official-facebook-magazine', layoutId: 'fb_magazine', name: 'Magazine editorial · Link Post' },
	{ uuid: 'chefia-official-facebook-minimal-modern', layoutId: 'fb_minimal_modern', name: 'Minimal modern · Link Post' },
]);

const PHASE_A_RECIPE_PACK = Object.freeze([
	{ uuid: 'chefia-official-recipe-card-bottom-panel', layoutId: 'recipe_card_bottom_panel', name: 'Recipe Card — Bottom Panel' },
	{ uuid: 'chefia-official-recipe-hero-center-title', layoutId: 'recipe_hero_center_title', name: 'Recipe Hero — Center Title' },
	{ uuid: 'chefia-official-recipe-dark-overlay', layoutId: 'recipe_dark_overlay', name: 'Dark Recipe Overlay' },
	{ uuid: 'chefia-official-recipe-magazine', layoutId: 'recipe_magazine', name: 'Magazine Recipe' },
	{ uuid: 'chefia-official-recipe-minimal', layoutId: 'recipe_minimal', name: 'Minimal Recipe' },
	{ uuid: 'chefia-official-recipe-spotlight', layoutId: 'recipe_spotlight', name: 'Recipe Spotlight' },
	{ uuid: 'chefia-official-recipe-elegant-white-card', layoutId: 'recipe_elegant_white_card', name: 'Elegant White Card' },
	{ uuid: 'chefia-official-recipe-bold-food-type', layoutId: 'recipe_bold_food_type', name: 'Bold Food Typography' },
]);

describe('official pin template catalog — pinterest pack', () => {
	it('keeps the original 24 official Pinterest templates frozen', () => {
		const catalog = listOfficialPinterestPinTemplateCatalog();
		assert.equal(FROZEN_OFFICIAL_PINTEREST.length, 24);
		for (let index = 0; index < 24; index += 1) {
			const entry = catalog[index];
			const frozen = FROZEN_OFFICIAL_PINTEREST[index];
			assert.equal(entry.templateUuid, frozen.uuid);
			assert.equal(entry.layoutId, frozen.layoutId);
			assert.equal(entry.name, frozen.name);
			assert.equal(structuralKey(entry), frozen.key);
			assert.equal(entry.channel, 'pinterest');
			assert.equal(entry.configuration?.canvas?.width, 1000);
			assert.equal(entry.configuration?.canvas?.height, 1500);
		}
	});

	it('exports exactly 32 unique published-ready Pinterest templates', () => {
		const catalog = listOfficialPinterestPinTemplateCatalog();
		assert.equal(catalog.length, 32);
		const uuids = catalog.map((entry) => entry.templateUuid);
		const layoutIds = catalog.map((entry) => entry.layoutId);
		assert.equal(new Set(uuids).size, 32);
		assert.equal(new Set(layoutIds).size, 32);
		const structures = catalog.map(structuralKey);
		assert.equal(new Set(structures).size, 32, 'each Pinterest template must have a unique structural signature');

		for (const entry of catalog) {
			assert.match(entry.templateUuid, /^chefia-official-/);
			assert.doesNotMatch(entry.templateUuid, /^chefia-official-facebook-/);
			assert.equal(entry.channel, 'pinterest');
			assert.ok(entry.tags.includes('pinterest'));
			assert.ok(!entry.tags.includes('facebook'));
			assert.ok(!entry.tags.includes('link-post'));
			assert.ok(entry.name);
			assert.ok(TEMPLATE_CATEGORIES.includes(entry.category), `unknown category: ${entry.category}`);
			assert.match(entry.thumbnail, /^data:image\/svg\+xml/);
			const validated = validateTemplateConfiguration(entry.configuration);
			assert.equal(validated.ok, true, JSON.stringify(validated.issues));
			assert.equal(entry.configuration?.canvas?.width, 1000);
			assert.equal(entry.configuration?.canvas?.height, 1500);
		}
	});

	it('appends the Phase A recipe pack as Pinterest-only official templates', () => {
		const catalog = listOfficialPinterestPinTemplateCatalog();
		const pack = catalog.slice(24);
		assert.equal(pack.length, 8);
		for (let index = 0; index < 8; index += 1) {
			const entry = pack[index];
			const expected = PHASE_A_RECIPE_PACK[index];
			assert.equal(entry.templateUuid, expected.uuid);
			assert.equal(entry.layoutId, expected.layoutId);
			assert.equal(entry.name, expected.name);
			assert.equal(entry.channel, 'pinterest');
			assert.equal(entry.category, 'recipes');
			assert.ok(entry.tags.includes('recipe') || entry.tags.includes('recipes'));
			assert.ok(!entry.tags.includes('facebook'));
			const validated = validateTemplateConfiguration(entry.configuration);
			assert.equal(validated.ok, true, JSON.stringify(validated.issues));
		}
	});
});

describe('official pin template catalog — facebook pack', () => {
	it('keeps the Facebook catalog unchanged', () => {
		const catalog = listOfficialFacebookPinTemplateCatalog();
		assert.equal(catalog.length, 8);
		assert.equal(FROZEN_OFFICIAL_FACEBOOK.length, 8);
		for (let index = 0; index < 8; index += 1) {
			const entry = catalog[index];
			const frozen = FROZEN_OFFICIAL_FACEBOOK[index];
			assert.equal(entry.templateUuid, frozen.uuid);
			assert.equal(entry.layoutId, frozen.layoutId);
			assert.equal(entry.name, frozen.name);
			assert.match(entry.templateUuid, /^chefia-official-facebook-/);
			assert.equal(entry.channel, 'facebook');
			assert.ok(entry.tags.includes('facebook'));
			assert.ok(entry.tags.includes('link-post'));
			assert.equal(entry.configuration?.canvas?.width, 1200);
			assert.equal(entry.configuration?.canvas?.height, 630);
		}
	});

	it('exports 8 unique landscape Facebook link-post templates', () => {
		const catalog = listOfficialFacebookPinTemplateCatalog();
		assert.equal(catalog.length, 8);
		const uuids = catalog.map((entry) => entry.templateUuid);
		assert.equal(new Set(uuids).size, 8);
		const structures = catalog.map(structuralKey);
		assert.equal(new Set(structures).size, 8, 'each Facebook template must have a unique structural signature');

		for (const entry of catalog) {
			assert.match(entry.templateUuid, /^chefia-official-facebook-/);
			assert.equal(entry.channel, 'facebook');
			assert.ok(entry.tags.includes('facebook'));
			assert.ok(entry.tags.includes('link-post'));
			assert.match(entry.thumbnail, /^data:image\/svg\+xml/);
			const validated = validateTemplateConfiguration(entry.configuration);
			assert.equal(validated.ok, true, JSON.stringify(validated.issues));
			assert.equal(entry.configuration?.canvas?.width, 1200);
			assert.equal(entry.configuration?.canvas?.height, 630);
		}
	});
});

describe('official pin template catalog — combined', () => {
	it('combines pinterest and facebook without uuid collisions', () => {
		const catalog = listOfficialPinTemplateCatalog();
		assert.equal(catalog.length, 40);
		assert.equal(new Set(catalog.map((entry) => entry.templateUuid)).size, 40);
		assert.equal(filterOfficialCatalogByPack(catalog, 'pinterest').length, 32);
		assert.equal(filterOfficialCatalogByPack(catalog, 'facebook').length, 8);
	});
});
