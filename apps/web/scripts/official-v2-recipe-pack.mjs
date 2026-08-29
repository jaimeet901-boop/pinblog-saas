/**
 * Hand-authored official v2 layer templates appended after layout-generated catalog.
 * Keep separate so regenerate does not wipe these entries.
 */

function buildRecipeIngredientsCardThumbnail() {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#1c1917"/><stop offset="0.45" stop-color="#44403c"/><stop offset="1" stop-color="#d7eaf7"/></linearGradient></defs>
<rect width="400" height="600" fill="url(#g)"/>
<rect x="0" y="0" width="400" height="320" fill="#78716c"/>
<text x="200" y="280" text-anchor="middle" fill="#fff" font-family="Georgia,serif" font-size="20" font-weight="700">Recipe title</text>
<rect x="28" y="340" width="344" height="230" rx="22" fill="#d7eaf7"/>
<text x="52" y="380" text-anchor="start" fill="#1c1917" font-family="Georgia,serif" font-size="18" font-weight="700">You&#39;ll Need...</text>
<text x="52" y="420" text-anchor="start" fill="#44403c" font-family="Segoe UI,sans-serif" font-size="13">• Ingredient one</text>
<text x="52" y="444" text-anchor="start" fill="#44403c" font-family="Segoe UI,sans-serif" font-size="13">• Ingredient two</text>
<text x="52" y="468" text-anchor="start" fill="#44403c" font-family="Segoe UI,sans-serif" font-size="13">• Ingredient three</text>
<text x="200" y="580" text-anchor="middle" fill="rgba(28,25,23,0.55)" font-family="Segoe UI,sans-serif" font-size="11">v2 · ingredients · panel</text>
</svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function layer(partial) {
	return {
		rotation: 0,
		opacity: 1,
		borderRadius: 0,
		visible: true,
		locked: false,
		groupId: null,
		...partial,
	};
}

/**
 * Recipe Ingredients Card — official v2 Pinterest template (MVP, no secondary image).
 */
export function buildRecipeIngredientsCardEntry() {
	return {
		templateUuid: 'chefia-official-recipe-ingredients-card',
		name: 'Recipe Ingredients Card',
		category: 'recipes',
		tags: ['recipe', 'recipes', 'ingredients', 'card', 'pinterest', 'v2'],
		layoutId: 'recipe_ingredients_card',
		channel: 'pinterest',
		configuration: {
			editorVersion: 2,
			schemaVersion: 2,
			canvas: { width: 1000, height: 1500 },
			category: 'recipes',
			meta: {
				brandKitId: null,
				variantGroupId: null,
				autoLayoutProfile: null,
				marketplaceMeta: null,
			},
			groups: [],
			layers: [
				layer({
					id: 'lyr_ric_bg',
					type: 'background',
					name: 'Background',
					x: 0,
					y: 0,
					width: 1000,
					height: 1500,
					zIndex: 0,
					props: { color: '#F5F8FB', imageSrc: '' },
				}),
				layer({
					id: 'lyr_ric_hero',
					type: 'image',
					name: 'Main image',
					x: 0,
					y: 0,
					width: 1000,
					height: 820,
					zIndex: 1,
					props: {
						src: '{{image}}',
						fit: 'cover',
						focusX: 0.5,
						focusY: 0.35,
					},
				}),
				layer({
					id: 'lyr_ric_hero_shade',
					type: 'gradient',
					name: 'Title shade',
					x: 0,
					y: 520,
					width: 1000,
					height: 300,
					zIndex: 2,
					props: {
						colors: ['rgba(0,0,0,0)', 'rgba(28,25,23,0.72)'],
						angle: 90,
					},
				}),
				layer({
					id: 'lyr_ric_title',
					type: 'text',
					name: 'Recipe title',
					x: 56,
					y: 620,
					width: 888,
					height: 160,
					zIndex: 3,
					props: {
						text: '{{title}}',
						fontFamily: 'Georgia, "Times New Roman", serif',
						fontSize: 64,
						fontWeight: 700,
						color: '#FFFFFF',
						align: 'center',
						lineHeight: 1.12,
						maxLines: 3,
						shadow: true,
					},
				}),
				layer({
					id: 'lyr_ric_panel',
					type: 'shape',
					name: 'Ingredients panel',
					x: 40,
					y: 860,
					width: 920,
					height: 600,
					borderRadius: 28,
					zIndex: 4,
					props: {
						shape: 'rect',
						fill: '#D7EAF7',
						stroke: '',
						strokeWidth: 0,
					},
				}),
				layer({
					id: 'lyr_ric_heading',
					type: 'text',
					name: "You'll Need heading",
					x: 72,
					y: 892,
					width: 856,
					height: 52,
					zIndex: 5,
					props: {
						text: "You'll Need...",
						fontFamily: 'Georgia, "Times New Roman", serif',
						fontSize: 36,
						fontWeight: 700,
						color: '#1C1917',
						align: 'left',
						lineHeight: 1.15,
						maxLines: 1,
						shadow: false,
					},
				}),
				layer({
					id: 'lyr_ric_ingredients',
					type: 'text',
					name: 'Ingredients list',
					x: 72,
					y: 960,
					width: 856,
					height: 400,
					zIndex: 6,
					props: {
						text: '{{ingredients}}',
						fontFamily: '"Segoe UI", Calibri, sans-serif',
						fontSize: 30,
						fontWeight: 500,
						color: '#292524',
						align: 'left',
						lineHeight: 1.35,
						maxLines: 11,
						shadow: false,
					},
				}),
				layer({
					id: 'lyr_ric_subtitle',
					type: 'text',
					name: 'Subtitle',
					x: 72,
					y: 1388,
					width: 856,
					height: 44,
					zIndex: 7,
					props: {
						text: '{{subtitle}}',
						fontFamily: '"Segoe UI", Calibri, sans-serif',
						fontSize: 22,
						fontWeight: 500,
						color: '#57534E',
						align: 'left',
						lineHeight: 1.2,
						maxLines: 1,
						shadow: false,
					},
				}),
			],
		},
		thumbnail: buildRecipeIngredientsCardThumbnail(),
	};
}

/** All hand-authored official v2 Pinterest templates. */
export function listOfficialV2PinterestTemplatePack() {
	return [buildRecipeIngredientsCardEntry()];
}
