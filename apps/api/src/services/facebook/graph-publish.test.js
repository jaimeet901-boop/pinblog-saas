import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildFacebookFeedPostBody,
	FACEBOOK_GRAPH_BASE,
	hasExistingFacebookPostId,
	normalizeFacebookGraphError,
	publishFacebookFeedPost,
	resolveFacebookPostPublicUrl,
	sanitizeFacebookGraphErrorPayload,
} from './graph-publish.js';

describe('facebook F4-1 graph publish client', () => {
	it('buildFacebookFeedPostBody maps message, link, and picture', () => {
		const body = buildFacebookFeedPostBody({
			message: 'Hello world',
			linkUrl: 'https://example.com/recipe',
			imageUrl: 'https://cdn.example.com/post.jpg',
		});
		assert.equal(body.message, 'Hello world');
		assert.equal(body.link, 'https://example.com/recipe');
		assert.equal(body.picture, 'https://cdn.example.com/post.jpg');
	});

	it('buildFacebookFeedPostBody rejects empty payload', () => {
		assert.throws(
			() => buildFacebookFeedPostBody({ message: '   ', linkUrl: 'ftp://bad' }),
			(err) => err.errorCode === 'FACEBOOK_FEED_PAYLOAD_EMPTY' && err.retryable === false,
		);
	});

	it('resolveFacebookPostPublicUrl handles composite and simple ids', () => {
		assert.equal(
			resolveFacebookPostPublicUrl('123456789_987654321'),
			'https://www.facebook.com/123456789_987654321',
		);
		assert.equal(
			resolveFacebookPostPublicUrl('987654321', '123456789'),
			'https://www.facebook.com/123456789/posts/987654321',
		);
	});

	it('hasExistingFacebookPostId detects persisted post ids', () => {
		assert.equal(hasExistingFacebookPostId('123_456'), true);
		assert.equal(hasExistingFacebookPostId(''), false);
		assert.equal(hasExistingFacebookPostId(null), false);
	});

	it('sanitizeFacebookGraphErrorPayload redacts access tokens', () => {
		const sanitized = sanitizeFacebookGraphErrorPayload({
			error: {
				message: 'Invalid token EAAG1234567890abcdef',
				access_token: 'EAAG1234567890abcdef',
			},
		});
		const serialized = JSON.stringify(sanitized);
		assert.ok(!serialized.includes('EAAG1234567890abcdef'));
		assert.ok(serialized.includes('[REDACTED'));
	});

	it('normalizeFacebookGraphError marks token errors as non-retryable', () => {
		const normalized = normalizeFacebookGraphError(new Error('expired'), {
			response: { status: 401, headers: { get: () => null } },
			payload: { error: { code: 190, message: 'Invalid OAuth access token' } },
		});
		assert.equal(normalized.retryable, false);
		assert.equal(normalized.tokenExpired, true);
		assert.equal(normalized.errorCode, 'FACEBOOK_TOKEN_EXPIRED');
		assert.equal(normalized.graphCode, 190);
	});

	it('normalizeFacebookGraphError marks rate limits as retryable', () => {
		const normalized = normalizeFacebookGraphError(new Error('limit'), {
			response: {
				status: 429,
				headers: { get: (name) => (name === 'retry-after' ? '30' : null) },
			},
			payload: { error: { code: 4, message: 'Application request limit reached' } },
		});
		assert.equal(normalized.retryable, true);
		assert.equal(normalized.errorCode, 'FACEBOOK_GRAPH_RATE_LIMITED');
		assert.equal(normalized.rateLimitRetryAfterMs, 30000);
	});

	it('normalizeFacebookGraphError marks invalid parameter as terminal', () => {
		const normalized = normalizeFacebookGraphError(new Error('bad param'), {
			response: { status: 400, headers: { get: () => null } },
			payload: { error: { code: 100, message: 'Invalid parameter' } },
		});
		assert.equal(normalized.retryable, false);
		assert.equal(normalized.errorCode, 'FACEBOOK_GRAPH_INVALID_PARAMETER');
	});

	it('publishFacebookFeedPost POSTs to feed endpoint and returns post id', async () => {
		let capturedUrl = '';
		let capturedInit = null;
		const fetchImpl = async (url, init) => {
			capturedUrl = String(url);
			capturedInit = init;
			return {
				ok: true,
				status: 200,
				headers: { get: () => null },
				json: async () => ({ id: '123456789_1122334455' }),
			};
		};

		const result = await publishFacebookFeedPost({
			pageId: '123456789',
			accessToken: 'page-token',
			message: 'Chef IA post',
			linkUrl: 'https://example.com/article',
			fetchImpl,
		});

		assert.equal(result.postId, '123456789_1122334455');
		assert.equal(result.postUrl, 'https://www.facebook.com/123456789_1122334455');
		assert.ok(capturedUrl.startsWith(`${FACEBOOK_GRAPH_BASE}/123456789/feed`));
		assert.equal(capturedInit.method, 'POST');
		assert.match(String(capturedInit.body), /message=Chef\+IA\+post/);
		assert.match(String(capturedInit.body), /link=https%3A%2F%2Fexample.com%2Farticle/);
		assert.match(String(capturedInit.body), /access_token=page-token/);
	});

	it('publishFacebookFeedPost normalizes Graph failures', async () => {
		const fetchImpl = async () => ({
			ok: false,
			status: 403,
			headers: { get: () => null },
			json: async () => ({
				error: { code: 10, message: '(#10) Application does not have permission' },
			}),
		});

		await assert.rejects(
			() => publishFacebookFeedPost({
				pageId: '123456789',
				accessToken: 'page-token',
				message: 'Test',
				fetchImpl,
			}),
			(err) => err.retryable === false && err.errorCode === 'FACEBOOK_GRAPH_PERMISSION_DENIED',
		);
	});

	it('publishFacebookFeedPost rejects missing page id or token', async () => {
		await assert.rejects(
			() => publishFacebookFeedPost({ pageId: '', accessToken: 'x', message: 'a' }),
			(err) => err.errorCode === 'FACEBOOK_PAGE_ID_REQUIRED',
		);
		await assert.rejects(
			() => publishFacebookFeedPost({ pageId: '1', accessToken: '', message: 'a' }),
			(err) => err.errorCode === 'FACEBOOK_PAGE_TOKEN_REQUIRED',
		);
	});
});
