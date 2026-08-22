/**
 * WS-06 Facebook generation history page, nav, and publishing split.
 * Run: node --test src/lib/__tests__/workspaceParityGenerationHistory.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readSrc(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

describe('WS-06 Facebook generation history page', () => {
	it('I. Facebook generation history route requests channel=facebook', () => {
		const wrapper = readSrc('pages/app/AIFacebookPagesHistoryPage.jsx');
		const historyPage = readSrc('pages/app/AIPinHistoryPage.jsx');
		const app = readSrc('App.jsx');

		assert.match(wrapper, /AIPinHistoryPage/);
		assert.match(wrapper, /AI_FACEBOOK_PAGES_PRODUCT/);
		assert.match(app, /path="\/app\/ai-facebook-pages\/history"/);
		assert.match(app, /AIFacebookPagesHistoryPage/);

		assert.match(historyPage, /product\.destinationId === 'facebook'/);
		assert.match(historyPage, /historyQuery\.set\('channel', 'facebook'\)/);
		assert.match(historyPage, /`\/ai-pins\/history\?\$\{historyQuery\}`/);
		assert.doesNotMatch(historyPage, /historyQuery\.set\('channel', 'pinterest'\)/);
	});

	it('keeps Pinterest Pin History on GET /ai-pins/history without a facebook-only channel', () => {
		const historyPage = readSrc('pages/app/AIPinHistoryPage.jsx');
		const products = readSrc('lib/studio/products.js');
		assert.match(products, /destinationId: 'pinterest'/);
		assert.match(historyPage, /product = AI_PINS_PRODUCT/);
		assert.match(
			historyPage,
			/if \(product\.destinationId === 'facebook'\) \{\s*historyQuery\.set\('channel', 'facebook'\);\s*\}/,
		);
	});
});

describe('WS-06 generation vs publishing navigation', () => {
	it('J. Sidebar exposes Facebook Post Generation distinct from Facebook Publishing', () => {
		const layout = readSrc('components/AppLayout.jsx');
		assert.match(
			layout,
			/to: '\/app\/ai-facebook-pages\/history', label: 'Facebook Post Generation'/,
		);
		assert.match(layout, /to: '\/app\/ai-pins\/history', label: 'Pin Generation'/);
		assert.match(layout, /section: 'AI Generation'/);
		assert.match(layout, /'\/app\/ai-facebook-pages\/history'/);
	});

	it('K. Facebook publishing history remains /app/facebook-history', () => {
		const layout = readSrc('components/AppLayout.jsx');
		const products = readSrc('lib/studio/products.js');
		assert.match(layout, /to: '\/app\/pinterest-history', label: 'Pinterest Publishing'/);
		assert.match(layout, /to: '\/app\/facebook-history', label: 'Facebook Publishing'/);
		assert.match(layout, /to: '\/app\/wordpress-history', label: 'WordPress Publishing'/);
		assert.match(layout, /section: 'Publishing'/);
		assert.match(products, /publishingHistory: '\/app\/facebook-history'/);
		assert.match(products, /historyNav: 'Facebook Post Generation'/);
		assert.match(products, /publishingHistoryNav: 'Facebook Publishing'/);
		assert.match(products, /historyNav: 'Pin Generation'/);
		assert.match(products, /publishingHistoryNav: 'Pinterest Publishing'/);
		assert.notEqual(
			'/app/ai-facebook-pages/history',
			'/app/facebook-history',
		);
	});

	it('keeps page titles aligned with the same publishing vs generation labels', () => {
		const generationPage = readSrc('pages/app/AIPinHistoryPage.jsx');
		const publishingPage = readSrc('pages/app/PublishingHistoryPage.jsx');
		const viewConfig = readSrc('services/publishing-history/viewConfig.js');
		assert.match(generationPage, /\{L\.historyNav\}/);
		assert.match(publishingPage, /\{view\.pageTitle\}/);
		assert.match(viewConfig, /pageTitle: labels\.publishingHistoryNav \|\| 'WordPress Publishing'/);
		assert.match(viewConfig, /pageTitle: labels\.publishingHistoryNav \|\| \(isFacebook \? 'Facebook Publishing' : 'Pinterest Publishing'\)/);
		assert.doesNotMatch(generationPage, /AI Generation History/);
		assert.doesNotMatch(publishingPage, />Publishing Center</);
	});
});

describe('WS-06 Facebook edit history client stamp', () => {
	it('sends studio channel on editor PATCH so Facebook edits store metadata.channel=facebook', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		const draft = readSrc('services/ai-pins/draftService.js');
		assert.match(studio, /channel: studioChannel/);
		assert.match(studio, /updateDraftPin\(\{[\s\S]*channel: studioChannel/);
		assert.match(draft, /channel,/);
		assert.match(draft, /\.\.\.\(channel \? \{ channel \} : \{\}\)/);
	});
});
