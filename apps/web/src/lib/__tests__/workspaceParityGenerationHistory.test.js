/**
 * WS-06 Facebook generation history page, nav, and publishing split.
 * Run: node --test src/lib/__tests__/workspaceParityGenerationHistory.test.js
 */
import { describe, it } from 'node:test';
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
	it('J. Sidebar exposes Facebook Post History', () => {
		const layout = readSrc('components/AppLayout.jsx');
		assert.match(
			layout,
			/to: '\/app\/ai-facebook-pages\/history', label: 'Facebook Post History'/,
		);
		assert.match(layout, /to: '\/app\/ai-pins\/history', label: 'Pin History'/);
		assert.match(layout, /'\/app\/ai-facebook-pages\/history'/);
	});

	it('K. Facebook publishing history remains /app/facebook-history', () => {
		const layout = readSrc('components/AppLayout.jsx');
		const products = readSrc('lib/studio/products.js');
		assert.match(layout, /to: '\/app\/facebook-history', label: 'Facebook History'/);
		assert.match(layout, /section: 'Publishing'/);
		assert.match(products, /publishingHistory: '\/app\/facebook-history'/);
		assert.notEqual(
			'/app/ai-facebook-pages/history',
			'/app/facebook-history',
		);
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
