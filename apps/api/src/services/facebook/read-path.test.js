import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	emptyFacebookPublishingAnalytics,
	emptyFacebookPublishingHistoryResponse,
	hasFacebookWorkspaceReadScope,
} from './read-path.js';

describe('facebook read-path helpers', () => {
	it('hasFacebookWorkspaceReadScope requires an owner or creator', () => {
		assert.equal(hasFacebookWorkspaceReadScope({}), false);
		assert.equal(hasFacebookWorkspaceReadScope({
			workspaceOwnerId: '',
			pocketbaseUserId: '',
		}), false);
		assert.equal(hasFacebookWorkspaceReadScope({
			workspaceOwnerId: 'owner_1',
		}), true);
		assert.equal(hasFacebookWorkspaceReadScope({
			pocketbaseUserId: 'user_1',
		}), true);
	});

	it('emptyFacebookPublishingAnalytics returns zeroed summary and no items', () => {
		const payload = emptyFacebookPublishingAnalytics();
		assert.deepEqual(payload.summary, {
			published: 0,
			failed: 0,
			scheduled: 0,
			impressions: 0,
			clicks: 0,
			engagedUsers: 0,
			reactions: 0,
			bestPage: '',
			bestPost: '',
		});
		assert.deepEqual(payload.items, []);
	});

	it('emptyFacebookPublishingHistoryResponse preserves facebook channel filters', () => {
		const payload = emptyFacebookPublishingHistoryResponse({ page: 2, perPage: 25 });
		assert.equal(payload.version, 1);
		assert.deepEqual(payload.items, []);
		assert.equal(payload.meta.page, 1);
		assert.equal(payload.meta.perPage, 25);
		assert.equal(payload.meta.filters.channel, 'facebook');
		assert.equal(payload.meta.totalItems, 0);
	});
});
