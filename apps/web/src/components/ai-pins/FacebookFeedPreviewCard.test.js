import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FacebookFeedPreviewCard from './FacebookFeedPreviewCard.jsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = join(__dirname, 'FacebookFeedPreviewCard.css');

describe('FacebookFeedPreviewCard', () => {
	it('defaults media frame to link post aspect class', () => {
		const html = renderToStaticMarkup(React.createElement(FacebookFeedPreviewCard, {
			imageUrl: 'https://cdn.example/post.png',
			title: 'Link post',
		}));

		expect(html).toContain('aspect-[1200/630]');
		expect(html).toContain('https://cdn.example/post.png');
	});

	it('uses story aspect class when provided', () => {
		const html = renderToStaticMarkup(React.createElement(FacebookFeedPreviewCard, {
			imageUrl: 'https://cdn.example/story.png',
			mediaAspectClass: 'aspect-[9/16]',
		}));

		expect(html).toContain('aspect-[9/16]');
		expect(html).not.toContain('aspect-[1200/630]');
	});

	it('prefers composed imageUrl over featuredImageUrl', () => {
		const html = renderToStaticMarkup(React.createElement(FacebookFeedPreviewCard, {
			imageUrl: 'https://cdn.example/composed.png',
			featuredImageUrl: 'https://cdn.example/raw.png',
		}));

		expect(html).toContain('https://cdn.example/composed.png');
		expect(html).not.toContain('https://cdn.example/raw.png');
	});
});

describe('FacebookFeedPreviewCard.css', () => {
	it('uses contain for feed media and not cover', () => {
		const css = readFileSync(cssPath, 'utf8');
		const mediaImgBlock = css.match(/\.fb-feed-preview__media img\s*\{[^}]+\}/)?.[0] || '';

		expect(mediaImgBlock).toMatch(/object-fit:\s*contain/);
		expect(mediaImgBlock).not.toMatch(/object-fit:\s*cover/);
		expect(mediaImgBlock).not.toMatch(/aspect-ratio:/);
	});

	it('keeps avatar cover behavior unchanged', () => {
		const css = readFileSync(cssPath, 'utf8');
		const avatarImgBlock = css.match(/\.fb-feed-preview__avatar img\s*\{[^}]+\}/)?.[0] || '';

		expect(avatarImgBlock).toMatch(/object-fit:\s*cover/);
	});
});
