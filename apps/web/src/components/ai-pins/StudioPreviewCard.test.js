import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const facebookPreviewProps = vi.hoisted(() => ({ current: null }));

vi.mock('@/components/ai-pins/FacebookFeedPreviewCard', () => ({
	default: (props) => {
		facebookPreviewProps.current = props;
		return React.createElement('div', { 'data-testid': 'facebook-feed-preview' });
	},
}));

vi.mock('@/components/ai-pins/TemplatePreviewCard', () => ({
	default: () => React.createElement('div', { 'data-testid': 'template-preview' }),
}));

import StudioPreviewCard from './StudioPreviewCard.jsx';

describe('StudioPreviewCard', () => {
	beforeEach(() => {
		facebookPreviewProps.current = null;
	});

	it('forwards mediaAspectClass to FacebookFeedPreviewCard', () => {
		renderToStaticMarkup(React.createElement(StudioPreviewCard, {
			variant: 'facebook',
			mediaAspectClass: 'aspect-[9/16]',
			imageUrl: 'https://cdn.example/story.png',
			context: { title: 'Story' },
		}));

		expect(facebookPreviewProps.current?.mediaAspectClass).toBe('aspect-[9/16]');
		expect(facebookPreviewProps.current?.imageUrl).toBe('https://cdn.example/story.png');
	});

	it('defaults Facebook mediaAspectClass to link post aspect', () => {
		renderToStaticMarkup(React.createElement(StudioPreviewCard, {
			variant: 'facebook',
			imageUrl: 'https://cdn.example/post.png',
			context: { title: 'Post' },
		}));

		expect(facebookPreviewProps.current?.mediaAspectClass).toBe('aspect-[1200/630]');
	});

	it('does not mount FacebookFeedPreviewCard for Pinterest variant', () => {
		const html = renderToStaticMarkup(React.createElement(StudioPreviewCard, {
			variant: 'pinterest',
			config: {},
			context: { title: 'Pin' },
			featuredImageUrl: 'https://cdn.example/featured.png',
		}));

		expect(facebookPreviewProps.current).toBeNull();
		expect(html).toContain('data-testid="template-preview"');
	});
});
