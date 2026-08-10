/**
 * Central WordPress integration error codes and factory.
 * Codes are stable, machine-readable, and must not depend on message text.
 */

export const WORDPRESS_ERROR_CODES = Object.freeze({
	WP_AUTH_FAILED: 'WP_AUTH_FAILED',
	WP_CAPABILITY_DENIED: 'WP_CAPABILITY_DENIED',
	WP_NOT_FOUND: 'WP_NOT_FOUND',
	WP_FORBIDDEN: 'WP_FORBIDDEN',
	WP_HTTPS_REQUIRED: 'WP_HTTPS_REQUIRED',
	WP_REST_UNAVAILABLE: 'WP_REST_UNAVAILABLE',
	WP_CONNECTION_FAILED: 'WP_CONNECTION_FAILED',
	WP_API_ERROR: 'WP_API_ERROR',
	WP_RATE_LIMITED: 'WP_RATE_LIMITED',
	WP_MEDIA_ERROR: 'WP_MEDIA_ERROR',
	WP_PUBLISH_FAILED: 'WP_PUBLISH_FAILED',
	WP_UNKNOWN_ERROR: 'WP_UNKNOWN_ERROR',
	VALIDATION_ERROR: 'VALIDATION_ERROR',
});

/** Legacy codes kept for reading persisted job payloads; map to canonical codes. */
export const LEGACY_WORDPRESS_ERROR_CODE_ALIASES = Object.freeze({
	WP_UNREACHABLE: 'WP_CONNECTION_FAILED',
	WP_REQUEST_FAILED: 'WP_API_ERROR',
	MEDIA_UPLOAD_FAILED: 'WP_MEDIA_ERROR',
	MEDIA_DOWNLOAD_FAILED: 'WP_MEDIA_ERROR',
});

export function normalizeWordpressErrorCode(code) {
	const normalized = String(code || '').trim();
	if (!normalized) return WORDPRESS_ERROR_CODES.WP_UNKNOWN_ERROR;
	return LEGACY_WORDPRESS_ERROR_CODE_ALIASES[normalized] || normalized;
}

export function httpStatusForWordpressErrorCode(code) {
	switch (String(code || '')) {
		case WORDPRESS_ERROR_CODES.WP_AUTH_FAILED:
			return 401;
		case WORDPRESS_ERROR_CODES.WP_CAPABILITY_DENIED:
		case WORDPRESS_ERROR_CODES.WP_FORBIDDEN:
			return 403;
		case WORDPRESS_ERROR_CODES.WP_NOT_FOUND:
			return 404;
		case WORDPRESS_ERROR_CODES.WP_RATE_LIMITED:
			return 429;
		case WORDPRESS_ERROR_CODES.WP_HTTPS_REQUIRED:
		case WORDPRESS_ERROR_CODES.VALIDATION_ERROR:
			return 422;
		default:
			return 502;
	}
}

export function wordpressErrorHttpStatus(error) {
	if (Number.isInteger(error?.status)) return error.status;
	return httpStatusForWordpressErrorCode(normalizeWordpressErrorCode(extractWordpressErrorCode(error)));
}

export function authFailedForWordpressErrorCode(code) {
	if (code === WORDPRESS_ERROR_CODES.WP_AUTH_FAILED) return true;
	if (code === WORDPRESS_ERROR_CODES.WP_CAPABILITY_DENIED) return false;
	return undefined;
}

export function createWordpressError(code, message, options = {}) {
	const error = new Error(sanitizeWordpressErrorMessage(message));
	error.status = options.status ?? httpStatusForWordpressErrorCode(code);
	error.errorCode = String(code || WORDPRESS_ERROR_CODES.WP_UNKNOWN_ERROR);
	if (options.authFailed !== undefined) error.authFailed = options.authFailed;
	else {
		const derived = authFailedForWordpressErrorCode(error.errorCode);
		if (derived !== undefined) error.authFailed = derived;
	}
	if (options.retryable !== undefined) error.retryable = options.retryable;
	if (options.wpStatus !== undefined) error.wpStatus = options.wpStatus;
	if (options.wpCode !== undefined) error.wpCode = options.wpCode;
	return error;
}

export function extractWordpressErrorCode(error, fallback = WORDPRESS_ERROR_CODES.WP_UNKNOWN_ERROR) {
	const code = error?.errorCode;
	return normalizeWordpressErrorCode(code || fallback);
}

export function resolvePublishJobErrorCode(job) {
	const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
	const code = payload.lastErrorCode || payload.last_error_code;
	return code ? normalizeWordpressErrorCode(code) : WORDPRESS_ERROR_CODES.WP_UNKNOWN_ERROR;
}

export function withPublishJobFailurePayload(jobPayload, error) {
	const base = jobPayload && typeof jobPayload === 'object' ? jobPayload : {};
	return {
		...base,
		lastErrorCode: extractWordpressErrorCode(error),
	};
}

export function clearPublishJobFailurePayload(jobPayload) {
	const base = jobPayload && typeof jobPayload === 'object' ? { ...jobPayload } : {};
	delete base.lastErrorCode;
	delete base.last_error_code;
	return base;
}

const SECRET_PATTERNS = [
	/\bauthorization\s*[:=]\s*[^\s,]+/gi,
	/\bbearer\s+[a-z0-9._~+/=-]+/gi,
	/\bbasic\s+[a-z0-9+/=]+/gi,
	/\b(app[_-]?password|password|secret|token|ciphertext)\s*[:=]\s*[^\s,]+/gi,
];

export function sanitizeWordpressErrorMessage(message) {
	let safe = String(message || '').trim();
	for (const pattern of SECRET_PATTERNS) {
		safe = safe.replace(pattern, '[redacted]');
	}
	return safe || 'WordPress request failed';
}

export function toWordpressApiErrorBody(error, extra = {}) {
	const errorCode = extractWordpressErrorCode(error, WORDPRESS_ERROR_CODES.WP_PUBLISH_FAILED);
	const body = {
		ok: false,
		message: sanitizeWordpressErrorMessage(error?.message),
		errorCode,
		...extra,
	};
	const authFailed = error?.authFailed ?? authFailedForWordpressErrorCode(errorCode);
	if (authFailed !== undefined) body.authFailed = authFailed;
	if (error?.retryable !== undefined) body.retryable = error.retryable;
	return body;
}

export function respondWordpressApiError(res, error, extra = {}) {
	return res.status(wordpressErrorHttpStatus(error)).json(toWordpressApiErrorBody(error, extra));
}

export function createPublishJobFailureError(job) {
	const errorCode = resolvePublishJobErrorCode(job);
	return createWordpressError(
		errorCode,
		job?.last_error || 'WordPress publish failed',
		{ status: httpStatusForWordpressErrorCode(errorCode) },
	);
}
