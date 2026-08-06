/**
 * Facebook Channel Pack — post Insights fetch + metric normalization (F7-4).
 * Read-only Graph client; no PocketBase or worker dependencies.
 */

import {
	FACEBOOK_GRAPH_BASE,
	normalizeFacebookGraphError,
	sanitizeFacebookGraphErrorPayload,
} from './graph-publish.js';

/** Graph post insight metrics requested for published feed posts. */
export const FACEBOOK_POST_INSIGHT_METRICS = Object.freeze([
	'post_impressions',
	'post_engaged_users',
	'post_clicks',
	'post_reactions_by_type_total',
]);

function graphInsightsError(status, message, extras = {}) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = extras.errorCode || 'FACEBOOK_GRAPH_INSIGHTS_ERROR';
	if (extras.retryable != null) error.retryable = extras.retryable;
	if (extras.graphCode != null) error.graphCode = extras.graphCode;
	if (extras.graphSubcode != null) error.graphSubcode = extras.graphSubcode;
	if (extras.tokenExpired != null) error.tokenExpired = extras.tokenExpired;
	if (extras.rateLimitRetryAfterMs != null) error.rateLimitRetryAfterMs = extras.rateLimitRetryAfterMs;
	if (extras.raw != null) error.raw = extras.raw;
	return error;
}

function coerceMetricNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function sumReactionMetric(value) {
	if (typeof value === 'number') {
		return coerceMetricNumber(value);
	}
	if (!value || typeof value !== 'object') {
		return null;
	}

	let total = 0;
	let found = false;
	for (const entry of Object.values(value)) {
		const parsed = Number(entry);
		if (Number.isFinite(parsed)) {
			total += parsed;
			found = true;
		}
	}
	return found ? total : null;
}

/**
 * Normalize Graph `/{post-id}/insights` payload into job performance fields.
 *
 * @param {object} payload
 * @returns {{ impressions: number|null, engagedUsers: number|null, clicks: number|null, reactions: number|null }}
 */
export function extractFacebookPostInsightsMetrics(payload) {
	const metrics = {
		impressions: null,
		engagedUsers: null,
		clicks: null,
		reactions: null,
	};

	const entries = Array.isArray(payload?.data) ? payload.data : [];
	for (const entry of entries) {
		const name = String(entry?.name || '').trim();
		const value = entry?.values?.[0]?.value;
		if (name === 'post_impressions') {
			metrics.impressions = coerceMetricNumber(value);
		} else if (name === 'post_engaged_users') {
			metrics.engagedUsers = coerceMetricNumber(value);
		} else if (name === 'post_clicks') {
			metrics.clicks = coerceMetricNumber(value);
		} else if (name === 'post_reactions_by_type_total') {
			metrics.reactions = sumReactionMetric(value);
		}
	}

	return metrics;
}

/**
 * GET `/{post-id}/insights` for a published Facebook Page post.
 *
 * @param {{
 *   postId: string,
 *   accessToken: string,
 *   metrics?: string[],
 *   fetchImpl?: typeof fetch,
 * }} input
 * @returns {Promise<object>}
 */
export async function fetchFacebookPostInsights(input = {}) {
	const postId = String(input.postId || '').trim();
	const accessToken = String(input.accessToken || '').trim();
	const metrics = Array.isArray(input.metrics) && input.metrics.length
		? input.metrics
		: [...FACEBOOK_POST_INSIGHT_METRICS];

	if (!postId) {
		throw graphInsightsError(422, 'Facebook post id is required', {
			errorCode: 'FACEBOOK_POST_ID_REQUIRED',
			retryable: false,
		});
	}
	if (!accessToken) {
		throw graphInsightsError(422, 'Facebook Page access token is required', {
			errorCode: 'FACEBOOK_PAGE_TOKEN_REQUIRED',
			retryable: false,
		});
	}

	const url = new URL(`${FACEBOOK_GRAPH_BASE}/${encodeURIComponent(postId)}/insights`);
	url.searchParams.set('metric', metrics.join(','));
	url.searchParams.set('access_token', accessToken);

	const fetchImpl = input.fetchImpl || globalThis.fetch;
	let response;
	try {
		response = await fetchImpl(url.toString(), { method: 'GET' });
	} catch (error) {
		throw normalizeFacebookGraphError(error);
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload?.error) {
		throw normalizeFacebookGraphError(
			graphInsightsError(
				response.status || 502,
				payload?.error?.message || 'Facebook Graph insights request failed',
			),
			{ response, payload },
		);
	}

	return {
		...payload,
		raw: sanitizeFacebookGraphErrorPayload(payload),
	};
}
