import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SCOPES } from './scopes.js';
import {
	buildFacebookPublishCreatedEventPayload,
	buildFacebookPublishJobPayload,
	FACEBOOK_PUBLISH_CREATED_EVENT_TYPE,
	FACEBOOK_PUBLISH_DEFAULT_MAX_ATTEMPTS,
	mapFacebookPublishJobDto,
	prepareFacebookPublishJob,
	resolveFacebookPublishPostContent,
} from './publish.js';

const FULL_SCOPES = DEFAULT_SCOPES.join(',');

const baseAccount = {
	id: 'acc_1',
	owner: 'user_1',
	connected: true,
	status: 'connected',
	label: 'My Business',
	username: 'biz.user',
	scope: FULL_SCOPES,
	page_tokens: { 123456789: 'encrypted_token_blob' },
};

const basePage = {
	id: 'page_rec_1',
	owner: 'user_1',
	account: 'acc_1',
	page_id: '123456789',
	name: 'Chef IA Page',
	connected: true,
	tasks: ['CREATE_CONTENT'],
};

const basePin = {
	id: 'pin_1',
	owner: 'user_1',
	title: 'Summer Recipe',
	description: 'Try this fresh pasta',
	image_url: 'https://cdn.example.com/pin.jpg',
	source_url: 'https://example.com/recipe',
	websiteId: 'site_1',
	articleId: 'art_1',
};

function createTestDeps({
	account = baseAccount,
	page = basePage,
	pin = basePin,
	article = { id: 'art_1', url: 'https://example.com/recipe' },
	activeJob = null,
	workspaceId = 'ws_1',
} = {}) {
	return {
		getOwnedFacebookAccountById: async ({ accountId }) => (
			account && account.id === accountId ? { ...account } : null
		),
		andWorkspaceScope: (_req, filter) => filter,
		recordBelongsToWorkspace: () => true,
		resolveJobCreateStamps: async ({ ownerId }) => ({
			owner: ownerId,
			workspace: workspaceId,
			workspace_key: 'ws-key-1',
		}),
		pocketbaseClient: {
			filter: (template, params = {}) => {
				let result = String(template);
				for (const [key, value] of Object.entries(params)) {
					result = result.replace(new RegExp(`\\{:${key}\\}`, 'g'), String(value));
				}
				return result;
			},
			collection: (name) => {
				if (name === 'ai_pins') {
					return {
						getOne: async (id) => {
							if (pin && pin.id === id) return { ...pin };
							return Promise.reject(new Error('not found'));
						},
					};
				}
				if (name === 'website_articles') {
					return {
						getOne: async (id) => {
							if (article && article.id === id) return { ...article };
							return Promise.reject(new Error('not found'));
						},
					};
				}
				if (name === 'facebook_pages') {
					return {
						getOne: async (id) => {
							if (page && page.id === id) return { ...page };
							return Promise.reject(new Error('not found'));
						},
						getFirstListItem: async (filter) => {
							const filterStr = String(filter);
							if (page && filterStr.includes(page.page_id) && filterStr.includes(page.account)) {
								return { ...page };
							}
							return Promise.reject(new Error('not found'));
						},
					};
				}
				if (name === 'facebook_publish_jobs') {
					return {
						getFirstListItem: async () => (
							activeJob ? { ...activeJob } : Promise.reject(new Error('not found'))
						),
					};
				}
				throw new Error(`unexpected collection ${name}`);
			},
		},
	};
}

describe('facebook F4-2 publish service', () => {
	it('resolveFacebookPublishPostContent merges pin, article, and post overrides', () => {
		const content = resolveFacebookPublishPostContent({
			post: { message: 'Override message', linkUrl: 'https://example.com/override' },
			aiPin: basePin,
			article: { url: 'https://example.com/recipe' },
		});
		assert.equal(content.message, 'Override message');
		assert.equal(content.imageUrl, 'https://cdn.example.com/pin.jpg');
		assert.equal(content.linkUrl, 'https://example.com/override');
		assert.equal(content.title, 'Summer Recipe');
	});

	it('buildFacebookPublishJobPayload denormalizes required job fields', () => {
		const scheduledAt = '2026-08-06T12:00:00.000Z';
		const payload = buildFacebookPublishJobPayload({
			owner: 'user_1',
			workspaceId: 'ws_1',
			account: baseAccount,
			pageRecord: basePage,
			aiPin: basePin,
			content: {
				title: 'Summer Recipe',
				message: 'Hello Facebook',
				caption: 'Hello Facebook',
				imageUrl: 'https://cdn.example.com/pin.jpg',
				linkUrl: 'https://example.com/recipe',
			},
			normalized: { accountId: 'acc_1', pageId: '123456789' },
			timezone: 'Europe/Paris',
			scheduledAt,
		});

		assert.equal(payload.owner, 'user_1');
		assert.equal(payload.workspace, 'ws_1');
		assert.equal(payload.ai_pin, 'pin_1');
		assert.equal(payload.account, 'acc_1');
		assert.equal(payload.page, 'page_rec_1');
		assert.equal(payload.page_id, '123456789');
		assert.equal(payload.page_name, 'Chef IA Page');
		assert.equal(payload.page_label, 'Chef IA Page');
		assert.equal(payload.account_label, 'My Business');
		assert.equal(payload.websiteId, 'site_1');
		assert.equal(payload.articleId, 'art_1');
		assert.equal(payload.status, 'scheduled');
		assert.equal(payload.attempt_count, 0);
		assert.equal(payload.max_attempts, FACEBOOK_PUBLISH_DEFAULT_MAX_ATTEMPTS);
		assert.equal(payload.scheduled_at, scheduledAt);
		assert.equal(payload.timezone, 'Europe/Paris');
		assert.equal(payload.scheduled_timezone, 'Europe/Paris');
		assert.equal(payload.message, 'Hello Facebook');
		assert.equal(payload.destination_url, 'https://example.com/recipe');
	});

	it('buildFacebookPublishCreatedEventPayload prepares created event without job id', () => {
		const eventPayload = buildFacebookPublishCreatedEventPayload({
			owner: 'user_1',
			workspaceId: 'ws_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'pin_1',
			scheduledAt: '2026-08-06T12:00:00.000Z',
			timezone: 'UTC',
		});
		assert.equal(eventPayload.event_type, FACEBOOK_PUBLISH_CREATED_EVENT_TYPE);
		assert.equal(eventPayload.owner, 'user_1');
		assert.equal(eventPayload.workspace, 'ws_1');
		assert.ok(!('job' in eventPayload));
		assert.equal(eventPayload.payload.publishMode, 'now');
		assert.equal(eventPayload.payload.aiPinId, 'pin_1');
	});

	it('mapFacebookPublishJobDto maps public job fields', () => {
		const dto = mapFacebookPublishJobDto({
			id: 'job_1',
			status: 'scheduled',
			scheduled_at: '2026-08-06T12:00:00.000Z',
			timezone: 'UTC',
			account: 'acc_1',
			page_id: '123456789',
			page_name: 'Chef IA Page',
			ai_pin: 'pin_1',
			title: 'Summer Recipe',
			message: 'Hello',
			image_url: 'https://cdn.example.com/pin.jpg',
			destination_url: 'https://example.com/recipe',
			attempt_count: 0,
			max_attempts: 3,
		});
		assert.equal(dto.id, 'job_1');
		assert.equal(dto.accountId, 'acc_1');
		assert.equal(dto.pageId, '123456789');
		assert.equal(dto.aiPinId, 'pin_1');
		assert.equal(dto.message, 'Hello');
	});

	it('prepareFacebookPublishJob returns job and event payloads for valid request', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'pin_1',
			post: { message: 'Chef IA launch post' },
			timezone: 'UTC',
			scheduledAt: '2026-08-06T12:00:00.000Z',
			deps: createTestDeps(),
		});

		assert.equal(result.ok, true);
		assert.deepEqual(result.errors, []);
		assert.ok(result.jobPayload);
		assert.ok(result.eventPayload);
		assert.equal(result.jobPayload.ai_pin, 'pin_1');
		assert.equal(result.jobPayload.page_id, '123456789');
		assert.equal(result.eventPayload.event_type, FACEBOOK_PUBLISH_CREATED_EVENT_TYPE);
		assert.equal(result.dtoPreview.aiPinId, 'pin_1');
		assert.equal(result.dtoPreview.pageId, '123456789');
	});

	it('prepareFacebookPublishJob rejects invalid post content via F3 validators', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'pin_1',
			post: { message: 'x'.repeat(63207) },
			deps: createTestDeps(),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((err) => err.includes('Message exceeds')));
		assert.ok(!result.jobPayload);
	});

	it('prepareFacebookPublishJob rejects missing aiPinId', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: '',
			deps: createTestDeps(),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('AI pin is required'));
	});

	it('prepareFacebookPublishJob rejects unknown ai pin', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'missing',
			deps: createTestDeps(),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('AI pin not found'));
	});

	it('prepareFacebookPublishJob rejects pinterest-stamped pins as not found', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'pin_1',
			deps: createTestDeps({ pin: { ...basePin, channel: 'pinterest' } }),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.includes('AI pin not found'));
		assert.ok(!result.jobPayload);
	});

	it('prepareFacebookPublishJob still publishes empty-channel legacy pins', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'pin_1',
			post: { message: 'Legacy pin' },
			deps: createTestDeps({ pin: { ...basePin } }),
		});
		assert.equal(result.ok, true);
		assert.ok(result.jobPayload);
	});

	it('prepareFacebookPublishJob accepts facebook-stamped pins', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'pin_1',
			post: { message: 'Facebook pin' },
			deps: createTestDeps({ pin: { ...basePin, channel: 'facebook' } }),
		});
		assert.equal(result.ok, true);
		assert.ok(result.jobPayload);
	});

	it('prepareFacebookPublishJob rejects active existing job for pin', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'pin_1',
			deps: createTestDeps({
				activeJob: { id: 'job_active', status: 'scheduled', ai_pin: 'pin_1' },
			}),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((err) => err.includes('active Facebook publish job')));
	});

	it('prepareFacebookPublishJob rejects destination not ready', async () => {
		const result = await prepareFacebookPublishJob({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123456789',
			aiPinId: 'pin_1',
			deps: createTestDeps({
				account: { ...baseAccount, connected: false, status: 'disconnected' },
			}),
		});
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((err) => err.includes('Destination not ready')));
	});
});
