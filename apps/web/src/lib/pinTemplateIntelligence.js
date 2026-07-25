/**
 * Premium Design Engine — recipe-aware recommendations using design tokens.
 * Ensures batch uniqueness across layout + font + palette + accent + CTA.
 */

import {
	PIN_LAYOUT_CATALOG,
	getPinLayoutById,
	applyPinLayoutToTemplateConfig as applyBaseLayout,
} from '@/lib/pinLayoutCatalog';
import { normalizeTemplateConfig } from '@/lib/pinTemplates';
import {
	PIN_FONT_PAIRS,
	PIN_PALETTES,
	PIN_CTA_TOKENS,
	getPaletteVariants,
	hashPick,
	resolveDynamicSpacing,
} from '@/lib/pinDesignTokens';

export const RECIPE_FAMILIES = [
	'dessert',
	'healthy',
	'dinner',
	'breakfast',
	'drinks',
	'snacks',
	'general',
];

/** @deprecated use PIN_FONT_PAIRS — kept for callers */
export const PREMIUM_FONT_PAIRS = PIN_FONT_PAIRS;

const FAMILY_LAYOUT_POOLS = {
	dessert: [
		'handwritten_accent', 'brush_stroke', 'white_rounded_card', 'centered_hero', 'ribbon_elegant',
		'bottom_stack_luxe', 'center_script_hero', 'soft_card_float', 'polaroid_script', 'inset_frame',
	],
	healthy: [
		'healthy_clean_card', 'minimal_modern', 'white_rounded_card', 'top_title_bottom_cta', 'magazine',
		'centered_hero', 'soft_card_float', 'asymmetric_top_left', 'glass_panel', 'lower_third_serif',
	],
	dinner: [
		'magazine', 'dinner_dark_panel', 'top_title_bottom_cta', 'bold_typography', 'brush_stroke',
		'left_rail_editorial', 'magazine_right_rule', 'dark_title_box', 'inset_frame', 'lower_third_serif',
	],
	breakfast: [
		'breakfast_sunburst', 'brush_stroke', 'top_title_bottom_cta', 'centered_hero', 'polaroid_memory',
		'ribbon_banner', 'white_rounded_card', 'top_center_badge', 'polaroid_script', 'banner_strip',
	],
	drinks: [
		'drink_cool_center', 'centered_hero', 'minimal_modern', 'glass_panel', 'dark_title_box',
		'glass_bottom_stack', 'ribbon_banner', 'bold_typography', 'inset_center_title', 'banner_editorial',
	],
	snacks: [
		'snack_impact_block', 'bold_typography', 'ribbon_banner', 'dark_title_box', 'centered_hero',
		'brush_stroke', 'banner_strip', 'top_center_badge', 'sharp_impact_fallback',
	],
	general: [
		'brush_stroke', 'centered_hero', 'white_rounded_card', 'top_title_bottom_cta', 'magazine',
		'soft_card_float', 'lower_third_serif', 'inset_frame', 'minimal_modern', 'handwritten_accent',
	],
};

// Fix snacks pool — remove invalid id
FAMILY_LAYOUT_POOLS.snacks = [
	'snack_impact_block', 'bold_typography', 'ribbon_banner', 'dark_title_box', 'centered_hero',
	'brush_stroke', 'banner_strip', 'top_center_badge', 'asymmetric_top_left', 'banner_editorial',
];

const FAMILY_FONT_POOLS = {
	dessert: ['georgia-script', 'didot-script', 'garamond-script', 'perpetua-script', 'copperplate-georgia', 'baskerville-italic'],
	healthy: ['century-georgia', 'verdana-georgia', 'optima-script', 'candara-georgia', 'futura-georgia', 'segoe-ui-script'],
	dinner: ['palatino-georgia', 'garamond-script', 'constantia-script', 'rockwell-georgia', 'georgia-script', 'lucida-georgia'],
	breakfast: ['cambria-script', 'georgia-script', 'gill-script', 'arial-black-brush', 'trebuchet-script', 'honey-fallback'],
	drinks: ['candara-georgia', 'optima-script', 'futura-georgia', 'segoe-ui-script', 'tahoma-script', 'century-georgia'],
	snacks: ['impact-georgia', 'rockwell-georgia', 'arial-black-brush', 'trebuchet-script', 'futura-georgia', 'segoe-ui-script'],
	general: ['georgia-script', 'palatino-georgia', 'century-georgia', 'garamond-script', 'optima-script', 'cambria-script'],
};

FAMILY_FONT_POOLS.breakfast = [
	'cambria-script', 'georgia-script', 'gill-script', 'arial-black-brush', 'trebuchet-script', 'lucida-georgia',
];

function buildIdentity(family) {
	const palettes = getPaletteVariants(family);
	const layouts = (FAMILY_LAYOUT_POOLS[family] || FAMILY_LAYOUT_POOLS.general)
		.filter((id) => getPinLayoutById(id));
	const fontIds = (FAMILY_FONT_POOLS[family] || FAMILY_FONT_POOLS.general)
		.filter((id) => PIN_FONT_PAIRS.some((pair) => pair.id === id));
	const fonts = fontIds.map((id) => PIN_FONT_PAIRS.find((pair) => pair.id === id)).filter(Boolean);
	const palette = palettes[0];

	return {
		label: family.charAt(0).toUpperCase() + family.slice(1),
		moods: family === 'dessert' ? ['indulgent', 'romantic', 'cozy']
			: family === 'healthy' ? ['fresh', 'clean', 'energizing']
				: family === 'dinner' ? ['savory', 'comforting', 'hearty']
					: family === 'breakfast' ? ['bright', 'cheerful', 'morning']
						: family === 'drinks' ? ['refreshing', 'festive', 'cool']
							: family === 'snacks' ? ['playful', 'quick', 'craveable']
								: ['inviting', 'reliable', 'homey'],
		preferredLayouts: layouts,
		fontHeading: fonts[0]?.heading,
		fontScript: fonts[0]?.script,
		fontPairs: fonts,
		fontPairIds: fontIds,
		palettes,
		palette,
		titlePosition: family === 'breakfast' ? 'top' : family === 'drinks' || family === 'snacks' ? 'center' : 'bottom',
		overlayStyle: family === 'drinks' ? 'vignette' : family === 'snacks' ? 'dark' : 'gradient',
		overlayIntensity: family === 'dinner' ? 0.66 : 0.54,
		decoration: family === 'healthy' ? 'underline' : family === 'snacks' ? 'ribbon' : 'brush',
		accentStyle: 'orbits',
		ctaStyle: family === 'healthy' ? 'pill-clean' : family === 'snacks' ? 'sharp' : 'pill-warm',
		brandPlacement: family === 'drinks' || family === 'snacks' ? 'corner' : 'bottom-bar',
		scriptAccent: family === 'dessert',
		foodFocusY: family === 'breakfast' ? 0.34 : family === 'drinks' ? 0.42 : 0.37,
	};
}

export const CATEGORY_VISUAL_IDENTITIES = Object.fromEntries(
	RECIPE_FAMILIES.map((family) => [family, buildIdentity(family)]),
);

const FAMILY_PATTERNS = {
	dessert: /\b(dessert|cake|cookie|brownie|pie|tart|cupcake|cheesecake|ice\s*cream|pudding|chocolate|sweet|frosting|bakery|pastry|fudge|truffle|donut|doughnut|macaron)\b/i,
	healthy: /\b(healthy|salad|keto|vegan|vegetarian|low[\s-]?carb|high[\s-]?protein|clean\s*eating|glow|detox|smoothie\s*bowl|quinoa|kale|avocado|light|nutritious|wellness|fit)\b/i,
	dinner: /\b(dinner|supper|entree|entrée|roast|pasta|steak|chicken\s*dinner|casserole|lasagna|meatloaf|weeknight\s*meal|main\s*course|savory)\b/i,
	breakfast: /\b(breakfast|brunch|pancake|waffle|oatmeal|omelet|omelette|eggs?\s*benedict|granola|morning|french\s*toast|bagel|muffin)\b/i,
	drinks: /\b(drink|cocktail|mocktail|smoothie|juice|latte|coffee|tea|lemonade|beverage|spritz|martini|sangria|milkshake|matcha)\b/i,
	snacks: /\b(snack|appetizer|finger\s*food|chips|dip|nachos|bites?|trail\s*mix|popcorn|cracker|grazing|party\s*food)\b/i,
};

const INGREDIENT_HINTS = {
	dessert: /\b(sugar|butter|flour|cocoa|vanilla|cream|caramel|berries|strawberry|raspberry)\b/i,
	healthy: /\b(spinach|broccoli|tofu|lentil|chickpea|yogurt|greek|olive\s*oil|lemon|herbs?)\b/i,
	dinner: /\b(garlic|onion|beef|pork|salmon|shrimp|rice|potato|tomato|cheese|basil)\b/i,
	breakfast: /\b(egg|bacon|maple|syrup|banana|berry|oat|yogurt|sausage)\b/i,
	drinks: /\b(ice|mint|lime|ginger|vodka|wine|sparkling|coconut\s*water|espresso)\b/i,
	snacks: /\b(cheese|salsa|peanut|pretzel|tortilla|hummus|olive)\b/i,
};

const MOOD_PATTERNS = [
	{ id: 'indulgent', re: /\b(decadent|rich|indulgent|sinful|gooey|luscious|creamy)\b/i },
	{ id: 'fresh', re: /\b(fresh|crisp|zesty|light|bright|garden)\b/i },
	{ id: 'comforting', re: /\b(comfort|cozy|hearty|homemade|classic|warming)\b/i },
	{ id: 'quick', re: /\b(quick|easy|fast|simple|minute|weeknight|instant)\b/i },
	{ id: 'elegant', re: /\b(elegant|gourmet|fancy|restaurant|impressive|special)\b/i },
	{ id: 'playful', re: /\b(fun|party|kid|crowd[\s-]?pleaser|addictive|crave)\b/i },
];

const TIME_PATTERNS = [
	{ id: 'under_15', minutes: 15, re: /\b(5[\s-]?minute|10[\s-]?minute|15[\s-]?minute|under\s*15|quick)\b/i },
	{ id: 'under_30', minutes: 30, re: /\b(20[\s-]?minute|25[\s-]?minute|30[\s-]?minute|half[\s-]?hour|under\s*30)\b/i },
	{ id: 'under_60', minutes: 60, re: /\b(40[\s-]?minute|45[\s-]?minute|1[\s-]?hour|hour)\b/i },
	{ id: 'slow', minutes: 120, re: /\b(slow[\s-]?cook|overnight|marinate|all[\s-]?day|hours?)\b/i },
];

const DIFFICULTY_PATTERNS = [
	{ id: 'easy', re: /\b(easy|beginner|simple|no[\s-]?bake|one[\s-]?pan|one[\s-]?pot|dump)\b/i },
	{ id: 'medium', re: /\b(homemade|from[\s-]?scratch|classic|traditional)\b/i },
	{ id: 'advanced', re: /\b(advanced|gourmet|technique|professional|challenging|elaborate)\b/i },
];

const AUDIENCE_PATTERNS = [
	{ id: 'families', re: /\b(family|kids?|picky|crowd|potluck)\b/i },
	{ id: 'busy_parents', re: /\b(weeknight|busy|working|meal[\s-]?prep)\b/i },
	{ id: 'health_conscious', re: /\b(healthy|diet|macros?|protein|clean)\b/i },
	{ id: 'entertaining', re: /\b(party|guests?|date[\s-]?night|holiday|entertaining)\b/i },
];

function corpusFromContext({ article, pin, analysis, panel } = {}) {
	return [
		article?.title,
		article?.category,
		article?.metaDescription,
		article?.excerpt,
		pin?.title,
		pin?.description,
		pin?.overlayText,
		pin?.category,
		analysis?.title,
		analysis?.seoDescription,
		analysis?.pinterestCategory,
		analysis?.cta,
		analysis?.targetAudience,
		...(Array.isArray(analysis?.keywords) ? analysis.keywords : []),
		panel?.targetAudience,
		panel?.toneOfVoice,
		panel?.style,
		panel?.pinTitle,
		panel?.pinDescription,
	].filter(Boolean).join(' \n ');
}

function scoreFamily(family, text) {
	let score = 0;
	const catRe = FAMILY_PATTERNS[family];
	const ingRe = INGREDIENT_HINTS[family];
	if (catRe?.test(text)) score += 12;
	if (ingRe?.test(text)) score += 6;
	const matches = text.match(catRe) || [];
	score += Math.min(6, matches.length * 2);
	return score;
}

function detectMood(text, familyIdentity) {
	for (const mood of MOOD_PATTERNS) {
		if (mood.re.test(text)) return mood.id;
	}
	return familyIdentity.moods[0] || 'inviting';
}

function detectCookingTime(text) {
	for (const item of TIME_PATTERNS) {
		if (item.re.test(text)) return item;
	}
	return { id: 'under_60', minutes: 45 };
}

function detectDifficulty(text) {
	for (const item of DIFFICULTY_PATTERNS) {
		if (item.re.test(text)) return item.id;
	}
	return 'easy';
}

function detectAudience(text, panel) {
	const seed = `${text} ${panel?.targetAudience || ''}`;
	for (const item of AUDIENCE_PATTERNS) {
		if (item.re.test(seed)) return item.id;
	}
	return String(panel?.targetAudience || 'home cooks').trim() || 'home cooks';
}

export function analyzeRecipeSignals({ article = null, pin = null, analysis = null, panel = null } = {}) {
	const text = corpusFromContext({ article, pin, analysis, panel });
	const familyScores = RECIPE_FAMILIES.filter((id) => id !== 'general').map((family) => ({
		family,
		score: scoreFamily(family, text),
	})).sort((a, b) => b.score - a.score);

	const top = familyScores[0];
	const family = top && top.score > 0 ? top.family : 'general';
	const identity = CATEGORY_VISUAL_IDENTITIES[family] || CATEGORY_VISUAL_IDENTITIES.general;
	const cookingTime = detectCookingTime(text);
	const difficulty = detectDifficulty(text);
	const mood = detectMood(text, identity);
	const audience = detectAudience(text, panel);

	const ingredients = [];
	Object.entries(INGREDIENT_HINTS).forEach(([, re]) => {
		const found = text.match(new RegExp(re.source, 'gi')) || [];
		found.forEach((item) => {
			const normalized = String(item).toLowerCase();
			if (!ingredients.includes(normalized)) ingredients.push(normalized);
		});
	});

	return {
		family,
		familyLabel: identity.label,
		category: article?.category || analysis?.pinterestCategory || pin?.category || identity.label,
		ingredients: ingredients.slice(0, 12),
		mood,
		cookingTime: cookingTime.id,
		cookingMinutes: cookingTime.minutes,
		difficulty,
		audience,
		confidence: top?.score || 0,
		signalsTextPreview: text.slice(0, 240),
	};
}

function clampPinHeadline(value) {
	const words = String(value || '')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean);
	if (words.length === 0) return 'Must-Try Recipe';
	if (words.length < 3) {
		return [...words, 'Recipe', 'Tonight'].slice(0, 3).join(' ');
	}
	return words.slice(0, 6).join(' ');
}

function layoutFitsSignals(layoutId, signals) {
	const layout = getPinLayoutById(layoutId);
	if (!layout) return 0;
	let score = 4;
	const tags = layout.tags || [];
	if (signals.cookingMinutes <= 20 && (tags.includes('short') || tags.includes('bold') || tags.includes('cta'))) score += 5;
	if (signals.cookingMinutes >= 60 && (tags.includes('editorial') || tags.includes('magazine'))) score += 5;
	if (signals.difficulty === 'easy' && (tags.includes('clean') || tags.includes('card') || tags.includes('minimal'))) score += 4;
	if (signals.difficulty === 'advanced' && (tags.includes('magazine') || tags.includes('elegant') || tags.includes('editorial'))) score += 4;
	if (signals.mood === 'indulgent' && (tags.includes('brush') || tags.includes('script') || tags.includes('luxury'))) score += 6;
	if (signals.mood === 'fresh' && (tags.includes('clean') || tags.includes('minimal') || tags.includes('card'))) score += 6;
	if (signals.mood === 'playful' && (tags.includes('ribbon') || tags.includes('bold') || tags.includes('impact'))) score += 6;
	if (signals.audience === 'health_conscious' && (tags.includes('clean') || tags.includes('minimal') || tags.includes('healthy'))) score += 4;
	if (signals.audience === 'entertaining' && (tags.includes('elegant') || tags.includes('magazine') || tags.includes('script'))) score += 4;
	if (tags.includes(signals.family)) score += 8;
	return score;
}

function visualSignature({ template, fontPairId, paletteId, accentStyle, ctaToken, titlePosition }) {
	return [template, fontPairId, paletteId, accentStyle, ctaToken, titlePosition].join('|');
}

const CTA_TOKEN_BY_STYLE = {
	'pill-clean': 'pillLight',
	'pill-sunny': 'pillLight',
	'pill-warm': 'pillGold',
	'pill-cool': 'outlineLight',
	'solid-warm': 'capsuleWarm',
	sharp: 'sharpBadge',
};

export function recommendPinDesign({
	article = null,
	pin = null,
	analysis = null,
	panel = null,
	index = 0,
	usedLayoutIds = [],
	usedSignatures = [],
	aiRecommendation = null,
} = {}) {
	const signals = analyzeRecipeSignals({ article, pin, analysis, panel });
	const identity = CATEGORY_VISUAL_IDENTITIES[signals.family] || CATEGORY_VISUAL_IDENTITIES.general;

	const aiLayout = String(aiRecommendation?.template || aiRecommendation?.layoutStyle || pin?.layoutStyle || '').trim();
	const preferredPool = [...identity.preferredLayouts];
	const availablePreferred = preferredPool.filter((id) => !usedLayoutIds.includes(id) && getPinLayoutById(id));
	const availableAll = PIN_LAYOUT_CATALOG.map((item) => item.id).filter((id) => !usedLayoutIds.includes(id));

	let templateId = null;
	if (aiLayout && getPinLayoutById(aiLayout) && !usedLayoutIds.includes(aiLayout)) {
		templateId = aiLayout;
	} else {
		const ranked = (availablePreferred.length > 0 ? availablePreferred : availableAll)
			.map((id) => ({
				id,
				score: layoutFitsSignals(id, signals) + (preferredPool.includes(id) ? 8 : 0),
			}))
			.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

		const top = ranked.slice(0, Math.min(5, ranked.length));
		const seed = `${signals.family}:${pin?.title || article?.title || ''}:${index}`;
		templateId = hashPick(seed, top.map((item) => item.id)) || ranked[0]?.id || preferredPool[0];
	}

	const layout = getPinLayoutById(templateId) || PIN_LAYOUT_CATALOG[0];
	const palettePool = identity.palettes || PIN_PALETTES.general;
	const unusedPalettes = palettePool.filter((p) => !usedSignatures.some((sig) => sig.includes(`|${p.id}|`)));
	const palette = hashPick(`${templateId}:${index}:palette`, unusedPalettes.length ? unusedPalettes : palettePool)
		|| palettePool[index % palettePool.length]
		|| identity.palette;

	const fontPool = identity.fontPairIds || [];
	const unusedFonts = fontPool.filter((id) => !usedSignatures.some((sig) => sig.includes(`|${id}|`)));
	const fontPairId = hashPick(`${signals.family}:${templateId}:${index}:font`, unusedFonts.length ? unusedFonts : fontPool)
		|| fontPool[index % Math.max(1, fontPool.length)]
		|| 'georgia-script';
	const fontDef = PIN_FONT_PAIRS.find((item) => item.id === fontPairId) || PIN_FONT_PAIRS[0];

	const fontPair = {
		heading: aiRecommendation?.fontPair?.heading || fontDef.heading,
		script: aiRecommendation?.fontPair?.script || fontDef.script,
		id: fontPairId,
	};

	const titlePosition = ['top', 'center', 'bottom'].includes(aiRecommendation?.titlePosition)
		? aiRecommendation.titlePosition
		: (layout.patch?.layout?.textPosition || identity.titlePosition);

	const overlayStyle = ['gradient', 'dark', 'vignette', 'none'].includes(aiRecommendation?.overlayStyle)
		? aiRecommendation.overlayStyle
		: identity.overlayStyle;

	const accentPools = {
		brush: ['flourish', 'arcs', 'orbits', 'spark'],
		underline: ['dots', 'rule', 'corner', 'brackets'],
		ribbon: ['diamonds', 'slash', 'spark'],
		accent: ['rule', 'corner', 'arcs', 'orbits', 'brackets'],
	};
	const decoration = String(aiRecommendation?.decoration || identity.decoration);
	const accentPool = accentPools[decoration] || ['orbits', 'arcs', 'diamonds', 'corner', 'dots', 'slash', 'flourish', 'rule', 'spark', 'brackets'];
	const unusedAccents = accentPool.filter((style) => !usedSignatures.some((sig) => sig.split('|')[3] === style));
	const accentStyle = hashPick(`${templateId}:${index}:accent`, unusedAccents.length ? unusedAccents : accentPool) || 'orbits';

	const brandPlacement = ['bottom-bar', 'corner', 'inside-card', 'hidden'].includes(aiRecommendation?.brandPlacement)
		? aiRecommendation.brandPlacement
		: (layout.patch?.layout?.brandPlacement || identity.brandPlacement);

	const ctaStyle = String(aiRecommendation?.ctaStyle || identity.ctaStyle);
	const ctaTokenKeys = Object.keys(PIN_CTA_TOKENS);
	const preferredCta = CTA_TOKEN_BY_STYLE[ctaStyle] || 'pillLight';
	const unusedCtas = ctaTokenKeys.filter((key) => !usedSignatures.some((sig) => sig.includes(`|${key}`)));
	const ctaToken = unusedCtas.includes(preferredCta)
		? preferredCta
		: (hashPick(`${templateId}:${index}:cta`, unusedCtas.length ? unusedCtas : ctaTokenKeys) || preferredCta);

	const scriptEnabled = Boolean(
		aiRecommendation?.scriptAccent
		?? (identity.scriptAccent && (templateId.includes('script') || templateId.includes('handwritten') || signals.mood === 'indulgent')),
	);

	const wordCount = String(pin?.title || article?.title || '').trim().split(/\s+/).filter(Boolean).length;
	const spacing = resolveDynamicSpacing({ wordCount: Math.min(6, Math.max(3, wordCount)), lineHint: wordCount > 4 ? 3 : 2 });

	const signature = visualSignature({
		template: layout.id,
		fontPairId,
		paletteId: palette.id,
		accentStyle,
		ctaToken,
		titlePosition,
	});

	return {
		family: signals.family,
		familyLabel: identity.label,
		signals,
		template: layout.id,
		templateLabel: layout.label,
		fontPair,
		fontPairId,
		colorPalette: {
			...palette,
			...(aiRecommendation?.colorPalette && typeof aiRecommendation.colorPalette === 'object'
				? aiRecommendation.colorPalette
				: {}),
		},
		paletteId: palette.id,
		titlePosition,
		ctaStyle,
		ctaToken,
		overlayStyle,
		overlayIntensity: Number(aiRecommendation?.overlayIntensity) || identity.overlayIntensity,
		decoration,
		accentStyle,
		brandPlacement,
		scriptAccent: scriptEnabled,
		foodFocusY: Number.isFinite(Number(aiRecommendation?.foodFocusY))
			? Number(aiRecommendation.foodFocusY)
			: (identity.foodFocusY ?? 0.38),
		showSubtitle: true,
		spacing,
		signature,
		rationale: [
			`${identity.label} identity`,
			`mood:${signals.mood}`,
			`layout:${layout.id}`,
			`font:${fontPairId}`,
			`palette:${palette.id}`,
		].join(' · '),
	};
}

export function recommendationToTemplatePatch(recommendation) {
	const palette = recommendation.colorPalette || CATEGORY_VISUAL_IDENTITIES.general.palette;
	const ctaToken = PIN_CTA_TOKENS[recommendation.ctaToken]
		|| PIN_CTA_TOKENS[CTA_TOKEN_BY_STYLE[recommendation.ctaStyle]]
		|| PIN_CTA_TOKENS.pillLight;
	const spacing = recommendation.spacing || resolveDynamicSpacing({ wordCount: 4 });

	const button = {
		background: palette.ctaBg || ctaToken.background,
		textColor: palette.ctaText || ctaToken.textColor,
		borderRadius: ctaToken.borderRadius,
		padding: ctaToken.padding,
		shadow: ctaToken.shadow,
	};

	// Prefer palette CTA colors with token shape
	if (recommendation.ctaToken === 'outlineLight') {
		button.background = 'rgba(255,255,255,0.14)';
		button.textColor = palette.text || '#FFFFFF';
	} else if (recommendation.ctaToken === 'pillGold' || recommendation.ctaToken === 'capsuleWarm') {
		button.background = palette.accent || palette.ctaBg || button.background;
		button.textColor = palette.ctaText || '#1C1917';
	} else if (palette.ctaBg && recommendation.ctaToken !== 'sharpBadge') {
		button.background = palette.ctaBg;
		button.textColor = palette.ctaText || button.textColor;
	}

	const brushOn = recommendation.decoration === 'brush' || recommendation.scriptAccent;
	const underlineOn = recommendation.decoration === 'underline';

	return {
		layout: {
			textPosition: recommendation.titlePosition,
			brandPlacement: recommendation.brandPlacement,
			showBrandBar: recommendation.brandPlacement === 'bottom-bar' || recommendation.brandPlacement === 'inside-card',
			showSubtitle: recommendation.showSubtitle !== false,
			foodFocusY: Number.isFinite(Number(recommendation.foodFocusY))
				? Number(recommendation.foodFocusY)
				: 0.38,
			safeMargin: spacing.safeMargin,
			dynamicGapAfterTitle: spacing.gapAfterTitle,
			titleScaleBoost: spacing.titleScaleBoost,
			subtitleOpacity: spacing.subtitleOpacity,
		},
		textOverlay: {
			style: recommendation.overlayStyle,
			intensity: recommendation.overlayIntensity,
			color: palette.overlay,
		},
		typography: {
			fontFamily: recommendation.fontPair?.heading,
			textColor: palette.text,
			scriptEnabled: Boolean(recommendation.scriptAccent),
			scriptFontFamily: recommendation.fontPair?.script,
			scriptColor: palette.accent,
			textShadow: recommendation.overlayStyle !== 'none',
			maxLines: 3,
			letterSpacing: -0.8,
			fontSize: Math.round((recommendation.spacing?.titleScaleBoost || 1) * 88),
		},
		decorations: {
			brushHighlight: brushOn,
			brushColor: palette.brush,
			brushOpacity: 0.82,
			roundedLabel: !underlineOn && recommendation.decoration !== 'ribbon',
			underline: underlineOn,
			underlineColor: palette.secondary || palette.accent,
			accentShapes: true,
			accentStyle: recommendation.accentStyle || 'orbits',
			accentColor: palette.secondary || palette.accent,
		},
		buttonStyle: {
			...button,
		},
		brandBar: {
			enabled: recommendation.brandPlacement === 'bottom-bar',
			showLogo: recommendation.brandPlacement !== 'hidden',
			showDomain: recommendation.brandPlacement !== 'hidden',
			background: palette.brandBar || 'rgba(0,0,0,0.45)',
			textColor: palette.text,
		},
	};
}

export function assignIntelligentPinDesigns(pins, {
	article = null,
	analysis = null,
	panel = null,
} = {}) {
	const list = Array.isArray(pins) ? pins : [];
	const usedLayoutIds = [];
	const usedSignatures = [];

	return list.map((pin, index) => {
		const aiRecommendation = pin?.designRecommendation && typeof pin.designRecommendation === 'object'
			? pin.designRecommendation
			: {
				template: pin?.layoutStyle,
				layoutStyle: pin?.layoutStyle,
				fontPair: pin?.fontPair,
				colorPalette: pin?.colorPalette,
				titlePosition: pin?.titlePosition,
				ctaStyle: pin?.ctaStyle,
				overlayStyle: pin?.overlayStyle,
				decoration: pin?.decoration,
				brandPlacement: pin?.brandPlacement,
				scriptAccent: pin?.scriptAccent,
			};

		let recommendation = recommendPinDesign({
			article,
			pin,
			analysis,
			panel,
			index,
			usedLayoutIds,
			usedSignatures,
			aiRecommendation,
		});

		// Avoid visually similar signatures in the same batch.
		let attempts = 0;
		while (usedSignatures.includes(recommendation.signature) && attempts < 8) {
			recommendation = recommendPinDesign({
				article,
				pin: { ...pin, title: `${pin?.title || ''}-${attempts}` },
				analysis,
				panel,
				index: index + attempts + 1,
				usedLayoutIds,
				usedSignatures,
				aiRecommendation: { ...aiRecommendation, template: undefined, layoutStyle: undefined },
			});
			attempts += 1;
		}

		usedLayoutIds.push(recommendation.template);
		usedSignatures.push(recommendation.signature);

		return {
			...pin,
			title: clampPinHeadline(pin?.title),
			subtitle: String(pin?.subtitle || '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' '),
			layoutId: recommendation.template,
			layoutLabel: recommendation.templateLabel,
			layoutStyle: recommendation.template,
			designRecommendation: recommendation,
			recipeFamily: recommendation.family,
			recipeFamilyLabel: recommendation.familyLabel,
			designSignature: recommendation.signature,
		};
	});
}

export function applyIntelligentTemplateConfig(baseConfig, recommendation, { brandKit = null } = {}) {
	const layoutId = recommendation?.template || recommendation?.layoutId || 'brush_stroke';
	let config = applyBaseLayout(baseConfig, layoutId, { brandKit: null });
	const patch = recommendationToTemplatePatch(recommendation || recommendPinDesign({}));

	config = {
		...config,
		layout: { ...config.layout, ...patch.layout, variantId: layoutId, variantLabel: recommendation?.templateLabel || layoutId },
		textOverlay: { ...config.textOverlay, ...patch.textOverlay },
		typography: {
			...config.typography,
			...patch.typography,
			// Keep catalog type scale as base; apply boost only
			fontSize: Math.round((config.typography.fontSize || 88) * (recommendation?.spacing?.titleScaleBoost || 1)),
			fontFamily: patch.typography.fontFamily || config.typography.fontFamily,
		},
		decorations: { ...config.decorations, ...patch.decorations },
		buttonStyle: { ...config.buttonStyle, ...patch.buttonStyle },
		brandBar: { ...config.brandBar, ...patch.brandBar },
	};

	if (brandKit) {
		config = {
			...config,
			typography: {
				...config.typography,
				fontFamily: brandKit.fontHeading || config.typography.fontFamily,
			},
			decorations: {
				...config.decorations,
				accentColor: brandKit.secondaryColor || config.decorations.accentColor,
			},
		};
	}

	return normalizeTemplateConfig({
		...config,
		canvas: { width: 1000, height: 1500 },
	});
}
