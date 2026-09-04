/**
 * P1-9 — WordPress media error taxonomy.
 * Run: node --test src/services/wordpress-media-errors.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
	createMediaDownloadError,
	createMediaDownloadHttpError,
	createMediaUploadNetworkError,
	normalizeWordpressErrorCode,
	refineMediaUploadRestError,
	respondWordpressApiError,
	sanitizeWordpressErrorMessage,
	toWordpressApiErrorBody,
	WORDPRESS_ERROR_CODES,
} from './wordpress-errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');

function readServiceSource(filename) {
	const local = path.join(here, filename);
	try {
		return readFileSync(local, 'utf8');
	} catch {
		return readFileSync(path.join(root, 'apps/api/src/services', filename), 'utf8');
	}
}

describe('wordpress media error taxonomy (P1-9)', () => {
	it('classifies SSRF/validation download failures as VALIDATION_ERROR', () => {
		const error = createMediaDownloadError({
			status: 422,
			errorCode: 'SSRF_BLOCKED',
			message: 'featured_image_url host is not allowed',
		});
		assert.equal(error.errorCode, 'VALIDATION_ERROR');
		assert.equal(error.status, 422);
		assert.equal(error.retryable, false);
	});

	it('classifies source image 404 as WP_NOT_FOUND', () => {
		const fromError = createMediaDownloadError({
			status: 404,
			message: 'Featured image not found',
		});
		const fromStatus = createMediaDownloadHttpError(404);
		assert.equal(fromError.errorCode, 'WP_NOT_FOUND');
		assert.equal(fromError.status, 404);
		assert.equal(fromError.retryable, false);
		assert.equal(fromStatus.errorCode, 'WP_NOT_FOUND');
	});

	it('classifies source image 429 as WP_RATE_LIMITED with retryable=true', () => {
		const error = createMediaDownloadHttpError(429);
		assert.equal(error.errorCode, 'WP_RATE_LIMITED');
		assert.equal(error.status, 429);
		assert.equal(error.retryable, true);
	});

	it('classifies source image 5xx as WP_MEDIA_DOWNLOAD_FAILED with retryable=true', () => {
		const error = createMediaDownloadHttpError(503);
		assert.equal(error.errorCode, 'WP_MEDIA_DOWNLOAD_FAILED');
		assert.equal(error.status, 503);
		assert.equal(error.retryable, true);
	});

	it('classifies source image 403 as WP_MEDIA_DOWNLOAD_FAILED without retry', () => {
		const error = createMediaDownloadHttpError(403);
		assert.equal(error.errorCode, 'WP_MEDIA_DOWNLOAD_FAILED');
		assert.equal(error.status, 403);
		assert.equal(error.retryable, false);
	});

	it('classifies featured image network failures as WP_MEDIA_DOWNLOAD_FAILED', () => {
		const error = createMediaDownloadError(new Error('ECONNRESET'));
		assert.equal(error.errorCode, 'WP_MEDIA_DOWNLOAD_FAILED');
		assert.equal(error.retryable, true);
		assert.equal(error.status, 502);
	});

	it('classifies WordPress media upload network failures as WP_CONNECTION_FAILED', () => {
		const error = createMediaUploadNetworkError(new Error('ECONNREFUSED'));
		assert.equal(error.errorCode, 'WP_CONNECTION_FAILED');
		assert.equal(error.retryable, true);
		assert.equal(error.status, 502);
	});

	it('refines generic media upload REST failures to WP_MEDIA_UPLOAD_FAILED', () => {
		const generic = {
			errorCode: WORDPRESS_ERROR_CODES.WP_API_ERROR,
			message: 'WordPress error: invalid media',
			status: 502,
			retryable: false,
		};
		const refined = refineMediaUploadRestError(generic);
		assert.equal(refined.errorCode, 'WP_MEDIA_UPLOAD_FAILED');
	});

	it('preserves auth/capability/rate-limit codes from media upload REST failures', () => {
		for (const code of [
			'WP_AUTH_FAILED',
			'WP_CAPABILITY_DENIED',
			'WP_RATE_LIMITED',
			'WP_NOT_FOUND',
		]) {
			const error = { errorCode: code, message: 'test', status: 403 };
			assert.equal(refineMediaUploadRestError(error).errorCode, code);
		}
	});

	it('uploadWordpressMedia uses structured media classifiers (source)', () => {
		const source = readServiceSource('wordpress-client.js');
		assert.match(source, /createMediaDownloadError\(err\)/);
		assert.match(source, /createMediaDownloadHttpError/);
		assert.match(source, /createMediaUploadNetworkError\(err\)/);
		assert.match(source, /refineMediaUploadRestError\(buildWordpressRestFailure/);
		assert.match(source, /loadImageBytesForWordpressUpload/);
		assert.doesNotMatch(source, /WORDPRESS_ERROR_CODES\.WP_MEDIA_ERROR/);
	});

	it('publish queue preserves classified retryable semantics (source)', () => {
		const source = readServiceSource('wordpress-publish-queue.js');
		assert.match(source, /if \(error\.retryable === undefined\) error\.retryable = true/);
	});

	it('normalizes legacy media codes to new canonical codes', () => {
		assert.equal(normalizeWordpressErrorCode('MEDIA_UPLOAD_FAILED'), 'WP_MEDIA_UPLOAD_FAILED');
		assert.equal(normalizeWordpressErrorCode('MEDIA_DOWNLOAD_FAILED'), 'WP_MEDIA_DOWNLOAD_FAILED');
		assert.equal(normalizeWordpressErrorCode('WP_MEDIA_ERROR'), 'WP_MEDIA_ERROR');
	});

	it('sanitizes media error responses and omits stack traces', () => {
		const error = createMediaDownloadError(new Error('Authorization: Bearer leaked-token'));
		const body = toWordpressApiErrorBody(error);
		assert.doesNotMatch(body.message, /Bearer leaked-token/i);
		assert.ok(!('stack' in body));
		assert.equal(body.ok, false);
	});

	it('respondWordpressApiError serializes capability-denied media upload errors correctly', () => {
		const error = {
			errorCode: 'WP_CAPABILITY_DENIED',
			message: 'WordPress error: rest_cannot_create',
			status: 403,
			authFailed: false,
			retryable: false,
		};
		let statusCode = 0;
		let body = null;
		respondWordpressApiError({
			status(code) {
				statusCode = code;
				return this;
			},
			json(payload) {
				body = payload;
				return this;
			},
		}, error);
		assert.equal(statusCode, 403);
		assert.equal(body.errorCode, 'WP_CAPABILITY_DENIED');
		assert.equal(body.authFailed, false);
		assert.equal(body.retryable, false);
		assert.doesNotMatch(sanitizeWordpressErrorMessage(body.message), /authorization/i);
	});

	it('P1-8 centralized route serialization remains intact (source)', () => {
		const routesPath = path.join(here, '../routes/wordpress/index.js');
		const routes = readFileSync(routesPath, 'utf8');
		assert.match(routes, /respondWordpressApiError\(res, err\)/);
	});

	it('P1-7 draft-only capability behavior remains intact (source)', () => {
		const source = readServiceSource('wordpress-client.js');
		assert.match(source, /assertWordpressStatusAllowed/);
		assert.match(source, /WP_CAPABILITY_DENIED/);
	});

	it('P1-6 retry idempotency remains intact (source)', () => {
		const source = readServiceSource('wordpress-publish-queue.js');
		assert.match(source, /persistWordpressPostIdentity/);
	});

	it('P1-5 workspace scoping remains intact (source)', () => {
		const publish = readServiceSource('wordpress-publish.js');
		assert.match(publish, /loadOwnedPublishJob/);
	});

	it('P1-4 enqueue workspace scope remains intact (source)', () => {
		const publish = readServiceSource('wordpress-publish.js');
		assert.match(publish, /req:\s*ctx\.req/);
	});
});
