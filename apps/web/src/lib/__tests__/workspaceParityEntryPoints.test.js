/**
 * WS-01 / WS-02 / WS-05 entry points — existing routes only.
 * Run: node --test src/lib/__tests__/workspaceParityEntryPoints.test.js
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

describe('WS-01 Dashboard Facebook creation CTA', () => {
	const dashboard = readSrc('pages/app/DashboardPage.jsx');

	it('adds Open AI Facebook Pages CTA to /app/ai-facebook-pages', () => {
		assert.match(
			dashboard,
			/withWebsiteQuery\('\/app\/ai-facebook-pages', activeWebsiteId\)[\s\S]*?Open AI Facebook Pages/,
		);
		assert.match(dashboard, /label: 'Create Facebook Posts', to: '\/app\/ai-facebook-pages'/);
	});

	it('keeps the existing Open AI Pins CTA unchanged', () => {
		assert.match(
			dashboard,
			/withWebsiteQuery\('\/app\/ai-pins', activeWebsiteId\)[\s\S]*?Open AI Pins/,
		);
		assert.match(dashboard, /label: 'Create Pins', to: '\/app\/ai-pins'/);
	});
});

describe('WS-02 Website Operate Generate Facebook Post', () => {
	const websiteDash = readSrc('pages/app/WebsiteDashboardPage.jsx');
	const quickActions = readSrc('components/websites/OperateQuickActions.jsx');
	const contentProduction = readSrc('components/websites/OperateContentProduction.jsx');

	it('routes Generate Facebook Post to /app/ai-facebook-pages via existing studio helper', () => {
		assert.match(quickActions, /label: 'Generate Facebook Post'/);
		assert.match(contentProduction, /label: 'Generate Facebook Post'/);
		assert.match(websiteDash, /const facebookStudioHref = buildFacebookStudioHref\(website\.id\)/);
		assert.match(websiteDash, /onGenerateFacebookPost=\{\(\) => navigate\(facebookStudioHref\)\}/);
		assert.match(
			readSrc('lib/websites/facebookDashboardProgress.js'),
			/return `\/app\/ai-facebook-pages\?\$\{params\.toString\(\)\}`/,
		);
	});

	it('keeps Generate AI Pin pointing at /app/ai-pins', () => {
		assert.match(quickActions, /label: 'Generate AI Pin'/);
		assert.match(contentProduction, /label: 'Generate AI Pin'/);
		assert.match(
			websiteDash,
			/const pinsHref = `\/app\/ai-pins\?websiteId=\$\{encodeURIComponent\(website\.id\)\}`/,
		);
		assert.match(websiteDash, /onGeneratePin=\{\(\) => navigate\(pinsHref\)\}/);
	});
});

describe('WS-05 customer publishing history navigation', () => {
	const layout = readSrc('components/AppLayout.jsx');

	it('exposes channel Publishing and AI Generation labels on existing routes', () => {
		assert.match(layout, /to: '\/app\/facebook-history', label: 'Facebook Publishing'/);
		assert.match(layout, /to: '\/app\/wordpress-history', label: 'WordPress Publishing'/);
		assert.match(layout, /to: '\/app\/pinterest-history', label: 'Pinterest Publishing'/);
		assert.match(layout, /to: '\/app\/ai-pins\/history', label: 'Pin Generation'/);
		assert.match(layout, /to: '\/app\/ai-facebook-pages\/history', label: 'Facebook Post Generation'/);
		assert.match(layout, /section: 'Publishing'/);
		assert.match(layout, /section: 'AI Generation'/);
	});
});
