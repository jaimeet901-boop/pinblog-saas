/**
 * Hand-authored official v2 layer templates appended after layout-generated catalog.
 * Keep separate so regenerate does not wipe these entries.
 */

function buildRecipeIngredientsCardThumbnail() {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#1c1917"/><stop offset="0.45" stop-color="#44403c"/><stop offset="1" stop-color="#d7eaf7"/></linearGradient></defs>
<rect width="400" height="600" fill="url(#g)"/>
<rect x="0" y="0" width="400" height="300" fill="#78716c"/>
<text x="200" y="265" text-anchor="middle" fill="#fff" font-family="Georgia,serif" font-size="22" font-weight="700">Recipe title</text>
<rect x="24" y="318" width="352" height="250" rx="22" fill="#d7eaf7"/>
<text x="48" y="362" text-anchor="start" fill="#1c1917" font-family="Georgia,serif" font-size="20" font-weight="700">You&#39;ll Need...</text>
<text x="48" y="402" text-anchor="start" fill="#44403c" font-family="Segoe UI,sans-serif" font-size="14">* Ingredient one</text>
<text x="48" y="430" text-anchor="start" fill="#44403c" font-family="Segoe UI,sans-serif" font-size="14">* Ingredient two</text>
<text x="48" y="458" text-anchor="start" fill="#44403c" font-family="Segoe UI,sans-serif" font-size="14">* Ingredient three</text>
<text x="48" y="486" text-anchor="start" fill="#44403c" font-family="Segoe UI,sans-serif" font-size="14">* Ingredient four</text>
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
 * Balanced for ~6–10 bulleted ingredient lines with a strong "You'll Need..." header.
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
					props: { color: '#EEF4F8', imageSrc: '' },
				}),
				layer({
					id: 'lyr_ric_hero',
					type: 'image',
					name: 'Main image',
					x: 0,
					y: 0,
					width: 1000,
					height: 780,
					zIndex: 1,
					props: {
						src: '{{image}}',
						fit: 'cover',
						focusX: 0.5,
						focusY: 0.38,
					},
				}),
				layer({
					id: 'lyr_ric_hero_shade',
					type: 'gradient',
					name: 'Title shade',
					x: 0,
					y: 480,
					width: 1000,
					height: 300,
					zIndex: 2,
					props: {
						colors: ['rgba(0,0,0,0)', 'rgba(28,25,23,0.78)'],
						angle: 90,
					},
				}),
				layer({
					id: 'lyr_ric_title',
					type: 'text',
					name: 'Recipe title',
					x: 48,
					y: 560,
					width: 904,
					height: 180,
					zIndex: 3,
					props: {
						text: '{{title}}',
						fontFamily: 'Georgia, "Times New Roman", serif',
						fontSize: 68,
						fontWeight: 700,
						color: '#FFFFFF',
						align: 'center',
						lineHeight: 1.1,
						maxLines: 3,
						shadow: true,
					},
				}),
				layer({
					id: 'lyr_ric_panel',
					type: 'shape',
					name: 'Ingredients panel',
					x: 36,
					y: 800,
					width: 928,
					height: 660,
					borderRadius: 32,
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
					y: 836,
					width: 856,
					height: 64,
					zIndex: 5,
					props: {
						text: "You'll Need...",
						fontFamily: 'Georgia, "Times New Roman", serif',
						fontSize: 48,
						fontWeight: 700,
						color: '#1C1917',
						align: 'left',
						lineHeight: 1.1,
						maxLines: 1,
						shadow: false,
					},
				}),
				layer({
					id: 'lyr_ric_ingredients',
					type: 'text',
					name: 'Ingredients list',
					x: 72,
					y: 920,
					width: 856,
					height: 460,
					zIndex: 6,
					props: {
						text: '{{ingredients}}',
						fontFamily: '"Segoe UI", Calibri, sans-serif',
						fontSize: 32,
						fontWeight: 500,
						color: '#292524',
						align: 'left',
						lineHeight: 1.55,
						maxLines: 11,
						shadow: false,
					},
				}),
				layer({
					id: 'lyr_ric_subtitle',
					type: 'text',
					name: 'Subtitle',
					x: 72,
					y: 1400,
					width: 856,
					height: 40,
					zIndex: 7,
					props: {
						text: '{{subtitle}}',
						fontFamily: '"Segoe UI", Calibri, sans-serif',
						fontSize: 24,
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

export function listOfficialV2PinterestTemplatePack() {
	return [buildRecipeIngredientsCardEntry()];
}
