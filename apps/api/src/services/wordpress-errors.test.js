/**
 * P1-8 — structured WordPress error codes.
 * Run: node --test src/services/wordpress-errors.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
	authFailedForWordpressErrorCode,
	createPublishJobFailureError,
	createWordpressError,
	extractWordpressErrorCode,
	httpStatusForWordpressErrorCode,
	LEGACY_WORDPRESS_ERROR_CODE_ALIASES,
	normalizeWordpressErrorCode,
	resolvePublishJobErrorCode,
	respondWordpressApiError,
	sanitizeWordpressErrorMessage,
	toWordpressApiErrorBody,
	withPublishJobFailurePayload,
	WORDPRESS_ERROR_CODES,
} from './wordpress-errors.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('wordpress structured error codes (P1-8)', () => {
	it('maps authentication failure to WP_AUTH_FAILED with HTTP 401', () => {
		const error = createWordpressError(WORDPRESS_ERROR_CODES.WP_AUTH_FAILED, 'Invalid credentials');
		assert.equal(error.errorCode, 'WP_AUTH_FAILED');
		assert.equal(error.status, 401);
		assert.equal(error.authFailed, true);
	});

	it('maps capability denial to WP_CAPABILITY_DENIED with HTTP 403 and authFailed=false', () => {
		const error = createWordpressError(
			WORDPRESS_ERROR_CODES.WP_CAPABILITY_DENIED,
			'Cannot publish posts publicly',
		);
		assert.equal(error.errorCode, 'WP_CAPABILITY_DENIED');
		assert.equal(error.status, 403);
		assert.equal(error.authFailed, false);
	});

	it('maps not-found to WP_NOT_FOUND with HTTP 404', () => {
		assert.equal(httpStatusForWordpressErrorCode('WP_NOT_FOUND'), 404);
		const error = createWordpressError('WP_NOT_FOUND', 'Post missing');
		assert.equal(error.errorCode, 'WP_NOT_FOUND');
	});

	it('maps connection failures to stable WP_CONNECTION_FAILED code', () => {
		const clientSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		assert.match(clientSource, /WORDPRESS_ERROR_CODES\.WP_CONNECTION_FAILED/);
		const error = createWordpressError('WP_CONNECTION_FAILED', 'Could not reach WordPress: ECONNRESET', {
			retryable: true,
		});
		assert.equal(error.errorCode, 'WP_CONNECTION_FAILED');
		assert.equal(error.status, 502);
		assert.equal(error.retryable, true);
	});

	it('maps API failures to WP_API_ERROR and rate limits to WP_RATE_LIMITED', () => {
		const clientSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		assert.match(clientSource, /WORDPRESS_ERROR_CODES\.WP_API_ERROR/);
		assert.match(clientSource, /WORDPRESS_ERROR_CODES\.WP_RATE_LIMITED/);
		const apiError = createWordpressError('WP_API_ERROR', 'WordPress error: server error');
		const rateError = createWordpressError('WP_RATE_LIMITED', 'WordPress error: too many requests', {
			retryable: true,
			status: 429,
		});
		assert.equal(apiError.errorCode, 'WP_API_ERROR');
		assert.equal(rateError.errorCode, 'WP_RATE_LIMITED');
	});

	it('maps WordPress rate limits to HTTP 429 with retryable=true', () => {
		const clientSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		assert.match(clientSource, /wpStatus === 429[\s\S]*errorStatus = 429/);
		assert.equal(httpStatusForWordpressErrorCode('WP_RATE_LIMITED'), 429);
		const error = createWordpressError('WP_RATE_LIMITED', 'WordPress error: too many requests', {
			retryable: true,
			status: 429,
		});
		assert.equal(error.errorCode, 'WP_RATE_LIMITED');
		assert.equal(error.status, 429);
		assert.equal(error.retryable, true);
		const body = toWordpressApiErrorBody(error);
		assert.equal(body.errorCode, 'WP_RATE_LIMITED');
		assert.equal(body.retryable, true);
	});

	it('falls back unknown errors to WP_UNKNOWN_ERROR', () => {
		assert.equal(extractWordpressErrorCode(new Error('boom')), 'WP_UNKNOWN_ERROR');
		const error = createWordpressError('WP_UNKNOWN_ERROR', 'Unexpected failure');
		assert.equal(error.errorCode, 'WP_UNKNOWN_ERROR');
	});

	it('derives codes from error.errorCode rather than message text', () => {
		const error = new Error('completely different human text');
		error.errorCode = 'WP_CAPABILITY_DENIED';
		assert.equal(extractWordpressErrorCode(error), 'WP_CAPABILITY_DENIED');
	});

	it('persists and resolves publish job failure codes from payload', () => {
		const payload = withPublishJobFailurePayload({ updatePostId: 12 }, {
			errorCode: 'WP_CAPABILITY_DENIED',
			message: 'denied',
		});
		assert.equal(payload.lastErrorCode, 'WP_CAPABILITY_DENIED');
		assert.equal(payload.updatePostId, 12);
		const job = { last_error: 'denied', payload };
		const failure = createPublishJobFailureError(job);
		assert.equal(failure.errorCode, 'WP_CAPABILITY_DENIED');
		assert.equal(failure.status, 403);
		assert.equal(failure.authFailed, false);
		assert.equal(resolvePublishJobErrorCode(job), 'WP_CAPABILITY_DENIED');
	});

	it('waitForJobResult uses structured publish job error codes (source)', () => {
		const routes = readFileSync(path.join(root, 'apps/api/src/routes/wordpress/index.js'), 'utf8');
		assert.match(routes, /createPublishJobFailureError\(job\)/);
		assert.doesNotMatch(routes, /error\.errorCode = 'WP_PUBLISH_FAILED'/);
	});

	it('failOrRetry stores lastErrorCode on publish job payload (source)', () => {
		const queueSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		assert.match(queueSource, /withPublishJobFailurePayload\(job\.payload, error\)/);
		assert.match(queueSource, /payload: failurePayload/);
	});

	it('sanitizes secrets from returned error messages', () => {
		const safe = sanitizeWordpressErrorMessage('Authorization: Bearer abc.def.ghi failed');
		assert.doesNotMatch(safe, /Bearer abc/i);
		assert.match(safe, /\[redacted\]/);
		const body = toWordpressApiErrorBody(createWordpressError(
			'WP_AUTH_FAILED',
			'Authorization: Basic dXNlcjpwYXNz',
		));
		assert.doesNotMatch(body.message, /Basic dXNlcjpwYXNz/);
		assert.equal(body.errorCode, 'WP_AUTH_FAILED');
		assert.equal(body.authFailed, true);
	});

	it('P1-7 draft-only capability codes remain WP_CAPABILITY_DENIED (source)', () => {
		const clientSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		assert.match(clientSource, /WORDPRESS_ERROR_CODES\.WP_CAPABILITY_DENIED/);
		assert.match(clientSource, /assertWordpressConnectionCapabilities/);
		assert.match(clientSource, /assertWordpressStatusAllowed/);
	});

	it('P1-6 retry idempotency remains unchanged (source)', () => {
		const queueSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		assert.match(queueSource, /persistWordpressPostIdentity/);
		assert.match(queueSource, /resolveWordpressUpdatePostId/);
	});

	it('P1-5 workspace scoping remains unchanged (source)', () => {
		const publishSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(publishSource, /resolvePublishSite\([\s\S]*req: ctx\.req/);
		assert.match(publishSource, /loadOwnedPublishJob/);
	});

	it('P1-4 enqueue workspace scope remains unchanged (source)', () => {
		const publishSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(publishSource, /req:\s*ctx\.req/);
	});

	it('normalizes legacy persisted error codes to canonical codes', () => {
		assert.equal(normalizeWordpressErrorCode('WP_UNREACHABLE'), 'WP_CONNECTION_FAILED');
		assert.equal(normalizeWordpressErrorCode('WP_REQUEST_FAILED'), 'WP_API_ERROR');
		assert.equal(normalizeWordpressErrorCode('MEDIA_UPLOAD_FAILED'), 'WP_MEDIA_UPLOAD_FAILED');
		assert.equal(normalizeWordpressErrorCode('MEDIA_DOWNLOAD_FAILED'), 'WP_MEDIA_DOWNLOAD_FAILED');
		assert.equal(normalizeWordpressErrorCode('WP_MEDIA_ERROR'), 'WP_MEDIA_ERROR');
		assert.equal(normalizeWordpressErrorCode('WP_AUTH_FAILED'), 'WP_AUTH_FAILED');
		const job = {
			last_error: 'unreachable',
			payload: { lastErrorCode: 'WP_UNREACHABLE' },
		};
		assert.equal(resolvePublishJobErrorCode(job), 'WP_CONNECTION_FAILED');
		assert.equal(Object.keys(LEGACY_WORDPRESS_ERROR_CODE_ALIASES).length, 5);
	});

	it('respondWordpressApiError returns structured errors without stack traces or secrets', () => {
		const cases = [
			{
				error: createWordpressError('WP_AUTH_FAILED', 'Authorization: Bearer secret-token', { status: 401 }),
				expectedStatus: 401,
				expectedCode: 'WP_AUTH_FAILED',
				expectAuthFailed: true,
			},
			{
				error: createWordpressError('WP_CAPABILITY_DENIED', 'Cannot publish', { status: 403, authFailed: false }),
				expectedStatus: 403,
				expectedCode: 'WP_CAPABILITY_DENIED',
				expectAuthFailed: false,
			},
			{
				error: createWordpressError('WP_NOT_FOUND', 'Missing post', { status: 404 }),
				expectedStatus: 404,
				expectedCode: 'WP_NOT_FOUND',
			},
			{
				error: createWordpressError('WP_CONNECTION_FAILED', 'ECONNRESET', { status: 502, retryable: true }),
				expectedStatus: 502,
				expectedCode: 'WP_CONNECTION_FAILED',
			},
		];

		for (const testCase of cases) {
			let statusCode = 0;
			let body = null;
			const res = {
				status(code) {
					statusCode = code;
					return this;
				},
				json(payload) {
					body = payload;
					return this;
				},
			};
			respondWordpressApiError(res, testCase.error);
			assert.equal(statusCode, testCase.expectedStatus, testCase.expectedCode);
			assert.equal(body.ok, false);
			assert.equal(body.errorCode, testCase.expectedCode);
			assert.ok(typeof body.message === 'string' && body.message.length > 0);
			assert.ok(!('stack' in body));
			assert.ok(!('error' in body));
			if (testCase.expectAuthFailed !== undefined) {
				assert.equal(body.authFailed, testCase.expectAuthFailed);
			}
		}
	});

	it('wordpress router registers centralized error serialization handler', () => {
		const routes = readFileSync(path.join(root, 'apps/api/src/routes/wordpress/index.js'), 'utf8');
		assert.match(routes, /router\.use\(\(err, req, res, next\)/);
		assert.match(routes, /respondWordpressApiError\(res, err\)/);
		assert.match(routes, /respondWordpressApiError\(res, error/);
		assert.match(routes, /createWordpressError\([\s\S]*VALIDATION_ERROR[\s\S]*scheduledAt is required/);
	});
});
