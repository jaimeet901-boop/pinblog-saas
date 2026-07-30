/**
 * Billing Control Plane — Health Engine (BP-2).
 * Observation only. Never activates providers, never creates payments/checkouts.
 */

import { validateProvider } from './validation-engine.js';
import { decryptField, SECRET_FIELDS } from './control-plane-helpers.js';

export const HEALTH_STATUSES = Object.freeze([
	'Healthy',
	'Warning',
	'Critical',
	'Offline',
	'Unknown',
]);

const CONNECTIVITY_TIMEOUT_MS = 8000;

function secretOrEnv(code, raw, field, envKey) {
	return decryptField(raw, field) || process.env[envKey] || '';
}

/**
 * Deterministic health score 0–100 from validation + connectivity + config signals.
 */
export function calculateHealthScore({
	enabled = true,
	implemented = true,
	validationResult = 'FAIL',
	connectivityOk = null,
	hasPrimaryCredential = false,
	hasWebhookSecret = false,
	hasEnvironment = true,
	lastError = null,
} = {}) {
	if (!implemented) return 0;
	if (!enabled) return 15;

	let score = 0;

	// Configuration (40)
	if (hasPrimaryCredential) score += 25;
	if (hasWebhookSecret) score += 15;

	// Validation (30)
	const result = String(validationResult || '').toUpperCase();
	if (result === 'PASS') score += 30;
	else if (result === 'WARNING') score += 18;
	else if (result === 'FAIL') score += 0;
	else score += 5;

	// Connectivity (20) — null means not probed (neutral credit)
	if (connectivityOk === true) score += 20;
	else if (connectivityOk === null) score += 10;
	else score += 0;

	// Environment (5)
	if (hasEnvironment) score += 5;

	// Error penalty (5)
	if (!lastError) score += 5;

	return Math.max(0, Math.min(100, score));
}

export function deriveHealthStatus({
	enabled = true,
	implemented = true,
	validationResult = 'FAIL',
	healthScore = 0,
	connectivityOk = null,
	everChecked = false,
} = {}) {
	if (!implemented) return 'Offline';
	if (!enabled) return 'Offline';
	if (!everChecked) return 'Unknown';

	const result = String(validationResult || '').toUpperCase();
	if (result === 'FAIL' || connectivityOk === false || healthScore < 40) {
		return 'Critical';
	}
	if (result === 'WARNING' || healthScore < 70) {
		return 'Warning';
	}
	if (result === 'PASS' && healthScore >= 70) {
		return 'Healthy';
	}
	return 'Unknown';
}

function credentialFlags(code, raw = {}) {
	const secrets = SECRET_FIELDS[code] || [];
	const primary = secrets[0];
	const webhook = secrets.includes('webhookSecret') ? 'webhookSecret' : null;
	const envPrimary = {
		stripe: 'STRIPE_SECRET_KEY',
		paddle: 'PADDLE_API_KEY',
		lemonsqueezy: 'LEMONSQUEEZY_API_KEY',
	}[code];
	const envWebhook = {
		stripe: 'STRIPE_WEBHOOK_SECRET',
		paddle: 'PADDLE_WEBHOOK_SECRET',
		lemonsqueezy: 'LEMONSQUEEZY_WEBHOOK_SECRET',
	}[code];

	return {
		hasPrimaryCredential: Boolean(
			(primary && decryptField(raw, primary)) || (envPrimary && process.env[envPrimary]),
		),
		hasWebhookSecret: Boolean(
			(webhook && decryptField(raw, webhook)) || (envWebhook && process.env[envWebhook]),
		),
		hasEnvironment: raw.mode === 'live' || raw.mode === 'test' || raw.mode == null,
	};
}

/**
 * Lightweight read-only connectivity probe. Never creates checkout/payment objects.
 */
export async function probeProviderConnectivity(code, raw = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	if (normalized === 'paypal') {
		return {
			ok: false,
			skipped: false,
			message: 'PayPal is not implemented.',
			checkedAt: new Date().toISOString(),
		};
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);

	try {
		if (normalized === 'stripe') {
			const key = secretOrEnv('stripe', raw, 'secretKey', 'STRIPE_SECRET_KEY');
			if (!key) {
				return { ok: false, message: 'Stripe secret key missing.', checkedAt: new Date().toISOString() };
			}
			const response = await fetch('https://api.stripe.com/v1/balance', {
				method: 'GET',
				headers: { Authorization: `Bearer ${key}` },
				signal: controller.signal,
			});
			if (response.ok) {
				return { ok: true, message: 'Stripe API reachable.', checkedAt: new Date().toISOString() };
			}
			const status = response.status;
			return {
				ok: false,
				message: status === 401 || status === 403
					? 'Stripe credentials rejected by API.'
					: `Stripe API returned HTTP ${status}.`,
				checkedAt: new Date().toISOString(),
			};
		}

		if (normalized === 'paddle') {
			const key = secretOrEnv('paddle', raw, 'apiKey', 'PADDLE_API_KEY');
			if (!key) {
				return { ok: false, message: 'Paddle API key missing.', checkedAt: new Date().toISOString() };
			}
			const sandbox = raw.sandbox === true || process.env.PADDLE_SANDBOX === '1';
			const base = sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
			const response = await fetch(`${base}/event-types`, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${key}`,
					'Paddle-Version': '1',
				},
				signal: controller.signal,
			});
			if (response.ok) {
				return { ok: true, message: 'Paddle API reachable.', checkedAt: new Date().toISOString() };
			}
			return {
				ok: false,
				message: `Paddle API returned HTTP ${response.status}.`,
				checkedAt: new Date().toISOString(),
			};
		}

		if (normalized === 'lemonsqueezy') {
			const key = secretOrEnv('lemonsqueezy', raw, 'apiKey', 'LEMONSQUEEZY_API_KEY');
			if (!key) {
				return { ok: false, message: 'Lemon Squeezy API key missing.', checkedAt: new Date().toISOString() };
			}
			const response = await fetch('https://api.lemonsqueezy.com/v1/users/me', {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${key}`,
					Accept: 'application/vnd.api+json',
				},
				signal: controller.signal,
			});
			if (response.ok) {
				return { ok: true, message: 'Lemon Squeezy API reachable.', checkedAt: new Date().toISOString() };
			}
			return {
				ok: false,
				message: `Lemon Squeezy API returned HTTP ${response.status}.`,
				checkedAt: new Date().toISOString(),
			};
		}

		return { ok: null, message: 'No connectivity probe for provider.', checkedAt: new Date().toISOString() };
	} catch (error) {
		const aborted = error?.name === 'AbortError';
		return {
			ok: false,
			message: aborted ? 'Connectivity probe timed out.' : 'Connectivity probe failed.',
			checkedAt: new Date().toISOString(),
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Build a public health snapshot (no secrets). Does not persist.
 */
export async function buildHealthSnapshot(code, rawProvider = {}, billing = {}, {
	probeConnectivity = true,
	auto = false,
} = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	const raw = rawProvider || {};
	const enabled = raw.enabled !== false && normalized !== 'paypal';
	const implemented = normalized !== 'paypal';
	const validation = validateProvider(normalized, raw, billing);
	const flags = credentialFlags(normalized, raw);

	let connectivity = { ok: null, message: 'Connectivity not probed.', checkedAt: null };
	if (probeConnectivity && implemented && enabled) {
		connectivity = await probeProviderConnectivity(normalized, raw);
	} else if (!implemented) {
		connectivity = {
			ok: false,
			message: 'Provider not implemented.',
			checkedAt: new Date().toISOString(),
		};
	} else if (!enabled) {
		connectivity = {
			ok: null,
			message: 'Provider disabled — connectivity skipped.',
			checkedAt: new Date().toISOString(),
		};
	}

	const lastError = connectivity.ok === false
		? connectivity.message
		: (validation.result === 'FAIL'
			? (validation.diagnostics.find((d) => d.severity === 'error')?.message || validation.summary)
			: null);

	const healthScore = calculateHealthScore({
		enabled,
		implemented,
		validationResult: validation.result,
		connectivityOk: connectivity.ok,
		hasPrimaryCredential: flags.hasPrimaryCredential,
		hasWebhookSecret: flags.hasWebhookSecret,
		hasEnvironment: flags.hasEnvironment,
		lastError,
	});

	const status = deriveHealthStatus({
		enabled,
		implemented,
		validationResult: validation.result,
		healthScore,
		connectivityOk: connectivity.ok,
		everChecked: true,
	});

	const checkedAt = new Date().toISOString();

	return {
		provider: normalized,
		checkedAt,
		auto: Boolean(auto),
		healthScore,
		status,
		validation: {
			result: validation.result,
			summary: validation.summary,
			diagnostics: validation.diagnostics,
			checks: validation.checks,
		},
		connectivity: {
			ok: connectivity.ok,
			message: connectivity.message,
			checkedAt: connectivity.checkedAt,
		},
		lastError,
		lastValidation: checkedAt,
		lastHealthCheck: checkedAt,
	};
}

/**
 * Public DTO fields from a stored or live snapshot.
 */
export function toPublicHealthDto(rawProvider = {}, liveSnapshot = null) {
	const snapshot = liveSnapshot || rawProvider.healthSnapshot || null;
	if (!snapshot) {
		return {
			health: null,
			validation: null,
			healthScore: null,
			status: 'Unknown',
			lastHealthCheck: rawProvider.lastHealthCheck || null,
			lastValidation: rawProvider.lastValidation || null,
			lastError: rawProvider.lastError || null,
			autoHealth: false,
		};
	}

	return {
		health: {
			score: snapshot.healthScore,
			status: snapshot.status,
			connectivity: snapshot.connectivity || null,
			auto: Boolean(snapshot.auto),
		},
		validation: snapshot.validation || null,
		healthScore: snapshot.healthScore,
		status: snapshot.status || 'Unknown',
		lastHealthCheck: snapshot.lastHealthCheck || snapshot.checkedAt || null,
		lastValidation: snapshot.lastValidation || snapshot.checkedAt || null,
		lastError: snapshot.lastError || null,
		autoHealth: Boolean(snapshot.auto),
	};
}

/** Persistable latest-only snapshot (strip anything unexpected). */
export function toStoredHealthSnapshot(snapshot) {
	if (!snapshot || typeof snapshot !== 'object') return null;
	return {
		provider: snapshot.provider,
		checkedAt: snapshot.checkedAt,
		auto: Boolean(snapshot.auto),
		healthScore: Number(snapshot.healthScore) || 0,
		status: snapshot.status,
		validation: {
			result: snapshot.validation?.result,
			summary: snapshot.validation?.summary,
			diagnostics: Array.isArray(snapshot.validation?.diagnostics)
				? snapshot.validation.diagnostics.map((item) => ({
					code: item.code,
					message: item.message,
					severity: item.severity,
					field: item.field,
				}))
				: [],
			checks: snapshot.validation?.checks || {},
		},
		connectivity: {
			ok: snapshot.connectivity?.ok ?? null,
			message: snapshot.connectivity?.message || '',
			checkedAt: snapshot.connectivity?.checkedAt || null,
		},
		lastError: snapshot.lastError || null,
		lastValidation: snapshot.lastValidation || snapshot.checkedAt,
		lastHealthCheck: snapshot.lastHealthCheck || snapshot.checkedAt,
	};
}
