/**
 * SSRF protection for server-side HTTP fetches to user-supplied URLs.
 * Blocks private networks, link-local, metadata endpoints, and non-http(s) schemes.
 */

const BLOCKED_HOSTNAMES = new Set([
	'localhost',
	'metadata.google.internal',
	'metadata.google',
	'metadata',
	'kubernetes.default.svc',
	'kubernetes.default',
]);

function normalizeHost(hostname) {
	return String(hostname || '')
		.trim()
		.toLowerCase()
		.replace(/^\[(.*)\]$/, '$1')
		.replace(/\.$/, '');
}

function parseIpv4(host) {
	const parts = host.split('.');
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => Number.parseInt(part, 10));
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return null;
	}
	return octets;
}

function isPrivateIpv4(host) {
	const octets = parseIpv4(host);
	if (!octets) return false;
	const [a, b] = octets;
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	return false;
}

function isPrivateIpv6(host) {
	const value = normalizeHost(host);
	if (!value.includes(':')) return false;
	if (value === '::1' || value === '::') return true;
	if (value.startsWith('fc') || value.startsWith('fd')) return true; // ULA
	if (value.startsWith('fe80:')) return true; // link-local
	return false;
}

export function isPrivateHostname(hostname) {
	const host = normalizeHost(hostname);
	if (!host) return true;
	if (BLOCKED_HOSTNAMES.has(host)) return true;
	if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
		return true;
	}
	if (host === '0.0.0.0' || host === '::1') return true;
	if (/^127\./.test(host)) return true;
	if (isPrivateIpv4(host) || isPrivateIpv6(host)) return true;
	return false;
}

function httpError(status, message, errorCode = 'SSRF_BLOCKED') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/**
 * Validate a URL is safe to fetch server-side. Returns normalized URL string.
 */
export function assertSafePublicHttpUrl(urlString, { fieldName = 'url' } = {}) {
	let parsed;
	try {
		parsed = new URL(String(urlString || '').trim());
	} catch {
		throw httpError(422, `${fieldName} must be a valid absolute URL`, 'INVALID_URL');
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw httpError(422, `${fieldName} must use http or https`, 'INVALID_URL_PROTOCOL');
	}

	if (isPrivateHostname(parsed.hostname)) {
		throw httpError(422, `${fieldName} host is not allowed`, 'SSRF_BLOCKED');
	}

	// Block credentials in URL (user:pass@host)
	if (parsed.username || parsed.password) {
		throw httpError(422, `${fieldName} must not include credentials`, 'INVALID_URL');
	}

	return parsed.toString();
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch with manual redirect handling; re-validates every hop.
 */
export async function safeFetch(urlString, options = {}) {
	const maxRedirects = Number.isFinite(options.maxRedirects) ? options.maxRedirects : 5;
	const {
		maxRedirects: _ignored,
		...fetchOptions
	} = options;

	let currentUrl = assertSafePublicHttpUrl(urlString, { fieldName: options.fieldName || 'url' });
	let redirects = 0;

	while (true) {
		const response = await fetch(currentUrl, {
			...fetchOptions,
			redirect: 'manual',
		});

		if (!REDIRECT_STATUSES.has(response.status)) {
			return { response, finalUrl: currentUrl };
		}

		if (redirects >= maxRedirects) {
			throw httpError(422, 'Too many redirects while fetching URL', 'SSRF_REDIRECT_LIMIT');
		}

		const location = response.headers.get('location');
		if (!location) {
			return { response, finalUrl: currentUrl };
		}

		currentUrl = assertSafePublicHttpUrl(new URL(location, currentUrl).toString(), {
			fieldName: options.fieldName || 'url',
		});
		redirects += 1;
	}
}
