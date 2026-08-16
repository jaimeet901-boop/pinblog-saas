/**
 * WS-12 Dashboard / Website Dashboard Facebook history links.
 * Run: node --test src/lib/__tests__/workspaceParityHistoryLinks.test.js
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

describe('WS-12 Dashboard mixed-channel links', () => {
	const dashboard = readSrc('pages/app/DashboardPage.jsx');

	it('keeps Facebook published pointing at facebook-history', () => {
		assert.match(
			dashboard,
			/label: 'Facebook published'[\s\S]*?to: '\/app\/facebook-history'/,
		);
	});

	it('routes mixed Published posts, Failed Jobs, and Queue depth to analytics', () => {
		assert.match(dashboard, /label: 'Published posts', value: publishedPins, to: '\/app\/analytics'/);
		assert.match(dashboard, /label: 'Failed Jobs', value: failedJobs, to: '\/app\/analytics'/);
		assert.match(dashboard, /label: 'Queue depth', value: queueDepth, to: '\/app\/analytics'/);
	});

	it('keeps Pinterest, WordPress, and Open AI Pins entry points unchanged', () => {
		assert.match(
			dashboard,
			/label: 'Pinterest published'[\s\S]*?to: '\/app\/pinterest-history'/,
		);
		assert.match(
			dashboard,
			/label: 'WordPress published'[\s\S]*?to: '\/app\/wordpress-history'/,
		);
		assert.match(
			dashboard,
			/withWebsiteQuery\('\/app\/ai-pins', activeWebsiteId\)[\s\S]*?Open AI Pins/,
		);
	});
});

describe('WS-12 Website Dashboard Facebook history', () => {
	const websiteDash = readSrc('pages/app/WebsiteDashboardPage.jsx');

	it('adds Facebook publishing history with websiteId while keeping Pinterest and WordPress history', () => {
		assert.match(
			websiteDash,
			/const facebookHistoryHref = `\/app\/facebook-history\?websiteId=\$\{encodeURIComponent\(website\.id\)\}`/,
		);
		assert.match(
			websiteDash,
			/const historyHref = `\/app\/pinterest-history\?websiteId=\$\{encodeURIComponent\(website\.id\)\}`/,
		);
		assert.match(
			websiteDash,
			/const wordpressHistoryHref = `\/app\/wordpress-history\?websiteId=\$\{encodeURIComponent\(website\.id\)\}`/,
		);
		assert.match(websiteDash, /Facebook publishing history/);
		assert.match(websiteDash, /navigate\(facebookHistoryHref\)/);
	});

	it('keeps Generate Facebook Post on the existing studio helper', () => {
		assert.match(websiteDash, /const facebookStudioHref = buildFacebookStudioHref\(website\.id\)/);
		assert.match(websiteDash, /onGenerateFacebookPost=\{\(\) => navigate\(facebookStudioHref\)\}/);
		assert.match(websiteDash, /onOpenHistory=\{\(\) => navigate\(historyHref\)\}/);
	});
});
