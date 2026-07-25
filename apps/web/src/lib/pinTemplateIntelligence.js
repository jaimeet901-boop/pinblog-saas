/**
 * AI Template Intelligence — recipe-aware design recommendations.
 * Analyzes category, ingredients, mood, time, difficulty, and audience,
 * then recommends template + typography + palette + placement for the renderer.
 * Not random: deterministic scoring within category visual identities.
 */

import {
	PIN_LAYOUT_CATALOG,
	getPinLayoutById,
	applyPinLayoutToTemplateConfig as applyBaseLayout,
} from '@/lib/pinLayoutCatalog';
import { normalizeTemplateConfig } from '@/lib/pinTemplates';

export const RECIPE_FAMILIES = [
	'dessert',
	'healthy',
	'dinner',
	'breakfast',
	'drinks',
	'snacks',
	'general',
];

/** Recognizable visual identity per recipe family (BlogToPin / Canva designer logic). */
export const CATEGORY_VISUAL_IDENTITIES = {
	dessert: {
		label: 'Dessert',
		moods: ['indulgent', 'romantic', 'cozy'],
		preferredLayouts: ['handwritten_accent', 'brush_stroke', 'white_rounded_card', 'centered_hero', 'ribbon_banner'],
		fontHeading: 'Georgia, "Times New Roman", serif',
		fontScript: '"Segoe Script", "Brush Script MT", cursive',
		palette: {
			primary: '#BE185D',
			secondary: '#FBCFE8',
			accent: '#F59E0B',
			text: '#FFF7ED',
			overlay: '#4C0519',
			ctaBg: '#FDE68A',
			ctaText: '#831843',
			brush: '#DB2777',
			brandBar: 'rgba(76,5,25,0.55)',
		},
		titlePosition: 'bottom',
		overlayStyle: 'gradient',
		overlayIntensity: 0.62,
		decoration: 'brush',
		ctaStyle: 'pill-warm',
		brandPlacement: 'bottom-bar',
		scriptAccent: true,
	},
	healthy: {
		label: 'Healthy',
		moods: ['fresh', 'clean', 'energizing'],
		preferredLayouts: ['white_rounded_card', 'minimal_modern', 'top_title_bottom_cta', 'magazine', 'centered_hero'],
		fontHeading: 'Helvetica Neue, Helvetica, Arial, sans-serif',
		fontScript: 'Georgia, "Times New Roman", serif',
		palette: {
			primary: '#15803D',
			secondary: '#BBF7D0',
			accent: '#84CC16',
			text: '#FFFFFF',
			overlay: '#052E16',
			ctaBg: '#FFFFFF',
			ctaText: '#14532D',
			brush: '#22C55E',
			brandBar: 'rgba(5,46,22,0.5)',
		},
		titlePosition: 'bottom',
		overlayStyle: 'gradient',
		overlayIntensity: 0.48,
		decoration: 'underline',
		ctaStyle: 'pill-clean',
		brandPlacement: 'bottom-bar',
		scriptAccent: false,
	},
	dinner: {
		label: 'Dinner',
		moods: ['savory', 'comforting', 'hearty'],
		preferredLayouts: ['magazine', 'dark_title_box', 'top_title_bottom_cta', 'bold_typography', 'brush_stroke'],
		fontHeading: 'Palatino Linotype, Palatino, "Book Antiqua", serif',
		fontScript: 'Georgia, "Times New Roman", serif',
		palette: {
			primary: '#9A3412',
			secondary: '#FED7AA',
			accent: '#F97316',
			text: '#FFF7ED',
			overlay: '#1C1917',
			ctaBg: '#F97316',
			ctaText: '#1C1917',
			brush: '#EA580C',
			brandBar: 'rgba(28,25,23,0.65)',
		},
		titlePosition: 'bottom',
		overlayStyle: 'gradient',
		overlayIntensity: 0.72,
		decoration: 'accent',
		ctaStyle: 'solid-warm',
		brandPlacement: 'bottom-bar',
		scriptAccent: false,
	},
	breakfast: {
		label: 'Breakfast',
		moods: ['bright', 'cheerful', 'morning'],
		preferredLayouts: ['brush_stroke', 'top_title_bottom_cta', 'centered_hero', 'ribbon_banner', 'white_rounded_card'],
		fontHeading: 'Georgia, "Times New Roman", serif',
		fontScript: '"Segoe Script", "Brush Script MT", cursive',
		palette: {
			primary: '#D97706',
			secondary: '#FEF3C7',
			accent: '#FBBF24',
			text: '#FFFFFF',
			overlay: '#78350F',
			ctaBg: '#FFFFFF',
			ctaText: '#92400E',
			brush: '#F59E0B',
			brandBar: 'rgba(120,53,15,0.5)',
		},
		titlePosition: 'top',
		overlayStyle: 'gradient',
		overlayIntensity: 0.58,
		decoration: 'brush',
		ctaStyle: 'pill-sunny',
		brandPlacement: 'bottom-bar',
		scriptAccent: false,
	},
	drinks: {
		label: 'Drinks',
		moods: ['refreshing', 'festive', 'cool'],
		preferredLayouts: ['centered_hero', 'minimal_modern', 'dark_title_box', 'ribbon_banner', 'bold_typography'],
		fontHeading: 'Helvetica Neue, Helvetica, Arial, sans-serif',
		fontScript: '"Segoe Script", "Brush Script MT", cursive',
		palette: {
			primary: '#0369A1',
			secondary: '#BAE6FD',
			accent: '#22D3EE',
			text: '#F0F9FF',
			overlay: '#0C4A6E',
			ctaBg: '#ECFEFF',
			ctaText: '#155E75',
			brush: '#06B6D4',
			brandBar: 'rgba(12,74,110,0.55)',
		},
		titlePosition: 'center',
		overlayStyle: 'vignette',
		overlayIntensity: 0.55,
		decoration: 'accent',
		ctaStyle: 'pill-cool',
		brandPlacement: 'corner',
		scriptAccent: false,
	},
	snacks: {
		label: 'Snacks',
		moods: ['playful', 'quick', 'craveable'],
		preferredLayouts: ['bold_typography', 'ribbon_banner', 'dark_title_box', 'centered_hero', 'brush_stroke'],
		fontHeading: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
		fontScript: 'Georgia, "Times New Roman", serif',
		palette: {
			primary: '#DC2626',
			secondary: '#FECACA',
			accent: '#FB923C',
			text: '#FFFFFF',
			overlay: '#450A0A',
			ctaBg: '#FFFFFF',
			ctaText: '#991B1B',
			brush: '#EF4444',
			brandBar: 'rgba(69,10,10,0.55)',
		},
		titlePosition: 'center',
		overlayStyle: 'dark',
		overlayIntensity: 0.42,
		decoration: 'ribbon',
		ctaStyle: 'sharp',
		brandPlacement: 'corner',
		scriptAccent: false,
	},
	general: {
		label: 'Recipe',
		moods: ['inviting', 'reliable', 'homey'],
		preferredLayouts: ['brush_stroke', 'centered_hero', 'white_rounded_card', 'top_title_bottom_cta', 'magazine'],
		fontHeading: 'Georgia, "Times New Roman", serif',
		fontScript: '"Segoe Script", "Brush Script MT", cursive',
		palette: {
			primary: '#B45309',
			secondary: '#FDE68A',
			accent: '#F59E0B',
			text: '#FFFFFF',
			overlay: '#1C1917',
			ctaBg: '#FFFFFF',
			ctaText: '#78350F',
			brush: '#D97706',
			brandBar: 'rgba(28,25,23,0.5)',
		},
		titlePosition: 'bottom',
		overlayStyle: 'gradient',
		overlayIntensity: 0.6,
		decoration: 'brush',
		ctaStyle: 'pill-warm',
		brandPlacement: 'bottom-bar',
		scriptAccent: false,
	},
};

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

/**
 * Analyze recipe signals from article / pin / analysis / panel.
 */
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
	Object.entries(INGREDIENT_HINTS).forEach(([fam, re]) => {
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

function ctaStyleToButton(ctaStyle, palette) {
	switch (ctaStyle) {
		case 'pill-clean':
			return { background: palette.ctaBg, textColor: palette.ctaText, borderRadius: 999, padding: 14, shadow: false };
		case 'pill-sunny':
		case 'pill-warm':
			return { background: palette.ctaBg, textColor: palette.ctaText, borderRadius: 999, padding: 15, shadow: true };
		case 'pill-cool':
			return { background: palette.ctaBg, textColor: palette.ctaText, borderRadius: 999, padding: 14, shadow: true };
		case 'solid-warm':
			return { background: palette.ctaBg, textColor: palette.ctaText, borderRadius: 14, padding: 16, shadow: true };
		case 'sharp':
			return { background: palette.ctaBg, textColor: palette.ctaText, borderRadius: 6, padding: 14, shadow: true };
		default:
			return { background: palette.ctaBg, textColor: palette.ctaText, borderRadius: 999, padding: 14, shadow: true };
	}
}

function decorationPatch(decoration, palette, scriptAccent) {
	switch (decoration) {
		case 'brush':
			return {
				brushHighlight: true,
				brushColor: palette.brush,
				brushOpacity: 0.88,
				roundedLabel: true,
				underline: false,
				accentShapes: true,
				accentColor: palette.secondary,
			};
		case 'underline':
			return {
				brushHighlight: false,
				roundedLabel: false,
				underline: true,
				underlineColor: palette.secondary,
				accentShapes: false,
				brushColor: palette.brush,
				accentColor: palette.accent,
			};
		case 'ribbon':
			return {
				brushHighlight: false,
				roundedLabel: false,
				underline: false,
				accentShapes: true,
				brushColor: palette.primary,
				accentColor: palette.secondary,
			};
		case 'accent':
			return {
				brushHighlight: false,
				roundedLabel: true,
				underline: false,
				accentShapes: true,
				brushColor: palette.brush,
				accentColor: palette.accent,
			};
		default:
			return {
				brushHighlight: Boolean(scriptAccent),
				brushColor: palette.brush,
				brushOpacity: 0.8,
				roundedLabel: true,
				underline: false,
				accentShapes: true,
				accentColor: palette.accent,
			};
	}
}

function hashPick(seed, list) {
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

function layoutFitsSignals(layoutId, signals) {
	const layout = getPinLayoutById(layoutId);
	if (!layout) return 0;
	let score = 4;
	const tags = layout.tags || [];
	if (signals.cookingMinutes <= 20 && (tags.includes('short') || tags.includes('bold') || tags.includes('cta'))) score += 5;
	if (signals.cookingMinutes >= 60 && (tags.includes('editorial') || tags.includes('magazine') || tags.includes('long'))) score += 5;
	if (signals.difficulty === 'easy' && (tags.includes('clean') || tags.includes('card') || tags.includes('minimal'))) score += 4;
	if (signals.difficulty === 'advanced' && (tags.includes('magazine') || tags.includes('elegant') || tags.includes('editorial'))) score += 4;
	if (signals.mood === 'indulgent' && (tags.includes('brush') || tags.includes('script') || layoutId.includes('handwritten'))) score += 6;
	if (signals.mood === 'fresh' && (tags.includes('clean') || tags.includes('minimal') || tags.includes('card'))) score += 6;
	if (signals.mood === 'playful' && (tags.includes('ribbon') || tags.includes('bold') || tags.includes('impact'))) score += 6;
	if (signals.audience === 'health_conscious' && (tags.includes('clean') || tags.includes('minimal'))) score += 4;
	if (signals.audience === 'entertaining' && (tags.includes('elegant') || tags.includes('magazine') || tags.includes('script'))) score += 4;
	return score;
}

/**
 * Build a full design recommendation for one pin.
 */
export function recommendPinDesign({
	article = null,
	pin = null,
	analysis = null,
	panel = null,
	index = 0,
	usedLayoutIds = [],
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

		// Variety within the family: rotate among top scorers using pin title + index (deterministic).
		const top = ranked.slice(0, Math.min(3, ranked.length));
		const seed = `${signals.family}:${pin?.title || article?.title || ''}:${index}`;
		templateId = hashPick(seed, top.map((item) => item.id)) || ranked[0]?.id || preferredPool[0];
	}

	const layout = getPinLayoutById(templateId) || PIN_LAYOUT_CATALOG[0];
	const palette = {
		...identity.palette,
		...(aiRecommendation?.colorPalette && typeof aiRecommendation.colorPalette === 'object'
			? {
				primary: aiRecommendation.colorPalette.primary || identity.palette.primary,
				secondary: aiRecommendation.colorPalette.secondary || identity.palette.secondary,
				accent: aiRecommendation.colorPalette.accent || identity.palette.accent,
				text: aiRecommendation.colorPalette.text || identity.palette.text,
				overlay: aiRecommendation.colorPalette.overlay || identity.palette.overlay,
				ctaBg: aiRecommendation.colorPalette.ctaBg || identity.palette.ctaBg,
				ctaText: aiRecommendation.colorPalette.ctaText || identity.palette.ctaText,
				brush: aiRecommendation.colorPalette.brush || identity.palette.brush,
			}
			: {}),
	};

	const titlePosition = ['top', 'center', 'bottom'].includes(aiRecommendation?.titlePosition)
		? aiRecommendation.titlePosition
		: (signals.cookingMinutes <= 20 && signals.family === 'snacks'
			? 'center'
			: identity.titlePosition);

	const overlayStyle = ['gradient', 'dark', 'vignette', 'none'].includes(aiRecommendation?.overlayStyle)
		? aiRecommendation.overlayStyle
		: identity.overlayStyle;

	const decoration = String(aiRecommendation?.decoration || identity.decoration);
	const brandPlacement = ['bottom-bar', 'corner', 'inside-card', 'hidden'].includes(aiRecommendation?.brandPlacement)
		? aiRecommendation.brandPlacement
		: identity.brandPlacement;

	const fontPair = {
		heading: aiRecommendation?.fontPair?.heading || identity.fontHeading,
		script: aiRecommendation?.fontPair?.script || identity.fontScript,
	};

	const ctaStyle = String(aiRecommendation?.ctaStyle || identity.ctaStyle);
	const scriptEnabled = Boolean(
		aiRecommendation?.scriptAccent
		?? (identity.scriptAccent && (templateId === 'handwritten_accent' || signals.mood === 'indulgent' || signals.mood === 'elegant')),
	);

	const recommendation = {
		family: signals.family,
		familyLabel: identity.label,
		signals,
		template: layout.id,
		templateLabel: layout.label,
		fontPair,
		colorPalette: palette,
		titlePosition,
		ctaStyle,
		overlayStyle,
		overlayIntensity: Number(aiRecommendation?.overlayIntensity) || identity.overlayIntensity,
		decoration,
		brandPlacement,
		scriptAccent: scriptEnabled,
		rationale: [
			`${identity.label} identity`,
			`mood:${signals.mood}`,
			`time:${signals.cookingTime}`,
			`difficulty:${signals.difficulty}`,
			`audience:${signals.audience}`,
		].join(' · '),
	};

	return recommendation;
}

/**
 * Convert a design recommendation into canvas template config overrides.
 */
export function recommendationToTemplatePatch(recommendation) {
	const palette = recommendation.colorPalette || CATEGORY_VISUAL_IDENTITIES.general.palette;
	const button = ctaStyleToButton(recommendation.ctaStyle, palette);
	const decorations = decorationPatch(recommendation.decoration, palette, recommendation.scriptAccent);

	return {
		layout: {
			textPosition: recommendation.titlePosition,
			brandPlacement: recommendation.brandPlacement,
			showBrandBar: recommendation.brandPlacement === 'bottom-bar' || recommendation.brandPlacement === 'inside-card',
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
		},
		decorations: {
			...decorations,
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

/**
 * Assign intelligent design recommendations to a pin batch.
 * Stays inside the recipe family's visual identity while varying templates.
 */
export function assignIntelligentPinDesigns(pins, {
	article = null,
	analysis = null,
	panel = null,
} = {}) {
	const list = Array.isArray(pins) ? pins : [];
	const usedLayoutIds = [];

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

		const recommendation = recommendPinDesign({
			article,
			pin,
			analysis,
			panel,
			index,
			usedLayoutIds,
			aiRecommendation,
		});

		usedLayoutIds.push(recommendation.template);

		return {
			...pin,
			layoutId: recommendation.template,
			layoutLabel: recommendation.templateLabel,
			layoutStyle: recommendation.template,
			designRecommendation: recommendation,
			recipeFamily: recommendation.family,
			recipeFamilyLabel: recommendation.familyLabel,
		};
	});
}

/**
 * Apply catalog layout + intelligence recommendation (+ brand kit) for render.
 */
export function applyIntelligentTemplateConfig(baseConfig, recommendation, { brandKit = null } = {}) {
	const layoutId = recommendation?.template || recommendation?.layoutId || 'brush_stroke';
	let config = applyBaseLayout(baseConfig, layoutId, { brandKit: null });
	const patch = recommendationToTemplatePatch(recommendation || recommendPinDesign({}));

	config = {
		...config,
		layout: { ...config.layout, ...patch.layout, variantId: layoutId, variantLabel: recommendation?.templateLabel || layoutId },
		textOverlay: { ...config.textOverlay, ...patch.textOverlay },
		typography: { ...config.typography, ...patch.typography },
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
