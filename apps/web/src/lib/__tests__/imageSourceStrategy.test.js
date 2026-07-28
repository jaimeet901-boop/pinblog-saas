import { describe, expect, it } from 'vitest';
import {
	IMAGE_SOURCE_STRATEGY,
	listArticleImageCandidates,
	normalizeImageSourceStrategy,
	pickArticleImageUrl,
	planImageSource,
} from '../imageSourceStrategy.js';

describe('imageSourceStrategy', () => {
	it('normalizes strategy aliases', () => {
		expect(normalizeImageSourceStrategy('Featured Image First')).toBe(IMAGE_SOURCE_STRATEGY.FEATURED_FIRST);
		expect(normalizeImageSourceStrategy('ai-first')).toBe(IMAGE_SOURCE_STRATEGY.AI_FIRST);
		expect(normalizeImageSourceStrategy('')).toBe(IMAGE_SOURCE_STRATEGY.AI_FIRST);
	});

	it('featured_first uses article image when present', () => {
		const plan = planImageSource({
			strategy: 'featured_first',
			articleImageUrl: 'https://cdn.example/hero.jpg',
		});
		expect(plan.useAi).toBe(false);
		expect(plan.imageMode).toBe('use_featured');
	});

	it('featured_first falls back to AI when no article image', () => {
		const plan = planImageSource({ strategy: 'featured_first', articleImageUrl: '' });
		expect(plan.useAi).toBe(true);
		expect(plan.imageMode).toBe('generate_ai');
	});

	it('ai_first always requests AI but allows article fallback', () => {
		const plan = planImageSource({
			strategy: 'ai_first',
			articleImageUrl: 'https://cdn.example/a.jpg',
		});
		expect(plan.useAi).toBe(true);
		expect(plan.allowArticleFallback).toBe(true);
	});

	it('default / empty strategy is AI first', () => {
		const plan = planImageSource({
			strategy: '',
			articleImageUrl: 'https://cdn.example/a.jpg',
		});
		expect(plan.strategy).toBe(IMAGE_SOURCE_STRATEGY.AI_FIRST);
		expect(plan.useAi).toBe(true);
		expect(plan.allowArticleFallback).toBe(true);
	});

	it('always_ai allows article fallback when image exists', () => {
		const withImage = planImageSource({
			strategy: 'always_ai',
			articleImageUrl: 'https://cdn.example/a.jpg',
		});
		expect(withImage.useAi).toBe(true);
		expect(withImage.allowArticleFallback).toBe(true);

		const without = planImageSource({ strategy: 'always_ai', articleImageUrl: '' });
		expect(without.allowArticleFallback).toBe(false);
	});

	it('pickArticleImageUrl prefers featured then content images', () => {
		expect(pickArticleImageUrl({
			featuredImage: 'https://cdn.example/featured.jpg',
			contentImages: ['https://cdn.example/body.jpg'],
		})).toBe('https://cdn.example/featured.jpg');

		expect(pickArticleImageUrl({
			contentImages: ['https://cdn.example/body.jpg'],
		})).toBe('https://cdn.example/body.jpg');
	});

	it('listArticleImageCandidates keeps featured before content images', () => {
		expect(listArticleImageCandidates({
			featuredImage: 'https://cdn.example/featured.jpg',
			sourceImageUrl: 'https://cdn.example/featured.jpg',
			contentImages: ['https://cdn.example/body.jpg', 'https://cdn.example/extra.jpg'],
		})).toEqual([
			'https://cdn.example/featured.jpg',
			'https://cdn.example/body.jpg',
			'https://cdn.example/extra.jpg',
		]);
	});
});
