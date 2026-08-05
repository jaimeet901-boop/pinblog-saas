/**
 * Pure Pinterest OAuth frontend base URL resolution (no PocketBase / I/O).
 */

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export function isPlaceholderWebUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return true;
	if (/your-domain\.com|example\.com/i.test(raw)) return true;
	try {
		const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
		return !host
			|| host === 'your-domain.com'
			|| host.endsWith('.your-domain.com')
			|| host === 'example.com'
			|| host.endsWith('.example.com');
	} catch {
		return true;
	}
}

export function normalizeWebAppBase(value) {
	return String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
}

export function deriveWebAppBaseFromApiUrl(env = process.env) {
	const candidates = [
		env.API_PUBLIC_URL,
		env.PINTEREST_REDIRECT_URI,
	];
	for (const candidate of candidates) {
		const raw = normalizeWebAppBase(candidate);
		if (!raw || isPlaceholderWebUrl(raw)) continue;
		try {
			return new URL(raw.includes('://') ? raw : `https://${raw}`).origin;
		} catch {
			// keep looking
		}
	}
	return '';
}

export function collectEnvWebAppCandidates(env = process.env) {
	return [
		env.WEB_APP_URL,
		env.APP_WEB_URL,
		env.PUBLIC_APP_URL,
		env.APP_PUBLIC_URL,
		...(String(env.CORS_ORIGIN || '').split(',')),
		deriveWebAppBaseFromApiUrl(env),
	]
		.map(normalizeWebAppBase)
		.filter(Boolean);
}

export function firstValidWebAppOrigin(candidates = []) {
	for (const candidate of candidates) {
		if (!candidate || isPlaceholderWebUrl(candidate)) continue;
		try {
			return new URL(candidate.includes('://') ? candidate : `https://${candidate}`).origin;
		} catch {
			// keep looking
		}
	}
	return '';
}

export function resolveWebAppBaseFromEnv(env = process.env) {
	return firstValidWebAppOrigin(collectEnvWebAppCandidates(env));
}

export function resolveWebAppBaseFromIdentity(identity = {}) {
	return firstValidWebAppOrigin([
		identity?.appUrl,
		identity?.canonicalUrl,
		identity?.primaryDomain
			? `https://${String(identity.primaryDomain).replace(/^https?:\/\//i, '')}`
			: '',
	]);
}

/**
 * Finalize base URL after env + platform identity. Production never falls back to a hardcoded domain.
 */
export function finalizePinterestOAuthWebAppBase(nodeEnv = process.env.NODE_ENV) {
	if (String(nodeEnv || '').toLowerCase() === 'production') {
		throw httpError(
			503,
			'Pinterest OAuth frontend URL is not configured. Set WEB_APP_URL or platform identity domains.appUrl.',
			'PINTEREST_OAUTH_FRONTEND_UNCONFIGURED',
		);
	}
	return 'http://localhost:3000';
}

export function buildPinterestOAuthRedirectUrl(base, query = {}) {
	const origin = String(base || '').trim();
	if (!origin || isPlaceholderWebUrl(origin)) {
		throw httpError(
			503,
			'Pinterest OAuth frontend URL is not configured. Set WEB_APP_URL or platform identity domains.appUrl.',
			'PINTEREST_OAUTH_FRONTEND_UNCONFIGURED',
		);
	}

	const url = new URL('/app/pinterest', origin.endsWith('/') ? origin : `${origin}/`);
	for (const [key, value] of Object.entries(query || {})) {
		if (value == null || value === '') continue;
		url.searchParams.set(key, String(value));
	}

	const href = url.toString();
	if (/your-domain\.com/i.test(href)) {
		throw httpError(
			503,
			'Pinterest OAuth frontend URL is not configured. Set WEB_APP_URL or platform identity domains.appUrl.',
			'PINTEREST_OAUTH_FRONTEND_UNCONFIGURED',
		);
	}
	return href;
}
