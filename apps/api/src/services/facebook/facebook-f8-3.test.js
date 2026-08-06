import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F8-3 read-path performance & resilience polish', () => {
	it('documents analytics sync worker environment variables', () => {
		const docs = readFileSync(
			path.join(root, 'docs/facebook-channel-pack-operations.md'),
			'utf8',
		);

		assert.match(docs, /FACEBOOK_ANALYTICS_ENABLED/);
		assert.match(docs, /FACEBOOK_ANALYTICS_POLL_MS/);
		assert.match(docs, /FACEBOOK_ANALYTICS_BATCH/);
		assert.match(docs, /FACEBOOK_ANALYTICS_RESYNC_MS/);
	});

	it('short-circuits analytics and history reads without workspace scope', () => {
		const analytics = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/analytics.js'),
			'utf8',
		);
		const history = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/history.js'),
			'utf8',
		);
		const readPath = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/read-path.js'),
			'utf8',
		);

		assert.match(readPath, /hasFacebookWorkspaceReadScope/);
		assert.match(readPath, /emptyFacebookPublishingAnalytics/);
		assert.match(readPath, /emptyFacebookPublishingHistoryResponse/);
		assert.match(analytics, /hasFacebookWorkspaceReadScope/);
		assert.match(analytics, /emptyFacebookPublishingAnalytics/);
		assert.match(history, /hasFacebookWorkspaceReadScope/);
		assert.match(history, /emptyFacebookPublishingHistoryResponse/);
	});

	it('parallelizes analytics filter building for read-path efficiency', () => {
		const analytics = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/analytics.js'),
			'utf8',
		);

		assert.match(analytics, /Promise\.all\(\[\s*buildSchemaSafeFilter/);
	});

	it('adds resilient analytics loading state to Facebook Hub', () => {
		const hub = readFileSync(
			path.join(root, 'apps/web/src/pages/app/FacebookPage.jsx'),
			'utf8',
		);

		assert.match(hub, /analyticsLoading/);
		assert.match(hub, /Failed to load analytics/);
		assert.match(hub, /Loading analytics/);
	});

	it('keeps frozen subsystems untouched for F8-3', () => {
		const queue = readFileSync(path.join(root, 'apps/api/src/services/queue/engine.js'), 'utf8');
		const graph = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/graph-publish.js'),
			'utf8',
		);
		const calendar = readFileSync(
			path.join(root, 'apps/api/src/services/calendar/facade.js'),
			'utf8',
		);

		assert.doesNotMatch(queue, /read-path\.js/);
		assert.doesNotMatch(graph, /emptyFacebookPublishingAnalytics/);
		assert.doesNotMatch(calendar, /emptyFacebookPublishingHistoryResponse/);
	});
});
