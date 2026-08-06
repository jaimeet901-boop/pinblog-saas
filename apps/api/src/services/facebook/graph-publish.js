/**
 * Facebook Channel Pack — Graph publish client (F4-1).
 * Feed POST only; no PocketBase, queue, or route dependencies.
 */

import { normalizeDestinationUrl } from '../../utils/pin-publish-destination.js';

export const FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v22.0';
export const FACEBOOK_GRAPH_BASE = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;

/** Graph error codes treated as rate limits (retryable). */
export const FACEBOOK_GRAPH_RATE_LIMIT_CODES = Object.freeze([4, 17, 32, 613]);

/** Graph error codes that indicate invalid/expired tokens (terminal for job, refresh account). */
export const FACEBOOK_GRAPH_TOKEN_ERROR_CODES = Object.freeze([190]);

/** Graph error codes for permission / capability failures (terminal). */
export const FACEBOOK_GRAPH_PERMISSION_ERROR_CODES = Object.freeze([10, 200]);

function graphPublishError(status, message, extras = {}) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = extras.errorCode || 'FACEBOOK_GRAPH_PUBLISH_ERROR';
	if (extras.retryable != null) error.retryable = extras.retryable;
	if (extras.graphCode != null) error.graphCode = extras.graphCode;
	if (extras.graphSubcode != null) error.graphSubcode = extras.graphSubcode;
	if (extras.tokenExpired != null) error.tokenExpired = extras.tokenExpired;
	if (extras.rateLimitRetryAfterMs != null) error.rateLimitRetryAfterMs = extras.rateLimitRetryAfterMs;
	if (extras.raw != null) error.raw = extras.raw;
	return error;
}

/**
 * True when a persisted Facebook post id is already present (worker idempotency gate).
 *
 * @param {unknown} value
 */
export function hasExistingFacebookPostId(value) {
	return Boolean(String(value ?? '').trim());
}

/**
 * Build URL-encoded feed POST body for Graph `/{page-id}/feed`.
 * At least one of message, link, or picture is required by Graph.
 *
 * @param {{ message?: string, linkUrl?: string, imageUrl?: string }} input
 */
export function buildFacebookFeedPostBody(input = {}) {
	const message = String(input.message ?? '').trim();
	const link = input.linkUrl ? normalizeDestinationUrl(String(input.linkUrl).trim()) : '';
	const picture = input.imageUrl ? normalizeDestinationUrl(String(input.imageUrl).trim()) : '';

	const body = {};
	if (message) body.message = message;
	if (link) body.link = link;
	if (picture) body.picture = picture;

	if (!body.message && !body.link && !body.picture) {
		throw graphPublishError(
			422,
			'Facebook feed post requires message, link, or image URL',
			{ errorCode: 'FACEBOOK_FEED_PAYLOAD_EMPTY', retryable: false },
		);
	}

	return body;
}

/**
 * Derive a public permalink from a Graph post id.
 *
 * @param {string} postId Graph-returned post id (often `{pageId}_{storyId}`)
 * @param {string} [pageId] Meta page id (optional fallback for URL building)
 */
export function resolveFacebookPostPublicUrl(postId, pageId = '') {
	const id = String(postId || '').trim();
	if (!id) return '';
	if (id.includes('_')) {
		return `https://www.facebook.com/${id}`;
	}
	const page = String(pageId || '').trim();
	if (page) {
		return `https://www.facebook.com/${page}/posts/${id}`;
	}
	return `https://www.facebook.com/${id}`;
}

/**
 * Redact token-like substrings from Graph error payloads before persistence/logging.
 *
 * @param {unknown} payload
 */
export function sanitizeFacebookGraphErrorPayload(payload) {
	try {
		const text = JSON.stringify(payload);
		const redacted = text
			.replace(/access_token=[^&"\s]+/gi, 'access_token=[REDACTED]')
			.replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[REDACTED]"')
			.replace(/EAAG[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]');
		return JSON.parse(redacted);
	} catch {
		return { message: 'Graph error payload could not be sanitized' };
	}
}

function parseRetryAfterMs(response) {
	const header = response?.headers?.get?.('retry-after');
	if (!header) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.round(seconds * 1000);
	}
	const dateMs = Date.parse(header);
	return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

function classifyGraphError({ httpStatus, graphError, retryAfterMs }) {
	const code = Number(graphError?.code);
	const subcode = graphError?.error_subcode != null ? Number(graphError.error_subcode) : null;
	const message = String(graphError?.message || `Facebook Graph error (${httpStatus})`).trim();

	if (FACEBOOK_GRAPH_TOKEN_ERROR_CODES.includes(code)) {
		return {
			status: httpStatus === 401 ? 401 : 422,
			message,
			retryable: false,
			tokenExpired: true,
			errorCode: 'FACEBOOK_TOKEN_EXPIRED',
			graphCode: code,
			graphSubcode: subcode,
		};
	}

	if (FACEBOOK_GRAPH_PERMISSION_ERROR_CODES.includes(code)) {
		return {
			status: 403,
			message,
			retryable: false,
			errorCode: 'FACEBOOK_GRAPH_PERMISSION_DENIED',
			graphCode: code,
			graphSubcode: subcode,
		};
	}

	if (code === 100) {
		return {
			status: 422,
			message,
			retryable: false,
			errorCode: 'FACEBOOK_GRAPH_INVALID_PARAMETER',
			graphCode: code,
			graphSubcode: subcode,
		};
	}

	const rateLimited = httpStatus === 429 || FACEBOOK_GRAPH_RATE_LIMIT_CODES.includes(code);
	if (rateLimited) {
		return {
			status: 429,
			message,
			retryable: true,
			errorCode: 'FACEBOOK_GRAPH_RATE_LIMITED',
			graphCode: code,
			graphSubcode: subcode,
			rateLimitRetryAfterMs: retryAfterMs,
		};
	}

	if (httpStatus >= 500) {
		return {
			status: 502,
			message,
			retryable: true,
			errorCode: 'FACEBOOK_GRAPH_SERVER_ERROR',
			graphCode: Number.isFinite(code) ? code : undefined,
			graphSubcode: subcode,
		};
	}

	return {
		status: httpStatus >= 400 ? httpStatus : 502,
		message,
		retryable: false,
		errorCode: 'FACEBOOK_GRAPH_PUBLISH_ERROR',
		graphCode: Number.isFinite(code) ? code : undefined,
		graphSubcode: subcode,
	};
}

/**
 * Normalize fetch/Graph failures for queue retry decisions.
 * Preserves original message; adds retryable + graph metadata.
 *
 * @param {unknown} error
 * @param {{ response?: Response, payload?: object }} [context]
 */
export function normalizeFacebookGraphError(error, context = {}) {
	if (!error) {
		return graphPublishError(502, 'Facebook Graph request failed', { retryable: true });
	}

	if (error.graphCode != null || error.retryable != null) {
		return error;
	}

	const payload = context.payload || error.raw || {};
	const graphError = payload?.error && typeof payload.error === 'object' ? payload.error : null;
	const httpStatus = Number(context.response?.status || error.status || 502);
	const retryAfterMs = parseRetryAfterMs(context.response);

	if (graphError) {
		const classified = classifyGraphError({ httpStatus, graphError, retryAfterMs });
		const normalized = graphPublishError(classified.status, classified.message, {
			retryable: classified.retryable,
			errorCode: classified.errorCode,
			graphCode: classified.graphCode,
			graphSubcode: classified.graphSubcode,
			tokenExpired: classified.tokenExpired,
			rateLimitRetryAfterMs: classified.rateLimitRetryAfterMs,
			raw: sanitizeFacebookGraphErrorPayload(payload),
		});
		return normalized;
	}

	if (httpStatus === 429) {
		return graphPublishError(httpStatus, error.message || 'Facebook rate limit exceeded', {
			retryable: true,
			errorCode: 'FACEBOOK_GRAPH_RATE_LIMITED',
			rateLimitRetryAfterMs: retryAfterMs,
		});
	}

	if (httpStatus >= 500) {
		return graphPublishError(502, error.message || 'Facebook Graph server error', {
			retryable: true,
			errorCode: 'FACEBOOK_GRAPH_SERVER_ERROR',
		});
	}

	return graphPublishError(
		httpStatus >= 400 ? httpStatus : 502,
		error.message || 'Facebook Graph publish failed',
		{ retryable: false },
	);
}

/**
 * POST `/{page-id}/feed` to publish a Page feed post.
 *
 * @param {{
 *   pageId: string,
 *   accessToken: string,
 *   message?: string,
 *   linkUrl?: string,
 *   imageUrl?: string,
 *   fetchImpl?: typeof fetch,
 * }} input
 * @returns {Promise<{ postId: string, postUrl: string, raw: object }>}
 */
export async function publishFacebookFeedPost(input = {}) {
	const pageId = String(input.pageId || '').trim();
	const accessToken = String(input.accessToken || '').trim();
	if (!pageId) {
		throw graphPublishError(422, 'Facebook Page id is required', {
			errorCode: 'FACEBOOK_PAGE_ID_REQUIRED',
			retryable: false,
		});
	}
	if (!accessToken) {
		throw graphPublishError(422, 'Facebook Page access token is required', {
			errorCode: 'FACEBOOK_PAGE_TOKEN_REQUIRED',
			retryable: false,
		});
	}

	const bodyFields = buildFacebookFeedPostBody({
		message: input.message,
		linkUrl: input.linkUrl,
		imageUrl: input.imageUrl,
	});

	const fetchImpl = input.fetchImpl || globalThis.fetch;
	const url = `${FACEBOOK_GRAPH_BASE}/${encodeURIComponent(pageId)}/feed`;
	const body = new URLSearchParams({
		...bodyFields,
		access_token: accessToken,
	});

	let response;
	try {
		response = await fetchImpl(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});
	} catch (error) {
		throw normalizeFacebookGraphError(error);
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload?.error) {
		throw normalizeFacebookGraphError(
			graphPublishError(response.status || 502, payload?.error?.message || 'Facebook Graph publish failed'),
			{ response, payload },
		);
	}

	const postId = String(payload?.id || '').trim();
	if (!postId) {
		throw graphPublishError(502, 'Facebook Graph publish succeeded but returned no post id', {
			retryable: false,
			errorCode: 'FACEBOOK_GRAPH_MISSING_POST_ID',
			raw: sanitizeFacebookGraphErrorPayload(payload),
		});
	}

	return {
		postId,
		postUrl: resolveFacebookPostPublicUrl(postId, pageId),
		raw: payload,
	};
}
