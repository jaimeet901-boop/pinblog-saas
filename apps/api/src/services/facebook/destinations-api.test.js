import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SCOPES } from './scopes.js';
import {
	assertFacebookAccountConnected,
	buildDestinationsListResponse,
	getFacebookDestination,
	listFacebookDestinations,
	mapFacebookDestination,
	mapLegacyPageItem,
	validateFacebookDestinationPost,
	LEGACY_PAGE_DTO_KEYS,
} from './destinations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
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
	page_tokens: { 123456789: 'encrypted_token_blob' },
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
	updated: '2026-08-01 12:05:00.000Z',
};

function createTestDeps({ account = baseAccount, pages = null, page = basePage, workspaceOk = true } = {}) {
	const pageRows = pages ?? [page];
	return {
		getOwnedFacebookAccountById: async ({ accountId }) => (
			account && account.id === accountId ? { ...account } : null
		),
		andWorkspaceScope: (_req, filter) => filter,
		recordBelongsToWorkspace: () => workspaceOk,
		pocketbaseClient: {
			filter: (template, params = {}) => {
				let result = String(template);
				for (const [key, value] of Object.entries(params)) {
					result = result.replace(new RegExp(`\\{:${key}\\}`, 'g'), String(value));
				}
				return result;
			},
			collection: (name) => {
				if (name !== 'facebook_pages') throw new Error(`unexpected collection ${name}`);
				return {
					getFullList: async () => pageRows.map((item) => ({ ...item })),
					getOne: async (id) => {
						const match = pageRows.find((item) => item.id === id);
						return match ? { ...match } : Promise.reject(new Error('not found'));
					},
					getFirstListItem: async (filter) => {
						const filterStr = String(filter);
						const match = pageRows.find((item) => (
							filterStr.includes(String(item.page_id))
							&& filterStr.includes(String(item.account))
						));
						return match ? { ...match } : Promise.reject(new Error('not found'));
					},
				};
			},
		},
	};
}

describe('facebook F3-3 destination read API helpers', () => {
	it('mapLegacyPageItem matches mapPage field contract for backward compatibility', () => {
		const legacy = mapLegacyPageItem(basePage, baseAccount);
		const expected = {
			id: basePage.id,
			accountId: basePage.account,
			pageId: basePage.page_id,
			name: basePage.name,
			category: basePage.category || '',
			thumbnailUrl: basePage.thumbnail_url || '',
			fanCount: Number(basePage.fan_count) || 0,
			isDefault: Boolean(basePage.is_default),
			connected: basePage.connected !== false,
			websiteId: basePage.websiteId || '',
			updatedAt: basePage.updated,
		};
		for (const key of LEGACY_PAGE_DTO_KEYS) {
			assert.ok(Object.prototype.hasOwnProperty.call(legacy, key), `missing legacy key ${key}`);
		}
		assert.equal(legacy.id, expected.id);
		assert.equal(legacy.accountId, expected.accountId);
		assert.equal(legacy.pageId, expected.pageId);
		assert.equal(legacy.name, expected.name);
		assert.equal(legacy.category, expected.category);
		assert.equal(legacy.thumbnailUrl, expected.thumbnailUrl);
		assert.equal(legacy.fanCount, expected.fanCount);
		assert.equal(legacy.isDefault, expected.isDefault);
		assert.equal(legacy.connected, expected.connected);
		assert.equal(legacy.websiteId, expected.websiteId);
		assert.equal(legacy.updatedAt, expected.updatedAt);
		assert.ok(!('permissions' in legacy));
		assert.ok(!('publishReadiness' in legacy));
		assert.ok(!('boardId' in legacy));
	});

	it('listFacebookDestinations returns approved list envelope contract', async () => {
		const result = await listFacebookDestinations({
			owner: 'user_1',
			accountId: 'acc_1',
			deps: createTestDeps(),
		});
		assert.ok(result);
		assert.equal(result.accountId, 'acc_1');
		assert.equal(result.account.id, 'acc_1');
		assert.equal(typeof result.account.scopesOk, 'boolean');
		assert.ok(Array.isArray(result.account.missingScopes));
		assert.ok(Array.isArray(result.items));
		assert.equal(typeof result.unavailable, 'boolean');
		const item = result.items[0];
		assert.equal(item.boardId, item.pageId);
		assert.ok(item.permissions);
		assert.ok(item.publishReadiness);
	});

	it('getFacebookDestination returns canonical DTO for owned destination', async () => {
		const dto = await getFacebookDestination({
			owner: 'user_1',
			destinationId: 'page_rec_1',
			deps: createTestDeps(),
		});
		assert.ok(dto);
		assert.equal(dto.id, 'page_rec_1');
		assert.equal(dto.pageId, '123456789');
	});

	it('getFacebookDestination returns null for unknown destination', async () => {
		const dto = await getFacebookDestination({
			owner: 'user_1',
			destinationId: 'missing',
			deps: createTestDeps({ pages: [] }),
		});
		assert.equal(dto, null);
	});

	it('listFacebookDestinations returns null for unknown account', async () => {
		const result = await listFacebookDestinations({
			owner: 'user_1',
			accountId: 'missing',
			deps: createTestDeps({ account: null }),
		});
		assert.equal(result, null);
	});

	it('listFacebookDestinations marks disconnected account unavailable', async () => {
		const result = await listFacebookDestinations({
			owner: 'user_1',
			accountId: 'acc_1',
			deps: createTestDeps({
				account: { ...baseAccount, connected: false, status: 'disconnected' },
			}),
		});
		assert.equal(result.unavailable, true);
		assert.equal(result.items[0].publishReadiness.ready, false);
	});

	it('getFacebookDestination returns null for cross-workspace page', async () => {
		const dto = await getFacebookDestination({
			owner: 'user_1',
			destinationId: 'page_rec_1',
			req: { workspaceId: 'ws_a' },
			deps: createTestDeps({ workspaceOk: false }),
		});
		assert.equal(dto, null);
	});

	it('assertFacebookAccountConnected rejects disconnected account', async () => {
		await assert.rejects(
			() => assertFacebookAccountConnected({
				owner: 'user_1',
				accountId: 'acc_1',
				deps: createTestDeps({
					account: { ...baseAccount, connected: false, status: 'disconnected' },
				}),
			}),
			(err) => err.status === 422 && err.errorCode === 'FACEBOOK_ACCOUNT_NOT_CONNECTED',
		);
	});

	it('assertFacebookAccountConnected rejects unknown account', async () => {
		await assert.rejects(
			() => assertFacebookAccountConnected({
				owner: 'user_1',
				accountId: 'missing',
				deps: createTestDeps({ account: null }),
			}),
			(err) => err.status === 404 && err.errorCode === 'FACEBOOK_ACCOUNT_NOT_FOUND',
		);
	});

	it('assertFacebookAccountConnected accepts connected account', async () => {
		const account = await assertFacebookAccountConnected({
			owner: 'user_1',
			accountId: 'acc_1',
			deps: createTestDeps(),
		});
		assert.equal(account.id, 'acc_1');
	});

	it('buildDestinationsListResponse never includes token fields in items', () => {
		const response = buildDestinationsListResponse(baseAccount, [basePage]);
		const serialized = JSON.stringify(response);
		assert.ok(!serialized.includes('encrypted_token_blob'));
		assert.ok(!serialized.includes('page_tokens'));
		assert.ok(!serialized.includes('access_token'));
	});

	it('mapFacebookDestination includes full canonical DTO fields', () => {
		const dto = mapFacebookDestination(basePage, baseAccount);
		assert.equal(dto.boardId, dto.pageId);
		assert.ok(dto.permissions);
		assert.ok(dto.publishReadiness);
		assert.equal(dto.accountLabel, 'My Business');
	});
});

describe('facebook F3-4 destination validation API', () => {
	const validPost = {
		message: 'Hello from Chef IA',
		imageUrl: 'https://cdn.example.com/post.jpg',
		linkUrl: 'https://example.com/recipe',
	};

	it('returns ok for a valid request', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			post: validPost,
			deps: createTestDeps(),
		});
		assert.equal(result.ok, true);
		assert.deepEqual(result.errors, []);
		assert.equal(result.normalized.accountId, 'acc_1');
		assert.equal(result.normalized.pageId, '123456789');
		assert.equal(result.normalized.message, validPost.message);
		assert.equal(result.normalized.imageUrl, validPost.imageUrl);
		assert.equal(result.normalized.linkUrl, validPost.linkUrl);
	});

	it('returns errors for invalid message length', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			post: { ...validPost, message: 'x'.repeat(63207) },
			deps: createTestDeps(),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((err) => err.includes('Message exceeds')));
	});

	it('returns errors for invalid image URL', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			post: { ...validPost, imageUrl: 'not-a-url' },
			deps: createTestDeps(),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('Image URL must be a valid http(s) URL'));
	});

	it('returns errors for invalid link URL', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			post: { ...validPost, linkUrl: 'ftp://bad.example' },
			deps: createTestDeps(),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('Link URL must be a valid http(s) URL'));
	});

	it('returns errors when destination is not found', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: 'missing_page',
			post: validPost,
			deps: createTestDeps({ pages: [] }),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('Facebook destination not found'));
	});

	it('returns errors for disconnected account', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			post: validPost,
			deps: createTestDeps({
				account: { ...baseAccount, connected: false, status: 'disconnected' },
			}),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((err) => err.includes('Destination not ready: Facebook account is not connected')));
	});

	it('returns errors when destination is not ready', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			post: validPost,
			deps: createTestDeps({
				page: { ...basePage, tasks: [] },
				account: { ...baseAccount, page_tokens: {} },
			}),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((err) => err.includes('Destination not ready:')));
	});

	it('returns errors when accountId is missing', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: '',
			pageId: '123456789',
			post: validPost,
			deps: createTestDeps(),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('Facebook account is required'));
	});

	it('returns errors when pageId is missing', async () => {
		const result = await validateFacebookDestinationPost({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '',
			post: validPost,
			deps: createTestDeps(),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('Facebook Page is required'));
	});
});

describe('facebook F3 route wiring', () => {
	it('registers destination read routes and validation route', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		assert.match(route, /router\.get\('\/pages'/);
		assert.match(route, /router\.get\('\/destinations'/);
		assert.match(route, /router\.post\('\/destinations\/validate'/);
		assert.match(route, /router\.get\('\/destinations\/:destinationId'/);
		assert.match(route, /mapLegacyPageItem/);
		assert.match(route, /listFacebookDestinations/);
		assert.match(route, /getFacebookDestination/);
		assert.match(route, /validateFacebookDestinationPost/);
		assert.match(route, /assertFacebookAccountConnected/);
		const validateRouteIndex = route.indexOf("router.post('/destinations/validate'");
		const paramRouteIndex = route.indexOf("router.get('/destinations/:destinationId'");
		assert.ok(validateRouteIndex >= 0 && paramRouteIndex >= 0);
		assert.ok(validateRouteIndex < paramRouteIndex, 'validate route must register before :destinationId');
		assert.doesNotMatch(route, /router\.(post|put|patch|delete)\('\/publish/);
	});
});
