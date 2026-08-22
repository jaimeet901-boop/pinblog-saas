/**
 * WS-03 / WS-04 Websites Hub + Settings Facebook entry points.
 * Run: node --test src/lib/__tests__/workspaceParityHubSettings.test.js
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

describe('WS-03 Websites Hub Facebook creation CTA', () => {
	const websites = readSrc('pages/app/WebsitesPage.jsx');
	const studioHelper = readSrc('lib/websites/facebookDashboardProgress.js');

	it('adds Create Facebook Post pointing at /app/ai-facebook-pages', () => {
		assert.match(websites, /Create Facebook Post/);
		assert.match(websites, /navigate\(buildFacebookStudioHref\(s\.id\)\)/);
		assert.match(studioHelper, /return `\/app\/ai-facebook-pages\?\$\{params\.toString\(\)\}`/);
		assert.match(studioHelper, /params\.set\('websiteId', String\(websiteId \|\| ''\)\)/);
	});

	it('preserves websiteId through the existing studio helper', () => {
		assert.match(websites, /buildFacebookStudioHref\(s\.id\)/);
		assert.match(websites, /from '@\/lib\/websites\/facebookDashboardProgress'/);
	});

	it('keeps existing Pinterest and WordPress hub actions unchanged', () => {
		assert.match(
			websites,
			/navigate\(`\/app\/ai-pins\?websiteId=\$\{s\.id\}`\); \}\}>AI Pins/,
		);
		assert.match(
			websites,
			/navigate\(`\/app\/writer\?websiteId=\$\{s\.id\}`\); \}\}>AI Writer/,
		);
		assert.match(websites, /apiServerClient\.fetch\('\/wordpress\/test'/);
		assert.doesNotMatch(websites, /navigate\(`\/app\/ai-pins\?websiteId=\$\{s\.id\}`\); \}\}>Create Facebook Post/);
	});
});

describe('WS-04 Settings Facebook entry', () => {
	const settings = readSrc('pages/app/SettingsPage.jsx');

	it('adds a Facebook tab that routes to /app/facebook', () => {
		assert.match(settings, /id: 'facebook', label: 'Facebook'/);
		assert.match(settings, /tab === 'facebook'/);
		assert.match(settings, /Open Facebook Hub/);
		assert.match(
			settings,
			/withWebsiteQuery\('\/app\/facebook', prefs\.defaultWebsiteId \|\| primaryWebsite\?\.id\)/,
		);
	});

	it('keeps existing WordPress and Pinterest settings entries unchanged', () => {
		assert.match(settings, /id: 'wordpress', label: 'WordPress'/);
		assert.match(settings, /id: 'pinterest', label: 'Pinterest'/);
		assert.match(settings, /<Link to="\/app\/pinterest"><Button size="sm" variant="outline">Open Pinterest Hub<\/Button><\/Link>/);
		assert.match(settings, /<Link to="\/app\/websites"><Button size="sm" variant="outline"><RefreshCw size=\{13\} \/> Manage \/ Sync<\/Button><\/Link>/);
		assert.match(settings, /<h3>Login with Pinterest<\/h3>/);
	});

	it('does not introduce a second Facebook connection system or unsupported login provider', () => {
		assert.doesNotMatch(settings, /\/facebook\/accounts/);
		assert.doesNotMatch(settings, /Login with Facebook/);
		assert.doesNotMatch(settings, /OAUTH_PROVIDERS\.facebook/);
		assert.doesNotMatch(settings, /handleConnectProvider\('facebook'\)/);
	});
});
