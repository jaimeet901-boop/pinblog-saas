import { describe, expect, it } from 'vitest';
import {
	IMAGE_SOURCE_STRATEGY,
	listArticleImageCandidates,
	planImageSource,
} from '../imageSourceStrategy.js';

function uniqueHttpUrls(urls = []) {
	const seen = new Set();
	const out = [];
	for (const raw of urls) {
		const url = String(raw || '').trim();
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}

/** Mirrors resolveArticleImageSources priority with injectable reachability. */
async function resolveWithProbe({
	existingFeaturedImage = '',
	parsedFeatured = '',
	scrapedContentImages = [],
	isReachable,
}) {
	const featuredExisting = String(existingFeaturedImage || '').trim();
	const parsed = String(parsedFeatured || '').trim();
	const scraped = Array.isArray(scrapedContentImages) ? scrapedContentImages : [];

	if (featuredExisting && await isReachable(featuredExisting)) {
		return { resolvedImage: featuredExisting, source: 'stored' };
	}
	if (parsed && await isReachable(parsed)) {
		return { resolvedImage: parsed, source: 'meta_or_body' };
	}
	for (const url of uniqueHttpUrls(scraped)) {
		if (await isReachable(url)) {
			return { resolvedImage: url, source: 'body' };
		}
	}
	return { resolvedImage: '', source: 'none' };
}

describe('image pipeline priority', () => {
	const reachable = new Set([
		'https://cdn.example/og.webp',
		'https://cdn.example/body-1.webp',
	]);
	const isReachable = async (url) => reachable.has(url);

	it('AI-first plan uses generated mode and allows article fallback', () => {
		const plan = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.AI_FIRST,
			articleImageUrl: 'https://cdn.example/og.webp',
		});
		expect(plan.useAi).toBe(true);
		expect(plan.allowArticleFallback).toBe(true);
		expect(plan.imageMode).toBe('generate_ai');
	});

	it('stored featured 404 falls back to parsed featured', async () => {
		const resolved = await resolveWithProbe({
			existingFeaturedImage: 'https://cdn.example/stale-404.webp',
			parsedFeatured: 'https://cdn.example/og.webp',
			scrapedContentImages: ['https://cdn.example/body-1.webp'],
			isReachable,
		});
		expect(resolved.source).toBe('meta_or_body');
		expect(resolved.resolvedImage).toBe('https://cdn.example/og.webp');
	});

	it('invalid parsed featured falls back to first content image', async () => {
		const resolved = await resolveWithProbe({
			existingFeaturedImage: 'https://cdn.example/stale-404.webp',
			parsedFeatured: 'https://cdn.example/bad-og.webp',
			scrapedContentImages: [
				'https://cdn.example/dead.webp',
				'https://cdn.example/body-1.webp',
			],
			isReachable,
		});
		expect(resolved.source).toBe('body');
		expect(resolved.resolvedImage).toBe('https://cdn.example/body-1.webp');
	});

	it('no valid images resolves empty for graceful UI handling', async () => {
		const resolved = await resolveWithProbe({
			existingFeaturedImage: 'https://cdn.example/stale-404.webp',
			parsedFeatured: 'https://cdn.example/bad-og.webp',
			scrapedContentImages: ['https://cdn.example/dead.webp'],
			isReachable,
		});
		expect(resolved.source).toBe('none');
		expect(resolved.resolvedImage).toBe('');
	});

	it('compose candidates keep content images after a stale featured URL', () => {
		expect(listArticleImageCandidates({
			featuredImage: 'https://cdn.example/stale-404.webp',
			contentImages: ['https://cdn.example/body-1.webp'],
		})).toEqual([
			'https://cdn.example/stale-404.webp',
			'https://cdn.example/body-1.webp',
		]);
	});
});
