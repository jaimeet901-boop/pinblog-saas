/**
 * Billing Control Plane — Validation Engine (BP-2).
 * Configuration gate only. Never creates payments, checkouts, or subscriptions.
 */

import {
	CONTROL_PLANE_PROVIDER_CODES,
	SECRET_FIELDS,
	decryptField,
	isMaskedSecret,
} from './control-plane-helpers.js';

export const VALIDATION_RESULTS = Object.freeze(['PASS', 'WARNING', 'FAIL']);

function diag(code, message, severity = 'error', field = '') {
	return {
		code,
		message,
		severity, // error | warn | info
		field: field || undefined,
	};
}

function hasSecret(raw, field) {
	return Boolean(decryptField(raw, field));
}

function hasEnvSecret(providerCode, field) {
	const map = {
		stripe: {
			secretKey: 'STRIPE_SECRET_KEY',
			webhookSecret: 'STRIPE_WEBHOOK_SECRET',
		},
		paddle: {
			apiKey: 'PADDLE_API_KEY',
			webhookSecret: 'PADDLE_WEBHOOK_SECRET',
		},
		lemonsqueezy: {
			apiKey: 'LEMONSQUEEZY_API_KEY',
			webhookSecret: 'LEMONSQUEEZY_WEBHOOK_SECRET',
		},
		paypal: {
			clientSecret: 'PAYPAL_CLIENT_SECRET',
		},
	};
	const envKey = map[providerCode]?.[field];
	return Boolean(envKey && process.env[envKey]);
}

function credentialPresent(providerCode, raw, field) {
	return hasSecret(raw, field) || hasEnvSecret(providerCode, field);
}

function requireCredential(diagnostics, providerCode, raw, field, label) {
	if (credentialPresent(providerCode, raw, field)) return;
	diagnostics.push(diag(
		`${providerCode}.${field}_missing`,
		`${label} is required (Admin encrypted secret or environment).`,
		'error',
		field,
	));
}

function requirePublic(diagnostics, raw, field, label, { allowEnv = null } = {}) {
	const value = String(raw?.[field] || '').trim();
	if (value && !isMaskedSecret(value)) return;
	if (allowEnv && process.env[allowEnv]) return;
	diagnostics.push(diag(
		`field_${field}_missing`,
		`${label} is required.`,
		'error',
		field,
	));
}

function warnPublic(diagnostics, raw, field, label, { allowEnv = null } = {}) {
	const value = String(raw?.[field] || '').trim();
	if (value && !isMaskedSecret(value)) return;
	if (allowEnv && process.env[allowEnv]) return;
	diagnostics.push(diag(
		`field_${field}_recommended`,
		`${label} is recommended.`,
		'warn',
		field,
	));
}

function validateEnvironment(diagnostics, raw) {
	const mode = raw?.mode === 'live' ? 'live' : (raw?.mode === 'test' ? 'test' : '');
	if (!mode && raw?.mode !== undefined && raw.mode !== 'live' && raw.mode !== 'test') {
		diagnostics.push(diag('environment_invalid', 'Environment must be test or live.', 'error', 'mode'));
		return;
	}
	if (!raw?.mode) {
		diagnostics.push(diag('environment_default', 'Environment defaults to test when unset.', 'info', 'mode'));
	}
}

function validateStripe(raw, billing = {}) {
	const diagnostics = [];
	requireCredential(diagnostics, 'stripe', raw, 'secretKey', 'Secret Key');
	requireCredential(diagnostics, 'stripe', raw, 'webhookSecret', 'Webhook Secret');
	validateEnvironment(diagnostics, raw);

	if (billing.checkoutEnabled && billing.provider === 'stripe' && raw.enabled === false) {
		diagnostics.push(diag('provider_disabled', 'Stripe is disabled while checkout is enabled for Stripe.', 'error', 'enabled'));
	}

	return finalize(diagnostics, 'stripe');
}

function validatePaddle(raw, billing = {}) {
	const diagnostics = [];
	requireCredential(diagnostics, 'paddle', raw, 'apiKey', 'API Key');
	requireCredential(diagnostics, 'paddle', raw, 'webhookSecret', 'Webhook Secret');
	validateEnvironment(diagnostics, raw);
	// Vendor ID is Control Plane metadata; runtime today uses API key. Warn if absent.
	warnPublic(diagnostics, raw, 'vendorId', 'Vendor ID', { allowEnv: 'PADDLE_VENDOR_ID' });

	if (raw.sandbox === true && raw.mode === 'live') {
		diagnostics.push(diag(
			'environment_mismatch',
			'Paddle sandbox API is enabled while environment is live.',
			'warn',
			'sandbox',
		));
	}

	if (billing.checkoutEnabled && billing.provider === 'paddle' && raw.enabled === false) {
		diagnostics.push(diag('provider_disabled', 'Paddle is disabled while checkout is enabled for Paddle.', 'error', 'enabled'));
	}

	return finalize(diagnostics, 'paddle');
}

function validateLemonSqueezy(raw, billing = {}) {
	const diagnostics = [];
	requireCredential(diagnostics, 'lemonsqueezy', raw, 'apiKey', 'API Key');
	requireCredential(diagnostics, 'lemonsqueezy', raw, 'webhookSecret', 'Webhook Secret');
	requirePublic(diagnostics, raw, 'storeId', 'Store ID', { allowEnv: 'LEMONSQUEEZY_STORE_ID' });
	validateEnvironment(diagnostics, raw);

	if (billing.checkoutEnabled && billing.provider === 'lemonsqueezy' && raw.enabled === false) {
		diagnostics.push(diag('provider_disabled', 'Lemon Squeezy is disabled while checkout is enabled for Lemon Squeezy.', 'error', 'enabled'));
	}

	return finalize(diagnostics, 'lemonsqueezy');
}

function validatePayPal(raw, billing = {}) {
	const diagnostics = [];
	requirePublic(diagnostics, raw, 'clientId', 'Client ID', { allowEnv: 'PAYPAL_CLIENT_ID' });
	requireCredential(diagnostics, 'paypal', raw, 'clientSecret', 'Client Secret');
	requirePublic(diagnostics, raw, 'webhookId', 'Webhook ID', { allowEnv: 'PAYPAL_WEBHOOK_ID' });
	validateEnvironment(diagnostics, raw);

	const mode = raw?.mode === 'live' ? 'live' : (raw?.mode === 'test' ? 'test' : '');
	if (process.env.PAYPAL_MODE) {
		const envMode = String(process.env.PAYPAL_MODE).trim().toLowerCase();
		if (envMode !== 'sandbox' && envMode !== 'live') {
			diagnostics.push(diag('environment_invalid', 'PAYPAL_MODE must be sandbox or live.', 'error', 'mode'));
		}
	} else if (!mode && raw?.mode !== undefined) {
		diagnostics.push(diag('environment_invalid', 'Environment must be test or live.', 'error', 'mode'));
	}

	if (billing.checkoutEnabled && billing.provider === 'paypal' && raw.enabled === false) {
		diagnostics.push(diag('provider_disabled', 'PayPal is disabled while checkout is enabled for PayPal.', 'error', 'enabled'));
	}

	return finalize(diagnostics, 'paypal');
}

function finalize(diagnostics, provider) {
	const hasError = diagnostics.some((item) => item.severity === 'error');
	const hasWarn = diagnostics.some((item) => item.severity === 'warn');
	let result = 'PASS';
	if (hasError) result = 'FAIL';
	else if (hasWarn) result = 'WARNING';

	const secretsOk = !diagnostics.some((item) => (
		item.severity === 'error' && SECRET_FIELDS[provider]?.some((field) => item.field === field || item.code.includes(field))
	));

	return {
		provider,
		result,
		summary: result === 'PASS'
			? 'All required validation checks passed.'
			: result === 'WARNING'
				? 'Validation passed with warnings.'
				: 'Validation failed. Resolve errors before activation.',
		diagnostics,
		checks: {
			credentials: secretsOk && !diagnostics.some((d) => d.severity === 'error' && String(d.field || '').match(/Key|Secret|apiKey|secretKey|webhookSecret/i)),
			endpoints: !diagnostics.some((d) => d.code.includes('endpoint')),
			environment: !diagnostics.some((d) => d.severity === 'error' && d.field === 'mode'),
			checkoutReady: result !== 'FAIL',
			implemented: true,
		},
	};
}

/**
 * Validate a provider configuration (Admin raw + env fallback).
 * @returns {{ result: 'PASS'|'WARNING'|'FAIL', diagnostics: object[], ... }}
 */
export function validateProvider(code, rawProvider = {}, billing = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!CONTROL_PLANE_PROVIDER_CODES.includes(normalized)) {
		return {
			provider: normalized,
			result: 'FAIL',
			summary: 'Unknown provider.',
			diagnostics: [diag('unknown_provider', 'Unknown billing provider.', 'error')],
			checks: {
				credentials: false,
				endpoints: false,
				environment: false,
				checkoutReady: false,
				implemented: false,
			},
		};
	}

	if (normalized === 'paypal') return validatePayPal(rawProvider, billing);

	const raw = rawProvider || {};
	switch (normalized) {
		case 'stripe':
			return validateStripe(raw, billing);
		case 'paddle':
			return validatePaddle(raw, billing);
		case 'lemonsqueezy':
			return validateLemonSqueezy(raw, billing);
		default:
			return {
				provider: normalized,
				result: 'FAIL',
				summary: 'Unknown provider.',
				diagnostics: [diag('unknown_provider', 'Unknown billing provider.', 'error')],
				checks: {
					credentials: false,
					endpoints: false,
					environment: false,
					checkoutReady: false,
					implemented: false,
				},
			};
	}
}

export function isValidationBlocking(validation) {
	return String(validation?.result || '').toUpperCase() === 'FAIL';
}
