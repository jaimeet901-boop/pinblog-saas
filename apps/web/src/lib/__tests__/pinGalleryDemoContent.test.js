import { describe, expect, it } from 'vitest';
import {
	DEMO_FOOD_IMAGES,
	DEMO_RECIPES,
	resolveGalleryPreviewContent,
} from '../pinGalleryDemoContent.js';

describe('pinGalleryDemoContent', () => {
	it('provides multiple demo recipes and food images', () => {
		expect(DEMO_RECIPES.length).toBeGreaterThanOrEqual(4);
		expect(DEMO_FOOD_IMAGES.length).toBeGreaterThanOrEqual(6);
		expect(DEMO_FOOD_IMAGES.every((url) => url.startsWith('https://'))).toBe(true);
	});

	it('uses demo content when no article is selected', () => {
		const content = resolveGalleryPreviewContent({ templateIndex: 0, templateId: 't1' });
		expect(content.source).toBe('demo');
		expect(content.title).toBeTruthy();
		expect(content.featuredImageUrl).toMatch(/^https:\/\//);
		expect(content.contentKey).toMatch(/^demo:/);
	});

	it('switches to article content when an article is provided', () => {
		const content = resolveGalleryPreviewContent({
			templateIndex: 0,
			templateId: 't1',
			article: {
				id: 'a1',
				title: 'My Real Pasta Recipe',
				featuredImage: 'https://cdn.example.com/pasta.jpg',
				metaDescription: 'Homemade sauce',
				category: 'Dinner',
				url: 'https://blog.example.com/pasta',
			},
		});
		expect(content.source).toBe('article');
		expect(content.title).toBe('My Real Pasta Recipe');
		expect(content.featuredImageUrl).toBe('https://cdn.example.com/pasta.jpg');
		expect(content.website).toBe('blog.example.com');
		expect(content.contentKey).toContain('article:a1');
	});
});
