/**
 * PR-17 — Workspace analytics includes Facebook + WordPress without a new endpoint.
 * Run: node --test src/services/analytics/workspace.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveRange } from './helpers.js';
import {
	assembleWorkspaceOverviewFromSources,
	toWorkspaceAnalyticsCsv,
} from './workspace-overview.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const workspaceSource = readFileSync(
	path.join(root, 'apps/api/src/services/analytics/workspace.js'),
	'utf8',
);

function nowIso() {
	return new Date().toISOString();
}

function rangeContext() {
	const { rangeKey, start, end, startIso, endIso } = resolveRange('30d');
	return { rangeKey, start, end, startIso, endIso, workspaceKey: 'ws_1' };
}

describe('workspace analytics isolation (PR-17 static)', () => {
	it('loads facebook_publish_jobs with the same workspaceScopeFilter as other job collections', () => {
		assert.match(workspaceSource, /workspaceScopeFilter\(req\)/);
		assert.match(workspaceSource, /FACEBOOK_JOB_COLLECTION/);
		assert.match(workspaceSource, /collection\(FACEBOOK_JOB_COLLECTION\)/);

		const scopeAt = workspaceSource.indexOf('const scopeFilter = workspaceScopeFilter(req);');
		const facebookAt = workspaceSource.indexOf('collection(FACEBOOK_JOB_COLLECTION)');
		assert.ok(scopeAt >= 0);
		assert.ok(facebookAt > scopeAt);

		const facebookBlock = workspaceSource.slice(facebookAt, facebookAt + 280);
		assert.match(facebookBlock, /filter: scopeFilter/);
		assert.match(facebookBlock, /expand: 'ai_pin,account'/);
		assert.doesNotMatch(facebookBlock, /owner\s*=/);
	});

	it('does not create a new analytics route', () => {
		const route = readFileSync(
			path.join(root, 'apps/api/src/routes/workspace/analytics.js'),
			'utf8',
		);
		assert.match(route, /buildWorkspaceOverview/);
		assert.match(route, /exportWorkspaceAnalytics/);
		assert.doesNotMatch(route, /facebook_publish_jobs/);
	});
});

describe('assembleWorkspaceOverviewFromSources (PR-17)', () => {
	it('includes Facebook jobs in summary, items, and charts', () => {
		const stamp = nowIso();
		const payload = assembleWorkspaceOverviewFromSources({
			...rangeContext(),
			pinJobs: [{
				id: 'pin_1',
				status: 'published',
				published_at: stamp,
				created: stamp,
				websiteId: 'web_1',
				board_name: 'Recipes',
				pinterest_pin_url: 'https://pinterest.com/pin/1',
				performance: { impressions: 10, outboundClicks: 2, saves: 1, closeups: 0 },
				expand: { ai_pin: { id: 'ai_1', title: 'Pin A', websiteId: 'web_1' } },
			}],
			facebookJobs: [{
				id: 'fb_1',
				status: 'published',
				published_at: stamp,
				created: stamp,
				websiteId: 'web_1',
				page_id: 'page_1',
				page_name: 'Chef Kitchen',
				facebook_post_url: 'https://facebook.com/post/1',
				performance: { impressions: 20, clicks: 3, engagedUsers: 4, reactions: 5 },
				expand: { ai_pin: { id: 'ai_2', title: 'FB Post', image_url: 'https://cdn.example/fb.jpg' } },
			}],
			wpJobs: [{
				id: 'wp_1',
				status: 'published',
				published_at: stamp,
				created: stamp,
				title: 'WP Post',
				wp_post_url: 'https://blog.example/wp-1',
				websiteId: 'web_1',
			}],
			wpHistory: [{ job: 'wp_1', result: 'published', published_at: stamp }],
		});

		assert.equal(payload.summary.published, 3);
		assert.equal(payload.summary.pinterestPins, 1);
		assert.equal(payload.summary.facebookPosts, 1);
		assert.equal(payload.summary.wordpressPosts, 1);
		assert.equal(payload.facebook.published, 1);
		assert.equal(payload.facebook.impressions, 20);
		assert.equal(payload.facebook.clicks, 3);

		const channels = payload.items.map((item) => item.channel).sort();
		assert.deepEqual(channels, ['facebook', 'pinterest', 'wordpress']);
		const facebookItem = payload.items.find((item) => item.channel === 'facebook');
		assert.equal(facebookItem.websiteId, 'web_1');
		assert.equal(facebookItem.url, 'https://facebook.com/post/1');
		assert.equal(facebookItem.performance.outboundClicks, 3);
		assert.ok(payload.charts.dailyActivity.length > 0);
	});

	it('does not count scheduled WordPress history as published', () => {
		const stamp = nowIso();
		const payload = assembleWorkspaceOverviewFromSources({
			...rangeContext(),
			wpHistory: [
				{ job: 'wp_pub', result: 'published', published_at: stamp },
				{ job: 'wp_sched', result: 'scheduled', published_at: stamp },
				{ job: 'wp_fail', result: 'failed', published_at: stamp },
			],
			wpJobs: [
				{ id: 'wp_pub', status: 'published', published_at: stamp, created: stamp, title: 'Live' },
				{ id: 'wp_sched', status: 'scheduled', scheduled_at: stamp, created: stamp, title: 'Later', wp_status: 'scheduled' },
				{ id: 'wp_fail', status: 'failed', created: stamp, title: 'Broken' },
			],
		});

		assert.equal(payload.summary.wordpressPosts, 1);
		assert.equal(payload.wordpress.published, 1);
		assert.equal(payload.wordpress.scheduled, 1);
		assert.equal(payload.wordpress.failures, 1);
		assert.equal(payload.summary.published, 1);
		assert.equal(payload.summary.failed, 1);
		assert.equal(payload.summary.scheduled, 1);
		assert.equal(payload.items.filter((item) => item.channel === 'wordpress').length, 3);
	});

	it('exports CSV with channel and Facebook post URL', () => {
		const stamp = nowIso();
		const payload = assembleWorkspaceOverviewFromSources({
			...rangeContext(),
			facebookJobs: [{
				id: 'fb_csv',
				status: 'published',
				published_at: stamp,
				created: stamp,
				page_name: 'Chef Kitchen',
				facebook_post_url: 'https://facebook.com/post/csv',
				performance: { impressions: 9, clicks: 1 },
				expand: { ai_pin: { title: 'CSV Post' } },
			}],
			wpJobs: [{
				id: 'wp_csv',
				status: 'published',
				published_at: stamp,
				created: stamp,
				title: 'CSV WP',
				wp_post_url: 'https://blog.example/csv',
			}],
			wpHistory: [{ job: 'wp_csv', result: 'published', published_at: stamp }],
		});

		const csv = toWorkspaceAnalyticsCsv(payload.items);
		const header = csv.split('\n')[0];
		assert.match(header, /^id,channel,title,status,destination,websiteId,account,publishedAt,impressions,saves,clicks,closeups,url$/);
		assert.match(csv, /"facebook"/);
		assert.match(csv, /"https:\/\/facebook.com\/post\/csv"/);
		assert.match(csv, /"wordpress"/);
		assert.match(csv, /"https:\/\/blog.example\/csv"/);
		assert.doesNotMatch(csv, /pinterestPinUrl/);
	});

	it('returns zeros and empty arrays for an empty workspace', () => {
		const payload = assembleWorkspaceOverviewFromSources(rangeContext());

		assert.equal(payload.summary.published, 0);
		assert.equal(payload.summary.failed, 0);
		assert.equal(payload.summary.scheduled, 0);
		assert.equal(payload.summary.facebookPosts, 0);
		assert.equal(payload.summary.wordpressPosts, 0);
		assert.equal(payload.summary.pinterestPins, 0);
		assert.equal(payload.summary.impressions, 0);
		assert.equal(payload.summary.clicks, 0);
		assert.deepEqual(payload.items, []);
		assert.deepEqual(payload.charts.dailyActivity, []);
		assert.deepEqual(payload.charts.monthlyActivity, []);
		assert.equal(payload.facebook.published, 0);
		assert.equal(payload.wordpress.published, 0);
		assert.equal(payload.pinterest.published, 0);
	});
});
