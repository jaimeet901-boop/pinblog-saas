import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SCOPES } from './scopes.js';
import {
	derivePagePermissions,
	REQUIRED_PAGE_TASKS,
	validateFacebookDestinationReady,
	validateFacebookPostForPublish,
} from './validators.js';

const FULL_SCOPES = DEFAULT_SCOPES.join(',');
const FULL_TASKS = [...REQUIRED_PAGE_TASKS];

const connectedAccount = {
	id: 'acc_1',
	connected: true,
	status: 'connected',
	scope: FULL_SCOPES,
};

const connectedPage = {
	id: 'page_rec_1',
	pageId: '123456789',
	page_id: '123456789',
	name: 'Test Page',
	connected: true,
	tasks: FULL_TASKS,
};

describe('derivePagePermissions', () => {
	it('returns canPublish when scopes, tasks, and page token are present', () => {
		const result = derivePagePermissions({
			tasks: FULL_TASKS,
			grantedScopes: FULL_SCOPES,
			hasPageToken: true,
			accountStatus: 'connected',
			accountConnected: true,
		});
		assert.equal(result.canPublish, true);
		assert.equal(result.hasPageToken, true);
		assert.equal(result.hasRequiredScopes, true);
		assert.equal(result.hasRequiredTasks, true);
		assert.deepEqual(result.missingScopes, []);
		assert.deepEqual(result.missingTasks, []);
		assert.deepEqual(result.blockedReasons, []);
	});

	it('blocks publish when required OAuth scope is missing', () => {
		const result = derivePagePermissions({
			tasks: FULL_TASKS,
			grantedScopes: 'public_profile,pages_show_list',
			hasPageToken: true,
			accountConnected: true,
		});
		assert.equal(result.canPublish, false);
		assert.equal(result.hasRequiredScopes, false);
		assert.ok(result.missingScopes.includes('pages_manage_posts'));
		assert.ok(result.blockedReasons.some((r) => r.includes('Missing OAuth scopes')));
	});

	it('blocks publish when account token is expired', () => {
		const result = derivePagePermissions({
			tasks: FULL_TASKS,
			grantedScopes: FULL_SCOPES,
			hasPageToken: true,
			accountStatus: 'expired',
			accountConnected: false,
		});
		assert.equal(result.canPublish, false);
		assert.ok(result.blockedReasons.includes('Facebook account token has expired'));
	});

	it('blocks publish when page token is missing', () => {
		const result = derivePagePermissions({
			tasks: FULL_TASKS,
			grantedScopes: FULL_SCOPES,
			hasPageToken: false,
			accountConnected: true,
		});
		assert.equal(result.canPublish, false);
		assert.equal(result.hasPageToken, false);
		assert.ok(result.blockedReasons.includes('Page access token is missing'));
	});

	it('blocks publish when required page task is missing', () => {
		const result = derivePagePermissions({
			tasks: ['ANALYZE'],
			grantedScopes: FULL_SCOPES,
			hasPageToken: true,
			accountConnected: true,
		});
		assert.equal(result.canPublish, false);
		assert.equal(result.hasRequiredTasks, false);
		assert.deepEqual(result.missingTasks, ['CREATE_CONTENT']);
		assert.ok(result.blockedReasons.some((r) => r.includes('Missing page tasks')));
	});
});

describe('validateFacebookDestinationReady', () => {
	it('accepts a valid connected destination', () => {
		const result = validateFacebookDestinationReady({
			account: connectedAccount,
			page: connectedPage,
			hasPageToken: true,
		});
		assert.equal(result.ready, true);
		assert.deepEqual(result.reasons, []);
		assert.equal(result.permissions.canPublish, true);
	});

	it('rejects destination when OAuth scope is missing', () => {
		const result = validateFacebookDestinationReady({
			account: { ...connectedAccount, scope: 'pages_show_list' },
			page: connectedPage,
			hasPageToken: true,
		});
		assert.equal(result.ready, false);
		assert.ok(result.reasons.some((r) => r.includes('Missing OAuth scopes')));
	});

	it('rejects destination when account token is expired', () => {
		const result = validateFacebookDestinationReady({
			account: { ...connectedAccount, status: 'expired', connected: false },
			page: connectedPage,
			hasPageToken: true,
		});
		assert.equal(result.ready, false);
		assert.ok(result.reasons.includes('Facebook account is not connected'));
		assert.ok(result.reasons.includes('Facebook account token has expired'));
	});

	it('rejects destination when page token is missing', () => {
		const result = validateFacebookDestinationReady({
			account: connectedAccount,
			page: connectedPage,
			hasPageToken: false,
		});
		assert.equal(result.ready, false);
		assert.ok(result.reasons.includes('Page access token is missing'));
	});

	it('rejects disconnected page', () => {
		const result = validateFacebookDestinationReady({
			account: connectedAccount,
			page: { ...connectedPage, connected: false },
			hasPageToken: true,
		});
		assert.equal(result.ready, false);
		assert.ok(result.reasons.includes('Facebook Page is not connected'));
	});

	it('rejects disconnected account', () => {
		const result = validateFacebookDestinationReady({
			account: { ...connectedAccount, connected: false, status: 'disconnected' },
			page: connectedPage,
			hasPageToken: true,
		});
		assert.equal(result.ready, false);
		assert.ok(result.reasons.includes('Facebook account is not connected'));
	});
});

describe('validateFacebookPostForPublish', () => {
	it('accepts a valid post with destination', () => {
		const result = validateFacebookPostForPublish({
			post: {
				message: 'Hello Facebook',
				imageUrl: 'https://cdn.example.com/post.jpg',
				linkUrl: 'https://example.com/article',
				accountId: 'acc_1',
				pageId: '123456789',
			},
			account: connectedAccount,
			page: connectedPage,
			hasPageToken: true,
		});
		assert.equal(result.ok, true);
		assert.deepEqual(result.errors, []);
		assert.equal(result.normalized.message, 'Hello Facebook');
		assert.equal(result.normalized.imageUrl, 'https://cdn.example.com/post.jpg');
		assert.equal(result.normalized.linkUrl, 'https://example.com/article');
		assert.equal(result.normalized.accountId, 'acc_1');
		assert.equal(result.normalized.pageId, '123456789');
	});

	it('rejects invalid media URL', () => {
		const result = validateFacebookPostForPublish({
			post: {
				message: 'Photo post',
				imageUrl: 'not-a-url',
				accountId: 'acc_1',
				pageId: '123456789',
			},
			account: connectedAccount,
			page: connectedPage,
			hasPageToken: true,
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('Image URL must be a valid http(s) URL'));
	});

	it('rejects invalid link URL', () => {
		const result = validateFacebookPostForPublish({
			post: {
				message: 'Link post',
				linkUrl: 'ftp://bad.example.com',
				accountId: 'acc_1',
				pageId: '123456789',
			},
			account: connectedAccount,
			page: connectedPage,
			hasPageToken: true,
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('Link URL must be a valid http(s) URL'));
	});

	it('rejects post when destination ids are missing', () => {
		const missingIds = validateFacebookPostForPublish({
			post: { message: 'Hello' },
		});
		assert.equal(missingIds.ok, false);
		assert.ok(missingIds.errors.includes('Facebook account is required'));
		assert.ok(missingIds.errors.includes('Facebook Page is required'));
	});

	it('rejects post when destination is not ready', () => {
		const notReady = validateFacebookPostForPublish({
			post: {
				message: 'Hello',
				accountId: 'acc_1',
				pageId: '123456789',
			},
			account: connectedAccount,
			page: connectedPage,
			hasPageToken: false,
		});
		assert.equal(notReady.ok, false);
		assert.ok(notReady.errors.some((e) => e.includes('Destination not ready')));
		assert.ok(notReady.errors.some((e) => e.includes('Page access token is missing')));
	});
});
