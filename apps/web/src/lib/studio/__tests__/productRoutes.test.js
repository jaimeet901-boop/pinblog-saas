import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AI_FACEBOOK_PAGES_PRODUCT,
	AI_PINS_PRODUCT,
	WORDPRESS_PUBLISHING_PRODUCT,
} from '@/lib/studio/products';
import { FACEBOOK_CHANNEL_CAPABILITIES } from '@/lib/facebook/channelCapabilities.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('facebook F6-5 product routes', () => {
	it('keeps Pinterest routes unchanged', () => {
		expect(AI_PINS_PRODUCT.routes).toEqual({
			studio: '/app/ai-pins',
			history: '/app/ai-pins/history',
			connect: '/app/pinterest',
			publishingHistory: '/app/pinterest-history',
			templates: '/app/ai-pins/templates',
			brandKit: '/app/ai-pins/brand-kit',
		});
	});

	it('routes Facebook publishing history under ai-facebook-pages product', () => {
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.studio).toBe('/app/ai-facebook-pages');
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.history).toBe('/app/ai-facebook-pages/history');
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.publishingHistory).toBe('/app/facebook-history');
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.templates).toBe('/app/ai-facebook-pages/templates');
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.brandKit).toBe('/app/ai-facebook-pages/brand-kit');
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.connect).toBe('/app/facebook');
	});

	it('does not alias Facebook history/templates to Pinterest paths', () => {
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.history).not.toContain('/app/ai-pins/');
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.templates).not.toContain('/app/ai-pins/');
		expect(AI_FACEBOOK_PAGES_PRODUCT.routes.brandKit).not.toContain('/app/ai-pins/');
	});
});

describe('facebook F6-5 studio asset capabilities', () => {
	it('enables studio asset flags with publishing history enabled in F7-5', () => {
		expect(FACEBOOK_CHANNEL_CAPABILITIES.studioPromptPack).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.studioTemplatePack).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.studioExportProfiles).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory).toBe(true);
	});
});

describe('facebook F7-6 hub analytics wiring', () => {
	it('loads facebook analytics in hub when capability is enabled', () => {
		const hub = readFileSync(path.join(webRoot, 'src/pages/app/FacebookPage.jsx'), 'utf8');

		expect(hub).toMatch(/\/facebook\/analytics/);
		expect(hub).toMatch(/capabilities\.analytics/);
		expect(hub).toMatch(/tab === 'analytics'/);
	});

	it('enables analytics and insights capabilities in F7-6', () => {
		expect(FACEBOOK_CHANNEL_CAPABILITIES.analytics).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.insights).toBe(true);
	});
});

describe('facebook F7-5 publishing history routes', () => {
	it('registers facebook publishing history wrapper route', () => {
		const app = readFileSync(path.join(webRoot, 'src/App.jsx'), 'utf8');
		const wrapper = readFileSync(
			path.join(webRoot, 'src/pages/app/AIFacebookPagesPublishingHistoryPage.jsx'),
			'utf8',
		);

		expect(app).toMatch(/\/app\/facebook-history/);
		expect(app).toMatch(/AIFacebookPagesPublishingHistoryPage/);
		expect(wrapper).toMatch(/PublishingHistoryPage/);
		expect(wrapper).toMatch(/AI_FACEBOOK_PAGES_PRODUCT/);
	});

	it('preserves website query on facebook publishing history route', () => {
		const layout = readFileSync(
			path.join(webRoot, 'src/components/AppLayout.jsx'),
			'utf8',
		);

		expect(layout).toMatch(/\/app\/facebook-history/);
	});

	it('exposes facebook-history in customer workspace Publishing navigation', () => {
		const layout = readFileSync(
			path.join(webRoot, 'src/components/AppLayout.jsx'),
			'utf8',
		);

		expect(layout).toMatch(/to: '\/app\/facebook-history', label: 'Facebook History'/);
		expect(layout).toMatch(/section: 'Publishing'/);
	});
});

describe('wordpress publishing history routes', () => {
	it('registers wordpress publishing history wrapper route', () => {
		const app = readFileSync(path.join(webRoot, 'src/App.jsx'), 'utf8');
		const wrapper = readFileSync(
			path.join(webRoot, 'src/pages/app/WordPressPublishingHistoryPage.jsx'),
			'utf8',
		);

		expect(WORDPRESS_PUBLISHING_PRODUCT.routes.publishingHistory).toBe('/app/wordpress-history');
		expect(app).toMatch(/\/app\/wordpress-history/);
		expect(app).toMatch(/WordPressPublishingHistoryPage/);
		expect(wrapper).toMatch(/PublishingHistoryPage/);
		expect(wrapper).toMatch(/WORDPRESS_PUBLISHING_PRODUCT/);
	});

	it('preserves website query on wordpress publishing history route', () => {
		const layout = readFileSync(
			path.join(webRoot, 'src/components/AppLayout.jsx'),
			'utf8',
		);

		expect(layout).toMatch(/\/app\/wordpress-history/);
	});

	it('exposes wordpress-history in customer workspace Publishing navigation', () => {
		const layout = readFileSync(
			path.join(webRoot, 'src/components/AppLayout.jsx'),
			'utf8',
		);

		expect(layout).toMatch(/to: '\/app\/wordpress-history', label: 'WordPress History'/);
		expect(layout).toMatch(/section: 'Publishing'/);
	});

	it('does not keep the boards sync toast gated on the literal 1 flag', () => {
		const hub = readFileSync(path.join(webRoot, 'src/pages/app/PinterestPage.jsx'), 'utf8');
		expect(hub).not.toMatch(/boards_sync_warning'\) === '1'/);
		expect(hub).toMatch(/oauthParams\.get\('boards_sync_warning'\)/);
	});
});

describe('facebook F6-5 route wiring', () => {
	it('registers thin wrapper pages and shared editor routes', () => {
		const app = readFileSync(path.join(webRoot, 'src/App.jsx'), 'utf8');
		const historyWrapper = readFileSync(
			path.join(webRoot, 'src/pages/app/AIFacebookPagesHistoryPage.jsx'),
			'utf8',
		);
		const templatesWrapper = readFileSync(
			path.join(webRoot, 'src/pages/app/AIFacebookPagesTemplatesPage.jsx'),
			'utf8',
		);
		const brandKitWrapper = readFileSync(
			path.join(webRoot, 'src/pages/app/AIFacebookPagesBrandKitPage.jsx'),
			'utf8',
		);

		expect(historyWrapper).toMatch(/AIPinHistoryPage/);
		expect(historyWrapper).toMatch(/AI_FACEBOOK_PAGES_PRODUCT/);
		expect(templatesWrapper).toMatch(/TemplatesPage/);
		expect(templatesWrapper).toMatch(/AI_FACEBOOK_PAGES_PRODUCT/);
		expect(brandKitWrapper).toMatch(/BrandKitPage/);
		expect(brandKitWrapper).toMatch(/AI_FACEBOOK_PAGES_PRODUCT/);

		expect(app).toMatch(/\/app\/ai-facebook-pages\/templates\/new\/edit/);
		expect(app).toMatch(/\/app\/ai-facebook-pages\/templates\/:id\/edit/);
	});

	it('gates publishing history in Content Studio on capability flag', () => {
		const studio = readFileSync(
			path.join(webRoot, 'src/pages/app/ContentStudioPage.jsx'),
			'utf8',
		);

		expect(studio).toMatch(/showPublishingHistory/);
		expect(studio).toMatch(/destinationCaps\.publishingHistory !== false/);
		expect(studio).toMatch(/onOpenHistory=\{showPublishingHistory/);
	});

	it('preserves website query on Facebook Studio sub-routes', () => {
		const layout = readFileSync(
			path.join(webRoot, 'src/components/AppLayout.jsx'),
			'utf8',
		);

		expect(layout).toMatch(/\/app\/ai-facebook-pages\/history/);
		expect(layout).toMatch(/\/app\/ai-facebook-pages\/templates/);
		expect(layout).toMatch(/\/app\/ai-facebook-pages\/brand-kit/);
	});
});
