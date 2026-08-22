/**
 * Dashboard Facebook published card — DashboardPage wiring.
 * Run: node --test src/lib/__tests__/dashboardFacebookVisibility.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(
	path.resolve(here, '../../pages/app/DashboardPage.jsx'),
	'utf8',
);

describe('DashboardPage Facebook published card', () => {
	it('loads the existing workspace dashboard endpoint', () => {
		assert.match(pageSource, /apiServerClient\.fetch\('\/workspace\/v1\/dashboard'/);
		assert.doesNotMatch(pageSource, /analytics\/overview/);
	});

	it('renders a Facebook published card that links to facebook-history', () => {
		assert.match(
			pageSource,
			/label: 'Facebook published'[\s\S]*?to: '\/app\/facebook-history'/,
		);
		assert.match(pageSource, /usageDash\.facebookPublications \?\? stats\.publishedFacebook \?\? 0/);
	});

	it('keeps Pinterest and WordPress published cards intact', () => {
		assert.match(
			pageSource,
			/label: 'Pinterest published'[\s\S]*?to: '\/app\/pinterest-history'/,
		);
		assert.match(
			pageSource,
			/label: 'WordPress published'[\s\S]*?to: '\/app\/wordpress-history'/,
		);
		assert.match(pageSource, /usageDash\.pinterestPublications \?\? stats\.publishedPins \?\? 0/);
		assert.match(pageSource, /usageDash\.wordpressPublications \?\? stats\.publishedWordpress \?\? 0/);
	});
});
