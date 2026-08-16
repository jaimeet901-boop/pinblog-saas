/**
 * Dashboard Facebook visibility — existing GET /workspace/v1/dashboard only.
 * Run: node --test src/services/workspace-dashboard.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FACEBOOK_JOB_COLLECTION } from './facebook/channel-pack.js';
import { summarizeDashboardPublishJobs } from './workspace-dashboard-publish.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dashboardSource = readFileSync(
	path.join(root, 'apps/api/src/services/workspace-dashboard.js'),
	'utf8',
);
const ownershipSource = readFileSync(
	path.join(root, 'apps/api/src/services/workspace-ownership.js'),
	'utf8',
);
const routeSource = readFileSync(
	path.join(root, 'apps/api/src/routes/workspace/index.js'),
	'utf8',
);

describe('workspace dashboard Facebook load (static)', () => {
	it('loads facebook_publish_jobs through listWorkspaceResources with the last-100-job window', () => {
		assert.equal(FACEBOOK_JOB_COLLECTION, 'facebook_publish_jobs');
		assert.match(dashboardSource, /FACEBOOK_JOB_COLLECTION/);
		assert.match(
			dashboardSource,
			/listWorkspaceResources\(FACEBOOK_JOB_COLLECTION, req, \{ perPage: 100, sort: '-updated' \}\)/,
		);

		const facebookAt = dashboardSource.indexOf('listWorkspaceResources(FACEBOOK_JOB_COLLECTION');
		assert.ok(facebookAt >= 0);
		const facebookBlock = dashboardSource.slice(facebookAt, facebookAt + 280);
		assert.doesNotMatch(facebookBlock, /owner\s*=/);
		assert.doesNotMatch(dashboardSource, /pocketbaseClient\.collection\(FACEBOOK_JOB_COLLECTION\)/);
		assert.doesNotMatch(dashboardSource, /collection\('facebook_publish_jobs'\)/);
	});

	it('excludes other-workspace Facebook jobs because the loader applies workspaceScopeFilter', () => {
		assert.match(ownershipSource, /export async function listWorkspaceResources/);
		const loaderAt = ownershipSource.indexOf('export async function listWorkspaceResources');
		const loaderBlock = ownershipSource.slice(loaderAt, loaderAt + 420);
		assert.match(loaderBlock, /andWorkspaceScope\(req, extraFilter\)/);
		assert.match(ownershipSource, /export function workspaceScopeFilter/);
		assert.match(ownershipSource, /workspace = \{\:ws\}/);
		assert.doesNotMatch(loaderBlock, /ownerField = 'owner'\)\s*;\s*return pocketbaseClient/);
	});

	it('does not add a dashboard endpoint or proxy PR-17 analytics', () => {
		assert.match(routeSource, /router\.get\('\/dashboard'/);
		assert.match(routeSource, /getWorkspaceDashboard\(req\)/);
		assert.doesNotMatch(dashboardSource, /buildWorkspaceOverview/);
		assert.doesNotMatch(dashboardSource, /analytics\/overview/);
		assert.doesNotMatch(dashboardSource, /assembleWorkspaceOverviewFromSources/);
	});

	it('feeds Facebook jobs into the existing dashboard DTO via the publish rollup', () => {
		assert.match(dashboardSource, /from '\.\/workspace-dashboard-publish\.js'/);
		assert.match(dashboardSource, /summarizeDashboardPublishJobs\(\{ publishJobs, wordpressJobs, facebookJobs \}\)/);
		assert.match(dashboardSource, /facebookPublications,/);
		assert.match(dashboardSource, /publishedFacebook,/);
	});
});

describe('summarizeDashboardPublishJobs', () => {
	it('counts facebookPublications from status === published only', () => {
		const summary = summarizeDashboardPublishJobs({
			facebookJobs: [
				{ id: 'fb_pub', status: 'published' },
				{ id: 'fb_sched', status: 'scheduled' },
				{ id: 'fb_pub2', status: 'publishing' },
				{ id: 'fb_fail', status: 'failed' },
				{ id: 'fb_cancel', status: 'cancelled' },
			],
		});
		assert.equal(summary.publishedFacebook, 1);
		assert.equal(summary.facebookPublications, 1);
	});

	it('does not count other-workspace Facebook jobs that were never passed in', () => {
		const summary = summarizeDashboardPublishJobs({
			facebookJobs: [{ id: 'ws_a_job', status: 'published' }],
		});
		assert.equal(summary.facebookPublications, 1);
		assert.equal(summarizeDashboardPublishJobs({ facebookJobs: [] }).facebookPublications, 0);
	});

	it('keeps Pinterest and WordPress published totals unchanged while folding Facebook into aggregates', () => {
		const summary = summarizeDashboardPublishJobs({
			publishJobs: [
				{ id: 'pin_pub', status: 'published' },
				{ id: 'pin_fail', status: 'failed' },
				{ id: 'pin_sched', status: 'scheduled' },
				{ id: 'pin_wait', status: 'waiting_provider' },
			],
			wordpressJobs: [
				{ id: 'wp_pub', status: 'published', wp_status: 'publish' },
				{ id: 'wp_future', status: 'published', wp_status: 'future' },
				{ id: 'wp_fail', status: 'failed' },
			],
			facebookJobs: [
				{ id: 'fb_pub', status: 'published' },
				{ id: 'fb_fail', status: 'failed' },
				{ id: 'fb_sched', status: 'scheduled' },
				{ id: 'fb_pub2', status: 'publishing' },
			],
		});

		assert.equal(summary.publishedPins, 1);
		assert.equal(summary.publishedWp, 1);
		assert.equal(summary.facebookPublications, 1);
		assert.equal(summary.publishedPosts, 3);
		assert.equal(summary.failedJobs, 3);
		assert.equal(summary.scheduledJobs, 5);
		assert.equal(summary.pinterestWaiting, 1);
	});
});
