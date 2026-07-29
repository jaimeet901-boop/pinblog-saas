/**
 * Provider-agnostic text-provider error classification.
 * Decisions use HTTP status + normalized category patterns only —
 * never provider product names (Gemini, OpenAI, Claude, etc.).
 */

/** @typedef {'timeout'|'rate_limit'|'http_503'|'http_504'|'provider_unavailable'|'network_error'|'auth_failure'|'invalid_config'|'billing'|'cancelled'|'permanent_error'} TextProviderErrorCategory */

export const TEXT_PROVIDER_ERROR_CATEGORY = Object.freeze({
	TIMEOUT: 'timeout',
	RATE_LIMIT: 'rate_limit',
	HTTP_503: 'http_503',
	HTTP_504: 'http_504',
	PROVIDER_UNAVAILABLE: 'provider_unavailable',
	NETWORK: 'network_error',
	AUTH: 'auth_failure',
	INVALID_CONFIG: 'invalid_config',
	BILLING: 'billing',
	CANCELLED: 'cancelled',
	PERMANENT: 'permanent_error',
});

/**
 * @param {unknown} error
 * @returns {{ temporary: boolean, category: TextProviderErrorCategory, status: number }}
 */
export function classifyTextProviderError(error) {
	const status = Number(
		error?.status
		|| error?.statusCode
		|| error?.response?.status
		|| 0,
	);
	const code = String(error?.code || error?.errorCode || '').toUpperCase();
	const message = String(error?.message || error?.error || error || '');

	if (code === 'CANCELLED' || /^\s*abort/i.test(message) || /\bcancel(?:led)?\b/i.test(message)) {
		return { temporary: false, category: TEXT_PROVIDER_ERROR_CATEGORY.CANCELLED, status };
	}

	// Permanent: credentials / auth
	if (
		status === 401
		|| status === 403
		|| code.includes('UNAUTH')
		|| code.includes('FORBIDDEN')
		|| /unauthorized|forbidden|authentication(?:\s+failed)?|invalid(?:\s+|_)?(?:api[_\s-]?key|credential)|api[_\s-]?key.*(?:invalid|missing|required)/i.test(message)
	) {
		return { temporary: false, category: TEXT_PROVIDER_ERROR_CATEGORY.AUTH, status };
	}

	// Permanent: misconfiguration / bad request targeting setup
	if (
		status === 400
		|| status === 404
		|| code.includes('NOT_CONFIGURED')
		|| code.includes('PROVIDER_NOT')
		|| code.includes('INVALID_MODEL')
		|| /invalid(?:\s+|_)?model|model(?:\s+|_)?not(?:\s+|_)?found|not(?:\s+|_)?configured|unknown(?:\s+|_)?model|unsupported(?:\s+|_)?model/i.test(message)
	) {
		return { temporary: false, category: TEXT_PROVIDER_ERROR_CATEGORY.INVALID_CONFIG, status };
	}

	// Permanent: billing / payment required (operator action needed)
	if (status === 402 || /payment(?:\s+|_)?required|billing(?:\s+|_)?(?:error|required|issue)/i.test(message)) {
		return { temporary: false, category: TEXT_PROVIDER_ERROR_CATEGORY.BILLING, status };
	}

	// Temporary: explicit HTTP statuses
	if (status === 429) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.RATE_LIMIT, status };
	}
	if (status === 503) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.HTTP_503, status };
	}
	if (status === 504) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.HTTP_504, status };
	}
	if (status === 502) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.PROVIDER_UNAVAILABLE, status };
	}

	// Temporary: normalized message categories (provider-agnostic)
	if (/timed?\s*out|timeout|etimedout|deadline(?:\s+exceeded)?/i.test(message)) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.TIMEOUT, status };
	}
	if (/rate\s*-?\s*limit|too many requests|\b429\b/i.test(message)) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.RATE_LIMIT, status };
	}
	if (/\b504\b/i.test(message)) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.HTTP_504, status };
	}
	if (/\b503\b/i.test(message)) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.HTTP_503, status };
	}
	if (
		/\b502\b|overloaded|high demand|capacity|resource(?:\s*|_)exhausted|try again later|service unavailable|temporarily unavailable|provider(?:\s+|_)?(?:unavailable|down)/i.test(message)
	) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.PROVIDER_UNAVAILABLE, status };
	}
	if (/network|econnreset|econnrefused|fetch failed/i.test(message)) {
		return { temporary: true, category: TEXT_PROVIDER_ERROR_CATEGORY.NETWORK, status };
	}

	return { temporary: false, category: TEXT_PROVIDER_ERROR_CATEGORY.PERMANENT, status };
}

export function isTemporaryTextProviderError(error) {
	return classifyTextProviderError(error).temporary;
}
