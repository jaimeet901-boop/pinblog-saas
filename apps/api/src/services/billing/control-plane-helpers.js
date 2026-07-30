/**
 * Pure Billing Control Plane helpers (no PocketBase side effects).
 */

import { decryptSecret, isEncryptedSecret } from '../../utils/secretCrypto.js';
import { BILLING_PROVIDERS } from './providers/base.js';

export const CONTROL_PLANE_PROVIDER_CODES = Object.freeze([
	'stripe',
	'paddle',
	'lemonsqueezy',
	'paypal',
]);

export const SECRET_FIELDS = Object.freeze({
	stripe: ['secretKey', 'webhookSecret'],
	paddle: ['apiKey', 'webhookSecret'],
	lemonsqueezy: ['apiKey', 'webhookSecret'],
	paypal: [],
});

export const PUBLIC_FIELDS = Object.freeze({
	stripe: ['mode', 'enabled', 'publishableKey'],
	paddle: ['mode', 'enabled', 'sandbox', 'defaultPriceId', 'vendorId'],
	lemonsqueezy: ['mode', 'enabled', 'storeId', 'defaultVariantId'],
	paypal: ['mode', 'enabled'],
});

export const CONTROL_PLANE_OWNED_BILLING_KEYS = Object.freeze([
	'provider',
	'providers',
	'checkoutEnabled',
	'webhookPath',
	'failover',
	'priceMappings',
	'monitoring',
	'disasterRecovery',
]);

export function normalizeProviderCodeLocal(value) {
	const code = String(value || 'none').trim().toLowerCase();
	return BILLING_PROVIDERS.includes(code) ? code : 'none';
}

export function isMaskedSecret(value) {
	const text = String(value || '');
	return !text || text.includes('•') || text.includes('*') || /^x{4,}/i.test(text);
}

export function publicProviderConfig(code, raw = {}) {
	const secrets = SECRET_FIELDS[code] || [];
	const publicKeys = PUBLIC_FIELDS[code] || [];
	const out = {
		enabled: raw.enabled !== false,
		mode: raw.mode === 'live' ? 'live' : 'test',
	};
	for (const key of publicKeys) {
		if (key === 'enabled' || key === 'mode') continue;
		if (raw[key] !== undefined) out[key] = raw[key];
	}
	for (const field of secrets) {
		const cipherKey = `${field}Cipher`;
		const setKey = `${field}Set`;
		const configured = Boolean(
			raw[setKey]
			|| raw[cipherKey]
			|| (typeof raw[field] === 'string' && raw[field] && !isMaskedSecret(raw[field])),
		);
		out[setKey] = configured;
	}
	if (raw.lastHealthCheck) out.lastHealthCheck = raw.lastHealthCheck;
	if (raw.lastValidation) out.lastValidation = raw.lastValidation;
	if (raw.lastError != null && raw.lastError !== '') out.lastError = String(raw.lastError).slice(0, 500);
	// Latest health snapshot is safe (no secrets) — include for Admin settings export consistency.
	if (raw.healthSnapshot && typeof raw.healthSnapshot === 'object') {
		out.healthScore = Number(raw.healthSnapshot.healthScore) || undefined;
		out.healthStatus = raw.healthSnapshot.status || undefined;
	}
	return out;
}

export function sanitizeBillingForPublic(billing = {}) {
	const out = structuredClone(billing || {});
	const providers = out.providers && typeof out.providers === 'object' ? out.providers : {};
	out.providers = {};
	for (const code of CONTROL_PLANE_PROVIDER_CODES) {
		out.providers[code] = publicProviderConfig(code, providers[code] || {});
	}
	if (out.disasterRecovery && typeof out.disasterRecovery === 'object') {
		// Lazy import avoided: redact nested backup provider ciphers inline.
		const dr = out.disasterRecovery;
		const backups = Array.isArray(dr.backups) ? dr.backups : [];
		dr.backups = backups.map((backup) => redactBackupProviders(backup));
		if (dr.checkpoints?.preRestore) {
			dr.checkpoints.preRestore = redactBackupProviders(dr.checkpoints.preRestore);
		}
	}
	return out;
}

function redactBackupProviders(backup) {
	if (!backup || typeof backup !== 'object') return backup;
	const copy = { ...backup, payload: { ...(backup.payload || {}) } };
	if (copy.payload.providers && typeof copy.payload.providers === 'object') {
		const providers = {};
		for (const code of CONTROL_PLANE_PROVIDER_CODES) {
			providers[code] = publicProviderConfig(code, copy.payload.providers[code] || {});
		}
		copy.payload.providers = providers;
	}
	copy.payloadRedacted = true;
	return copy;
}

export function stripControlPlaneBillingWrites(incomingSettings = {}, currentBilling = {}) {
	if (!incomingSettings || typeof incomingSettings !== 'object') return incomingSettings;
	if (!incomingSettings.billing || typeof incomingSettings.billing !== 'object') {
		return incomingSettings;
	}
	const next = { ...incomingSettings, billing: { ...incomingSettings.billing } };
	for (const key of CONTROL_PLANE_OWNED_BILLING_KEYS) {
		if (Object.prototype.hasOwnProperty.call(next.billing, key)) {
			if (Object.prototype.hasOwnProperty.call(currentBilling, key)) {
				next.billing[key] = structuredClone(currentBilling[key]);
			} else {
				delete next.billing[key];
			}
		}
	}
	return next;
}

export function decryptField(raw, field) {
	const cipherKey = `${field}Cipher`;
	if (raw?.[cipherKey] && isEncryptedSecret(raw[cipherKey])) {
		try {
			return decryptSecret(raw[cipherKey]);
		} catch {
			return '';
		}
	}
	if (typeof raw?.[field] === 'string' && raw[field] && !isMaskedSecret(raw[field]) && !isEncryptedSecret(raw[field])) {
		return raw[field];
	}
	return '';
}

/**
 * Build runtime provider config: Admin decrypted secrets first; providers fall back to env.
 */
export function resolveProviderRuntimeConfig(code, rawProvider = {}) {
	const normalized = normalizeProviderCodeLocal(code);
	if (normalized === 'none' || String(code).toLowerCase() === 'paypal') {
		return {};
	}
	const secrets = SECRET_FIELDS[normalized] || [];
	const publicKeys = PUBLIC_FIELDS[normalized] || [];
	const out = {};
	for (const key of publicKeys) {
		if (rawProvider[key] !== undefined) out[key] = rawProvider[key];
	}
	for (const field of secrets) {
		const value = decryptField(rawProvider, field);
		if (value) out[field] = value;
	}
	for (const key of ['priceIds', 'prices', 'variantIds', 'variants', 'defaultPriceId', 'defaultVariantId', 'storeId', 'sandbox']) {
		if (rawProvider[key] !== undefined && out[key] === undefined) {
			out[key] = rawProvider[key];
		}
	}
	return out;
}

/**
 * Safe DTO for API responses. Never include decrypted secrets, ciphertext, or raw payload.
 * Single public sanitization entry for resolved runtime config.
 */
export function toPublicBillingConfig(config = {}) {
	const billing = sanitizeBillingForPublic({
		provider: config.provider,
		checkoutEnabled: config.checkoutEnabled,
		planEnforcementEnabled: config.planEnforcementEnabled,
		gracePeriodDays: config.gracePeriodDays,
		autoRenew: config.autoRenew,
		autoResetCredits: config.autoResetCredits,
		webhookPath: config.webhookPath,
		providers: config.providers || {},
	});
	const provider = normalizeProviderCodeLocal(billing.provider);
	return {
		provider,
		checkoutEnabled: Boolean(billing.checkoutEnabled) && provider !== 'none',
		planEnforcementEnabled: Boolean(billing.planEnforcementEnabled),
		gracePeriodDays: Math.max(0, Number(billing.gracePeriodDays) || 3),
		autoRenew: billing.autoRenew !== false,
		autoResetCredits: billing.autoResetCredits !== false,
		webhookPath: billing.webhookPath || `/billing/webhooks/${provider}`,
		providers: {
			stripe: billing.providers.stripe,
			paddle: billing.providers.paddle,
			lemonsqueezy: billing.providers.lemonsqueezy,
		},
	};
}

/** Alias — one reusable sanitization layer for billing settings payloads. */
export const sanitizeBillingSettingsForPublic = sanitizeBillingForPublic;
