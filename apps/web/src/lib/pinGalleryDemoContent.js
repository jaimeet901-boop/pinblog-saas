/**
 * Built-in demo recipe content for gallery pin previews.
 * Used when the user has not selected an article yet.
 * Food photos: Unsplash (loaded via same-origin compose proxy at render time).
 */

import { formatIngredientsList, resolveIngredientsForContext } from './pinIngredients.js';

/** Curated food photography — portrait crops suitable for 1000×1500 pins. */
export const DEMO_FOOD_IMAGES = Object.freeze([
	'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1555939594-58edc7c0ef18?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=1000&h=1500&q=80',
	'https://images.unsplash.com/photo-1432139555190-58524da6b326?auto=format&fit=crop&w=1000&h=1500&q=80',
]);

export const DEMO_RECIPES = Object.freeze([
	{
		title: 'Greek Lemon Herb Chicken Bowl',
		subtitle: 'Weeknight dinner',
		category: 'Dinner',
		description: 'Bright lemon, herbs, and roasted chicken over warm grains.',
		website: 'seodeva.demo',
		cta: 'Save Recipe',
		ingredients: [
			'2 chicken breasts',
			'1 cup cooked grains',
			'1 lemon',
			'Fresh herbs',
			'Olive oil',
			'Sea salt',
		],
	},
	{
		title: 'Creamy Vanilla Berry Pudding',
		subtitle: 'Easy dessert',
		category: 'Desserts',
		description: 'Silky vanilla pudding topped with macerated berries.',
		website: 'seodeva.demo',
		cta: 'Get the Recipe',
		ingredients: [
			'2 cups milk',
			'1/3 cup sugar',
			'2 tbsp cornstarch',
			'1 tsp vanilla',
			'Fresh berries',
		],
	},
	{
		title: 'Street Corn Chicken Skillet',
		subtitle: '30-minute meal',
		category: 'Dinner',
		description: 'Charred corn, chili-lime chicken, and fresh cilantro.',
		website: 'seodeva.demo',
		cta: 'Cook This',
		ingredients: [
			'1 lb chicken thighs',
			'2 cups corn',
			'Chili powder',
			'Lime',
			'Cilantro',
			'Cotija cheese',
		],
	},
	{
		title: 'Honey Garlic Salmon',
		subtitle: 'Healthy dinner',
		category: 'Healthy',
		description: 'Glazed salmon with crispy edges and sticky honey garlic sauce.',
		website: 'seodeva.demo',
		cta: 'Save Recipe',
		ingredients: [
			'2 salmon fillets',
			'3 tbsp honey',
			'3 garlic cloves',
			'Soy sauce',
			'Black pepper',
		],
	},
	{
		title: 'Fluffy Blueberry Pancakes',
		subtitle: 'Weekend breakfast',
		category: 'Breakfast',
		description: 'Buttermilk pancakes loaded with juicy blueberries.',
		website: 'seodeva.demo',
		cta: 'Make Breakfast',
		ingredients: [
			'1 1/2 cups flour',
			'1 cup buttermilk',
			'1 egg',
			'1 cup blueberries',
			'2 tbsp butter',
		],
	},
	{
		title: 'Iced Matcha Latte',
		subtitle: 'Café drinks',
		category: 'Drinks',
		description: 'Creamy iced matcha with a soft foam finish.',
		website: 'seodeva.demo',
		cta: 'Save Drink',
		ingredients: [
			'1 tsp matcha powder',
			'1 cup milk',
			'Ice',
			'1 tsp honey',
		],
	},
]);

/**
 * Canvas fallback food plate when remote images fail (still not a black stub).
 */
export function buildFallbackFoodImageDataUrl(seed = 0) {
	if (typeof document === 'undefined') return '';
	const palette = [
		['#7c2d12', '#b45309', '#fde68a'],
		['#9f1239', '#be123c', '#fecdd3'],
		['#14532d', '#16a34a', '#bbf7d0'],
		['#1e3a8a', '#2563eb', '#bfdbfe'],
		['#78350f', '#d97706', '#ffedd5'],
		['#4c1d95', '#7c3aed', '#ddd6fe'],
	];
	const [c1, c2, accent] = palette[Math.abs(Number(seed) || 0) % palette.length];
	const canvas = document.createElement('canvas');
	canvas.width = 1000;
	canvas.height = 1500;
	const ctx = canvas.getContext('2d');
	if (!ctx) return '';
	const g = ctx.createLinearGradient(0, 0, 1000, 1500);
	g.addColorStop(0, c1);
	g.addColorStop(0.45, c2);
	g.addColorStop(1, '#1c1917');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 1000, 1500);
	ctx.fillStyle = `${accent}55`;
	ctx.beginPath();
	ctx.arc(720, 420, 280, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = 'rgba(255,255,255,0.14)';
	ctx.beginPath();
	ctx.ellipse(430, 980, 360, 200, -0.35, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = 'rgba(255,255,255,0.08)';
	ctx.beginPath();
	ctx.arc(180, 260, 140, 0, Math.PI * 2);
	ctx.fill();
	return canvas.toDataURL('image/jpeg', 0.9);
}

function domainFromUrl(value) {
	try {
		const host = new URL(String(value || '')).hostname.replace(/^www\./, '');
		return host || 'seodeva.demo';
	} catch {
		return 'seodeva.demo';
	}
}

/**
 * Resolve preview content for gallery cards.
 * @param {{ article?: object|null, templateIndex?: number, templateId?: string }} options
 */
export function resolveGalleryPreviewContent({ article = null, templateIndex = 0, templateId = '' } = {}) {
	const recipe = DEMO_RECIPES[Math.abs(templateIndex) % DEMO_RECIPES.length];
	const imageIndex = Math.abs((templateIndex * 3) + String(templateId || '').length) % DEMO_FOOD_IMAGES.length;
	const featuredFromArticle = String(article?.featuredImage || article?.featured_image || '').trim();
	const titleFromArticle = String(article?.title || '').trim();

	if (titleFromArticle || featuredFromArticle) {
		const ingredients = resolveIngredientsForContext({
			content: {
				ingredients: article?.ingredients,
				sections: article?.sections,
				recipe_schema: article?.recipe_schema || article?.recipeSchema,
				recipe: article?.recipe,
			},
			variables: {},
		}) || formatIngredientsList(recipe.ingredients);
		return {
			source: 'article',
			title: titleFromArticle || recipe.title,
			subtitle: String(article?.metaDescription || article?.excerpt || recipe.subtitle).trim().slice(0, 80) || recipe.subtitle,
			category: String(article?.category || recipe.category).trim() || recipe.category,
			description: String(article?.metaDescription || recipe.description).trim() || recipe.description,
			website: domainFromUrl(article?.url || article?.website),
			cta: 'Save Recipe',
			ingredients,
			featuredImageUrl: featuredFromArticle || DEMO_FOOD_IMAGES[imageIndex],
			imageSeed: imageIndex,
			contentKey: `article:${article?.id || titleFromArticle}:${featuredFromArticle.slice(0, 80)}`,
		};
	}

	return {
		source: 'demo',
		title: recipe.title,
		subtitle: recipe.subtitle,
		category: recipe.category,
		description: recipe.description,
		website: recipe.website,
		cta: recipe.cta,
		ingredients: formatIngredientsList(recipe.ingredients),
		featuredImageUrl: DEMO_FOOD_IMAGES[imageIndex],
		imageSeed: imageIndex,
		contentKey: `demo:${recipe.title}:${imageIndex}`,
	};
}
