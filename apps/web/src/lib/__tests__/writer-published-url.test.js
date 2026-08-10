import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	applyPublishedUrlPatch,
	buildGenerationMediaPreserve,
	resolvePublishedUrlFromResponse,
	shouldApplyPublishedUrlToArticle,
	shouldShowPublishedSuccessBanner,
} from '../writer-published-url.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const writerPagePath = path.resolve(here, '../../pages/app/WriterPage.jsx');

describe('writer-published-url helpers', () => {
	it('resolvePublishedUrlFromResponse prefers link then url from API payload', () => {
		expect(resolvePublishedUrlFromResponse({ link: 'https://blog.example/post-1/' })).toBe('https://blog.example/post-1/');
		expect(resolvePublishedUrlFromResponse({ url: 'https://blog.example/post-2/' })).toBe('https://blog.example/post-2/');
		expect(resolvePublishedUrlFromResponse({ link: 'https://primary/', url: 'https://fallback/' })).toBe('https://primary/');
		expect(resolvePublishedUrlFromResponse({})).toBe('');
	});

	it('shouldShowPublishedSuccessBanner hides while publishing and requires a URL', () => {
		expect(shouldShowPublishedSuccessBanner({ publishedUrl: 'https://blog.example/p/', publishing: false })).toBe(true);
		expect(shouldShowPublishedSuccessBanner({ publishedUrl: 'https://blog.example/p/', publishing: true })).toBe(false);
		expect(shouldShowPublishedSuccessBanner({ publishedUrl: '', publishing: false })).toBe(false);
	});

	it('shouldApplyPublishedUrlToArticle only for live publish responses with a URL', () => {
		expect(shouldApplyPublishedUrlToArticle({
			wpStatus: 'publish',
			publishedUrl: 'https://blog.example/p/',
		})).toBe(true);
		expect(shouldApplyPublishedUrlToArticle({
			wpStatus: 'draft',
			publishedUrl: 'https://blog.example/p/',
		})).toBe(false);
		expect(shouldApplyPublishedUrlToArticle({
			wpStatus: 'publish',
			scheduledAt: '2026-08-10T12:00:00.000Z',
			publishedUrl: 'https://blog.example/p/',
		})).toBe(false);
		expect(shouldApplyPublishedUrlToArticle({
			wpStatus: 'publish',
			publishedUrl: '',
		})).toBe(false);
	});

	it('buildGenerationMediaPreserve keeps images only and drops publish fields', () => {
		const preserved = buildGenerationMediaPreserve({
			article: {
				featured_image: 'https://cdn/hero.png',
				gallery_images: ['https://cdn/a.png'],
				published_url: 'https://old.example/post/',
				published_at: '2026-08-01T00:00:00.000Z',
			},
			previous: {},
		});
		expect(preserved).toEqual({
			featured_image: 'https://cdn/hero.png',
			gallery_images: ['https://cdn/a.png'],
		});
		expect(preserved).not.toHaveProperty('published_url');
		expect(preserved).not.toHaveProperty('published_at');
	});

	it('applyPublishedUrlPatch stores the returned WordPress URL', () => {
		const next = applyPublishedUrlPatch(
			{ seo_title: 'Test', published_url: '', published_at: '' },
			{
				publishedUrl: 'https://blog.example/my-article/',
				publishedAt: '2026-08-10T01:00:00.000Z',
				customPrompt: 'Be concise',
			},
		);
		expect(next.published_url).toBe('https://blog.example/my-article/');
		expect(next.published_at).toBe('2026-08-10T01:00:00.000Z');
		expect(next.custom_prompt).toBe('Be concise');
	});
});

describe('WriterPage published URL wiring', () => {
	it('uses shared published-url helpers and Open Article target=_blank with noopener', () => {
		const src = readFileSync(writerPagePath, 'utf8');
		expect(src).toContain("from '@/lib/writer-published-url'");
		expect(src).toContain('resolvePublishedUrlFromResponse(data)');
		expect(src).toContain('shouldShowPublishedSuccessBanner');
		expect(src).toContain("published_url: ''");
		expect(src).toContain("window.open(article.published_url, '_blank', 'noopener,noreferrer')");
		expect(src).toContain('rel="noopener noreferrer"');
		expect(src).toContain('Published successfully');
		expect(src).toContain('Open Article');
	});

	it('does not mark Save Draft publish path as published success apply', () => {
		const src = readFileSync(writerPagePath, 'utf8');
		expect(src).toContain('shouldApplyPublishedUrlToArticle');
		const publishBlock = src.slice(src.indexOf('const publishToWp'), src.indexOf('const openScheduleModal'));
		expect(publishBlock).toContain("wpStatus === 'publish' ? 'published' : 'draft'");
		expect(publishBlock).not.toMatch(/shouldApplyPublishedUrlToArticle[\s\S]*wpStatus === 'draft'/);
	});
});
