import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildWordpressSyncPath,
	buildWordpressSyncSuccessMessage,
	formatWordpressSyncError,
	triggerWordpressArticleSync,
} from './wordpressDashboardSync.js';

describe('wordpressDashboardSync', () => {
	it('buildWordpressSyncPath encodes the website id', () => {
		expect(buildWordpressSyncPath('site/1')).toBe('/wordpress/sites/site%2F1/sync');
	});

	it('formatWordpressSyncError prefers API message then errorCode', () => {
		expect(formatWordpressSyncError({ message: 'Sync already running' }, 409)).toBe('Sync already running');
		expect(formatWordpressSyncError({ errorCode: 'WP_SYNC_IN_PROGRESS' }, 409)).toBe('wp sync in progress');
		expect(formatWordpressSyncError({}, 503)).toBe('WordPress sync failed (503)');
	});

	it('buildWordpressSyncSuccessMessage summarizes stats', () => {
		expect(buildWordpressSyncSuccessMessage({ fetched: 12, created: 3, updated: 4, unchanged: 5 }))
			.toBe('Synced 12 WordPress posts (3 new, 4 updated, 5 unchanged).');
		expect(buildWordpressSyncSuccessMessage({ fetched: 0 }))
			.toBe('WordPress articles are up to date.');
	});

	it('triggerWordpressArticleSync posts to the site sync endpoint', async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, stats: { fetched: 2, created: 1, updated: 0 } }),
		});
		const result = await triggerWordpressArticleSync({ fetch }, 'web_1');

		expect(fetch).toHaveBeenCalledWith('/wordpress/sites/web_1/sync', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode: 'manual' }),
		});
		expect(result.stats.created).toBe(1);
	});

	it('triggerWordpressArticleSync surfaces structured API errors', async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 409,
			json: async () => ({ message: 'WordPress sync already running for this site', errorCode: 'WP_SYNC_IN_PROGRESS' }),
		});

		await expect(triggerWordpressArticleSync({ fetch }, 'web_1')).rejects.toThrow(
			'WordPress sync already running for this site',
		);
	});
});

describe('WebsiteDashboardPage P1-11 wiring', () => {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
	const pagePath = path.join(root, 'src/pages/app/WebsiteDashboardPage.jsx');
	const source = readFileSync(pagePath, 'utf8');

	it('uses POST wordpress site sync instead of listing sites', () => {
		expect(source).toMatch(/triggerWordpressArticleSync/);
		expect(source).not.toMatch(/fetch\(['"]\/wordpress\/sites['"],\s*\{\s*method:\s*['"]GET['"]/);
	});

	it('tracks syncing state and disables duplicate sync clicks', () => {
		expect(source).toMatch(/const \[syncing,\s*setSyncing\]/);
		expect(source).toMatch(/if \(syncing\)/);
		expect(source).toMatch(/syncing && action\.action === 'sync'/);
		expect(source).toMatch(/Syncing\.\.\./);
	});

	it('does not use GET /health as a hidden sync probe', () => {
		expect(source).not.toMatch(/\/wordpress\/sites\/[^'"]+\/health/);
	});
});
