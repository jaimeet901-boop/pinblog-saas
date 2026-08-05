import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SCOPES } from './scopes.js';
import {
	accountHasPageToken,
	buildDestinationsListResponse,
	getFacebookDestination,
	listFacebookDestinations,
	mapFacebookDestination,
} from './destinations.js';

const FULL_SCOPES = DEFAULT_SCOPES.join(',');

const baseAccount = {
	id: 'acc_1',
	owner: 'user_1',
	connected: true,
	status: 'connected',
	label: 'My Business',
	username: 'biz.user',
	scope: FULL_SCOPES,
	last_sync_at: '2026-08-01T12:00:00.000Z',
	page_tokens: {
		123456789: 'encrypted_page_token_ciphertext',
	},
};

const basePage = {
	id: 'page_rec_1',
	owner: 'user_1',
	account: 'acc_1',
	page_id: '123456789',
	name: 'Chef IA Page',
	category: 'Business',
	thumbnail_url: 'https://cdn.example.com/page.jpg',
	fan_count: 4200,
	is_default: true,
	connected: true,
	tasks: ['CREATE_CONTENT'],
	updated: '2026-08-01T12:05:00.000Z',
};

function assertNoSecretLeakage(value, path = 'root') {
	if (value == null) return;
	if (typeof value === 'string') {
		assert.ok(!/encrypted_page_token_ciphertext/.test(value), `secret leaked at ${path}`);
		assert.ok(!/EAAG/.test(value), `token pattern leaked at ${path}`);
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => assertNoSecretLeakage(item, `${path}[${index}]`));
		return;
	}
	if (typeof value === 'object') {
		for (const [key, nested] of Object.entries(value)) {
			assert.notEqual(key, 'access_token');
			assert.notEqual(key, 'refresh_token');
			assert.notEqual(key, 'page_tokens');
			assert.notEqual(key, '_secretRecordId');
			assertNoSecretLeakage(nested, `${path}.${key}`);
		}
	}
}

function createTestDeps({ account = baseAccount, pages = null, page = basePage } = {}) {
	const pageRows = pages ?? [page];
	return {
		getOwnedFacebookAccountById: async ({ accountId }) => (
			account && account.id === accountId ? { ...account } : null
		),
		andWorkspaceScope: (_req, filter) => filter,
		recordBelongsToWorkspace: () => true,
		pocketbaseClient: {
			filter: (template) => template,
			collection: (name) => {
				if (name !== 'facebook_pages') {
					throw new Error(`unexpected collection ${name}`);
				}
				return {
					getFullList: async () => pageRows.map((item) => ({ ...item })),
					getOne: async (id) => {
						const match = pageRows.find((item) => item.id === id);
						return match ? { ...match } : Promise.reject(new Error('not found'));
					},
				};
			},
		},
	};
}

describe('mapFacebookDestination', () => {
	it('maps identity, display, account context, permissions, and publishReadiness', () => {
		const dto = mapFacebookDestination(basePage, baseAccount);
		assert.equal(dto.id, 'page_rec_1');
		assert.equal(dto.pageId, '123456789');
		assert.equal(dto.accountId, 'acc_1');
		assert.equal(dto.name, 'Chef IA Page');
		assert.equal(dto.category, 'Business');
		assert.equal(dto.thumbnailUrl, 'https://cdn.example.com/page.jpg');
		assert.equal(dto.fanCount, 4200);
		assert.equal(dto.isDefault, true);
		assert.equal(dto.connected, true);
		assert.equal(dto.updatedAt, '2026-08-01T12:05:00.000Z');
		assert.equal(dto.accountLabel, 'My Business');
		assert.equal(dto.accountUsername, 'biz.user');
		assert.equal(dto.accountStatus, 'connected');
		assert.deepEqual(dto.tasks, ['CREATE_CONTENT']);
		assert.equal(dto.permissions.canPublish, true);
		assert.equal(dto.permissions.hasPageToken, true);
		assert.equal(dto.permissions.hasRequiredScopes, true);
		assert.deepEqual(dto.permissions.blockedReasons, []);
		assert.equal(dto.publishReadiness.ready, true);
		assert.deepEqual(dto.publishReadiness.reasons, []);
		assert.equal(dto.boardId, '123456789');
		assert.equal(dto.boardId, dto.pageId);
	});

	it('sets publishReadiness false when page token is missing', () => {
		const dto = mapFacebookDestination(basePage, { ...baseAccount, page_tokens: {} });
		assert.equal(dto.publishReadiness.ready, false);
		assert.ok(dto.publishReadiness.reasons.includes('Page access token is missing'));
		assert.equal(dto.permissions.hasPageToken, false);
		assert.equal(dto.permissions.canPublish, false);
	});

	it('sets publishReadiness false when account is disconnected', () => {
		const dto = mapFacebookDestination(basePage, {
			...baseAccount,
			connected: false,
			status: 'disconnected',
		});
		assert.equal(dto.publishReadiness.ready, false);
		assert.ok(dto.publishReadiness.reasons.includes('Facebook account is not connected'));
		assert.equal(dto.permissions.canPublish, false);
	});

	it('sets publishReadiness false when page is disconnected', () => {
		const dto = mapFacebookDestination({ ...basePage, connected: false }, baseAccount);
		assert.equal(dto.publishReadiness.ready, false);
		assert.equal(dto.connected, false);
		assert.ok(dto.publishReadiness.reasons.includes('Facebook Page is not connected'));
	});

	it('does not expose secrets or token fields in DTO', () => {
		const dto = mapFacebookDestination(basePage, baseAccount);
		assertNoSecretLeakage(dto);
		assert.ok(!('access_token' in dto));
		assert.ok(!('page_tokens' in dto));
	});
});

describe('accountHasPageToken', () => {
	it('detects encrypted page token entry without decrypting', () => {
		assert.equal(accountHasPageToken(baseAccount, '123456789'), true);
		assert.equal(accountHasPageToken(baseAccount, '999'), false);
	});
});

describe('buildDestinationsListResponse', () => {
	it('builds list envelope with account summary and mapped items', () => {
		const response = buildDestinationsListResponse(baseAccount, [basePage]);
		assert.equal(response.accountId, 'acc_1');
		assert.equal(response.account.id, 'acc_1');
		assert.equal(response.account.label, 'My Business');
		assert.equal(response.account.scopesOk, true);
		assert.deepEqual(response.account.missingScopes, []);
		assert.equal(response.syncedAt, '2026-08-01T12:00:00.000Z');
		assert.equal(response.unavailable, false);
		assert.equal(response.items.length, 1);
		assert.equal(response.items[0].pageId, '123456789');
		assertNoSecretLeakage(response);
	});

	it('marks envelope unavailable when account is expired', () => {
		const response = buildDestinationsListResponse(
			{ ...baseAccount, status: 'expired', connected: false },
			[basePage],
		);
		assert.equal(response.unavailable, true);
		assert.match(response.message || '', /expired/i);
	});
});

describe('listFacebookDestinations', () => {
	it('returns mapped destinations for an owned account', async () => {
		const result = await listFacebookDestinations({
			owner: 'user_1',
			accountId: 'acc_1',
			deps: createTestDeps(),
		});
		assert.ok(result);
		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].boardId, result.items[0].pageId);
		assert.equal(result.items[0].publishReadiness.ready, true);
		assertNoSecretLeakage(result);
	});

	it('returns null when account is not owned', async () => {
		const result = await listFacebookDestinations({
			owner: 'user_1',
			accountId: 'missing',
			deps: createTestDeps({ account: null }),
		});
		assert.equal(result, null);
	});

	it('marks list unavailable for disconnected account', async () => {
		const result = await listFacebookDestinations({
			owner: 'user_1',
			accountId: 'acc_1',
			deps: createTestDeps({
				account: { ...baseAccount, connected: false, status: 'disconnected' },
			}),
		});
		assert.ok(result);
		assert.equal(result.unavailable, true);
		assert.match(result.message || '', /not connected/i);
		assert.equal(result.items[0].publishReadiness.ready, false);
	});
});

describe('getFacebookDestination', () => {
	it('returns mapped destination for owned page record', async () => {
		const dto = await getFacebookDestination({
			owner: 'user_1',
			destinationId: 'page_rec_1',
			deps: createTestDeps(),
		});
		assert.ok(dto);
		assert.equal(dto.id, 'page_rec_1');
		assert.equal(dto.boardId, dto.pageId);
		assert.equal(dto.publishReadiness.ready, true);
		assertNoSecretLeakage(dto);
	});

	it('returns null when page record is not owned', async () => {
		const dto = await getFacebookDestination({
			owner: 'user_1',
			destinationId: 'page_rec_1',
			deps: createTestDeps({ page: { ...basePage, owner: 'other_user' } }),
		});
		assert.equal(dto, null);
	});

	it('returns null when destination record is missing', async () => {
		const dto = await getFacebookDestination({
			owner: 'user_1',
			destinationId: 'missing_page',
			deps: createTestDeps({ pages: [] }),
		});
		assert.equal(dto, null);
	});
});
