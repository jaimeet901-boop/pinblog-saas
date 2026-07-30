/**
 * Billing Control Plane (BP-1) — configuration, encrypted secrets, admin audit.
 * Does not change BillingProvider, checkout, webhooks, or fulfillment.
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { encryptSecret } from '../../utils/secretCrypto.js';
import { writeAuditLog } from '../audit/write.js';
import { getBillingRequestCache } from './request-cache.js';
import {
	CONTROL_PLANE_OWNED_BILLING_KEYS,
	CONTROL_PLANE_PROVIDER_CODES,
	PUBLIC_FIELDS,
	SECRET_FIELDS,
	decryptField,
	isMaskedSecret,
	normalizeProviderCodeLocal,
	publicProviderConfig,
	resolveProviderRuntimeConfig,
	sanitizeBillingForPublic,
	stripControlPlaneBillingWrites,
	toPublicBillingConfig,
} from './control-plane-helpers.js';
import { isValidationBlocking, validateProvider } from './validation-engine.js';
import {
	buildHealthSnapshot,
	toPublicHealthDto,
	toStoredHealthSnapshot,
} from './health-engine.js';

const CONFIG_KEY = 'platform';
const SERVICE = 'billing-control-plane';
const UI_CATEGORY = 'Billing Admin';

const PROVIDER_META = Object.freeze({
	stripe: { name: 'Stripe', configurable: true },
	paddle: { name: 'Paddle', configurable: true },
	lemonsqueezy: { name: 'Lemon Squeezy', configurable: true },
	paypal: { name: 'PayPal', configurable: false },
});

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function normalizeProviderCode(value) {
	return normalizeProviderCodeLocal(value);
}

async function getSettingsRow() {
	return pocketbaseClient.collection('platform_settings').getFirstListItem(
		pocketbaseClient.filter('config_key = {:key}', { key: CONFIG_KEY }),
		{ requestKey: null },
	).catch(() => null);
}

async function loadRawBillingPayload() {
	const row = await getSettingsRow();
	const billing = row?.payload?.billing && typeof row.payload.billing === 'object'
		? structuredClone(row.payload.billing)
		: {};
	return { row, billing, payload: row?.payload || null, updatedAt: row?.updated || null };
}

export async function getRawBillingPayload() {
	const cache = getBillingRequestCache();
	if (cache) {
		if (!cache.rawPayloadPromise) {
			cache.rawPayloadPromise = loadRawBillingPayload();
		}
		return cache.rawPayloadPromise;
	}
	return loadRawBillingPayload();
}

/** Invalidate request-scoped raw cache after Control Plane writes. */
export function invalidateBillingRequestCache() {
	const cache = getBillingRequestCache();
	if (cache) {
		cache.rawPayloadPromise = null;
		cache.resolvedConfigPromise = null;
	}
}

export {
	CONTROL_PLANE_PROVIDER_CODES,
	CONTROL_PLANE_OWNED_BILLING_KEYS,
	SECRET_FIELDS,
	resolveProviderRuntimeConfig,
	sanitizeBillingForPublic,
	stripControlPlaneBillingWrites,
	toPublicBillingConfig,
};

export async function writeControlPlaneAudit({
	action,
	message,
	provider = '',
	severity = 'info',
	actor = {},
	ip = '',
	userAgent = '',
	before = null,
	after = null,
	result = 'ok',
	correlationId = '',
} = {}) {
	return writeAuditLog({
		category: 'billing',
		uiCategory: UI_CATEGORY,
		service: SERVICE,
		severity,
		action,
		message: message || action,
		actorUserId: actor.id || '',
		actorLabel: actor.email || actor.name || 'admin',
		resourceType: 'billing_provider',
		resourceId: provider || 'billing',
		provider: provider || '',
		ip,
		userAgent,
		result,
		correlationId: correlationId || undefined,
		metadata: {
			before: before || undefined,
			after: after || undefined,
		},
	});
}

async function persistBillingPayload(nextBilling, actor = {}, { expectedUpdatedAt = null } = {}) {
	const row = await getSettingsRow();
	if (!row) {
		throw httpError(500, 'Platform settings are not initialized.', 'SETTINGS_MISSING');
	}
	if (expectedUpdatedAt && row.updated && String(row.updated) !== String(expectedUpdatedAt)) {
		throw httpError(409, 'Billing configuration changed. Reload and try again.', 'BILLING_CONFIG_CONFLICT');
	}

	const payload = structuredClone(row.payload || {});
	payload.billing = nextBilling;

	const saved = await pocketbaseClient.collection('platform_settings').update(row.id, {
		config_key: CONFIG_KEY,
		payload,
		version: row.version || 'v1',
		meta: {
			...(row.meta || {}),
			updatedBy: actor.email || actor.id || 'admin',
			updatedAt: new Date().toISOString(),
			billingControlPlane: true,
		},
	});

	invalidateBillingRequestCache();

	const { bumpWorkspaceConfigVersion } = await import('../workspace-config-bus.js');
	bumpWorkspaceConfigVersion('platform_settings');

	return {
		billing: saved.payload?.billing || nextBilling,
		updatedAt: saved.updated,
	};
}

function envSecretConfigured(code) {
	switch (code) {
		case 'stripe':
			return Boolean(process.env.STRIPE_SECRET_KEY);
		case 'paddle':
			return Boolean(process.env.PADDLE_API_KEY);
		case 'lemonsqueezy':
			return Boolean(process.env.LEMONSQUEEZY_API_KEY);
		default:
			return false;
	}
}

function adminSecretConfigured(code, raw = {}) {
	const secrets = SECRET_FIELDS[code] || [];
	if (!secrets.length) return false;
	return Boolean(decryptField(raw, secrets[0]));
}

function connectionState(code, raw = {}) {
	if (code === 'paypal') {
		return { connected: false, source: 'unavailable', label: 'Not available' };
	}
	if (adminSecretConfigured(code, raw)) {
		return { connected: true, source: 'admin', label: 'Connected' };
	}
	if (envSecretConfigured(code)) {
		return { connected: true, source: 'env', label: 'Connected (env)' };
	}
	return { connected: false, source: 'none', label: 'Not connected' };
}

function buildProviderCard(code, billing = {}) {
	const meta = PROVIDER_META[code] || { name: code, configurable: false };
	const raw = billing.providers?.[code] || {};
	const publicConfig = publicProviderConfig(code, raw);
	const connection = connectionState(code, raw);
	const active = normalizeProviderCode(billing.provider) === code;
	const healthDto = toPublicHealthDto(raw);

	return {
		code,
		name: meta.name,
		configurable: meta.configurable,
		enabled: publicConfig.enabled !== false && meta.configurable,
		active,
		environment: publicConfig.mode === 'live' ? 'live' : 'test',
		connected: connection.connected,
		connectionSource: connection.source,
		connectionLabel: connection.label,
		health: healthDto.health,
		validation: healthDto.validation,
		healthScore: healthDto.healthScore,
		status: healthDto.status,
		healthLabel: healthDto.status,
		lastHealthCheck: healthDto.lastHealthCheck,
		lastValidation: healthDto.lastValidation,
		lastError: healthDto.lastError,
		autoHealth: healthDto.autoHealth,
		checkoutEnabled: Boolean(billing.checkoutEnabled),
		config: publicConfig,
		testConnectionAvailable: false,
	};
}

export async function listControlPlaneProviders() {
	const { billing, updatedAt } = await getRawBillingPayload();
	const items = CONTROL_PLANE_PROVIDER_CODES.map((code) => buildProviderCard(code, billing));
	return {
		items,
		activeProvider: normalizeProviderCode(billing.provider),
		checkoutEnabled: Boolean(billing.checkoutEnabled),
		updatedAt,
		permissions: {
			'admin.billing.read': true,
			'admin.billing.manage': true,
			'admin.billing.secrets.write': true,
		},
	};
}

export async function getControlPlaneProvider(code) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!CONTROL_PLANE_PROVIDER_CODES.includes(normalized)) {
		throw httpError(404, 'Unknown billing provider.', 'PROVIDER_NOT_FOUND');
	}
	const { billing, updatedAt } = await getRawBillingPayload();
	return {
		...buildProviderCard(normalized, billing),
		updatedAt,
	};
}

function applySecretUpdates(code, currentRaw, incoming = {}) {
	const next = { ...currentRaw };
	const secrets = SECRET_FIELDS[code] || [];
	const publicKeys = PUBLIC_FIELDS[code] || [];

	for (const key of publicKeys) {
		if (incoming[key] !== undefined) {
			next[key] = incoming[key];
		}
	}

	if (incoming.enabled !== undefined) next.enabled = Boolean(incoming.enabled);
	if (incoming.mode !== undefined) next.mode = incoming.mode === 'live' ? 'live' : 'test';
	if (incoming.sandbox !== undefined) next.sandbox = Boolean(incoming.sandbox);

	for (const field of secrets) {
		const cipherKey = `${field}Cipher`;
		const setKey = `${field}Set`;
		if (incoming[field] === undefined) continue;
		if (isMaskedSecret(incoming[field])) continue;
		const plain = String(incoming[field]).trim();
		if (!plain) {
			delete next[cipherKey];
			delete next[field];
			next[setKey] = false;
			continue;
		}
		next[cipherKey] = encryptSecret(plain);
		next[setKey] = true;
		delete next[field];
	}

	for (const field of secrets) {
		const cipherKey = `${field}Cipher`;
		if (next[cipherKey]) {
			delete next[field];
			next[`${field}Set`] = true;
		}
	}

	return next;
}

function redactedSecretSnapshot(code, raw = {}) {
	return publicProviderConfig(code, raw);
}

export async function updateControlPlaneProvider(code, body = {}, actor = {}, requestMeta = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	const meta = PROVIDER_META[normalized];
	if (!meta?.configurable) {
		throw httpError(normalized === 'paypal' ? 422 : 404, 'Provider is not configurable.', 'PROVIDER_NOT_CONFIGURABLE');
	}

	const { billing, updatedAt } = await getRawBillingPayload();
	const currentRaw = billing.providers?.[normalized] || {};
	const before = redactedSecretSnapshot(normalized, currentRaw);

	const hasSecretWrite = SECRET_FIELDS[normalized].some((field) => (
		body?.[field] !== undefined && !isMaskedSecret(body[field])
	));

	const nextRaw = applySecretUpdates(normalized, currentRaw, body || {});
	const nextBilling = {
		...billing,
		providers: {
			...(billing.providers || {}),
			[normalized]: nextRaw,
		},
	};

	if (body.checkoutEnabled !== undefined && typeof body.checkoutEnabled === 'boolean') {
		nextBilling.checkoutEnabled = body.checkoutEnabled;
	}

	const saved = await persistBillingPayload(nextBilling, actor, {
		expectedUpdatedAt: body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || null,
	});

	const after = redactedSecretSnapshot(normalized, saved.billing.providers?.[normalized] || {});
	await writeControlPlaneAudit({
		action: hasSecretWrite ? 'billing.provider.secret_updated' : 'billing.provider.config_updated',
		message: hasSecretWrite
			? `${meta.name} secrets updated`
			: `${meta.name} configuration updated`,
		provider: normalized,
		severity: hasSecretWrite ? 'warn' : 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before,
		after,
	});

	return {
		...buildProviderCard(normalized, saved.billing),
		updatedAt: saved.updatedAt || updatedAt,
	};
}

export async function setControlPlaneProviderEnabled(code, enabled, actor = {}, requestMeta = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	const meta = PROVIDER_META[normalized];
	if (!meta?.configurable) {
		throw httpError(422, 'Provider is not configurable.', 'PROVIDER_NOT_CONFIGURABLE');
	}

	const { billing } = await getRawBillingPayload();
	const currentRaw = { ...(billing.providers?.[normalized] || {}) };
	const before = { enabled: currentRaw.enabled !== false };
	currentRaw.enabled = Boolean(enabled);

	const nextBilling = {
		...billing,
		providers: {
			...(billing.providers || {}),
			[normalized]: currentRaw,
		},
	};

	if (!enabled && normalizeProviderCode(billing.provider) === normalized) {
		nextBilling.provider = 'none';
		nextBilling.checkoutEnabled = false;
	}

	const saved = await persistBillingPayload(nextBilling, actor, {
		expectedUpdatedAt: requestMeta.expectedUpdatedAt || null,
	});

	await writeControlPlaneAudit({
		action: enabled ? 'billing.provider.enabled' : 'billing.provider.disabled',
		message: `${meta.name} ${enabled ? 'enabled' : 'disabled'}`,
		provider: normalized,
		severity: 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before,
		after: { enabled: Boolean(enabled) },
	});

	return buildProviderCard(normalized, saved.billing);
}

export async function listControlPlaneHealth() {
	const { billing, updatedAt } = await getRawBillingPayload();
	const items = CONTROL_PLANE_PROVIDER_CODES.map((code) => buildProviderCard(code, billing));
	return {
		items,
		activeProvider: normalizeProviderCode(billing.provider),
		updatedAt,
	};
}

export async function validateControlPlaneProvider(code) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!CONTROL_PLANE_PROVIDER_CODES.includes(normalized)) {
		throw httpError(404, 'Unknown billing provider.', 'PROVIDER_NOT_FOUND');
	}
	const { billing, updatedAt } = await getRawBillingPayload();
	const raw = billing.providers?.[normalized] || {};
	const validation = validateProvider(normalized, raw, billing);
	return {
		...validation,
		provider: normalized,
		updatedAt,
	};
}

/**
 * Manual health check — Validation Engine + optional connectivity probe.
 * Stores latest snapshot only. Never creates payments/checkouts.
 */
export async function runControlPlaneHealthCheck(code, actor = {}, requestMeta = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!CONTROL_PLANE_PROVIDER_CODES.includes(normalized)) {
		throw httpError(404, 'Unknown billing provider.', 'PROVIDER_NOT_FOUND');
	}

	const { billing } = await getRawBillingPayload();
	const raw = billing.providers?.[normalized] || {};
	const probeConnectivity = requestMeta.probeConnectivity !== false;

	const snapshot = await buildHealthSnapshot(normalized, raw, billing, {
		probeConnectivity,
		auto: Boolean(requestMeta.auto),
	});
	const stored = toStoredHealthSnapshot(snapshot);

	const nextRaw = {
		...raw,
		healthSnapshot: stored,
		lastHealthCheck: stored.lastHealthCheck,
		lastValidation: stored.lastValidation,
		lastError: stored.lastError || null,
	};

	const nextBilling = {
		...billing,
		providers: {
			...(billing.providers || {}),
			[normalized]: nextRaw,
		},
	};

	const saved = await persistBillingPayload(nextBilling, actor, {
		expectedUpdatedAt: requestMeta.expectedUpdatedAt || null,
	});

	await writeControlPlaneAudit({
		action: snapshot.validation?.result === 'FAIL'
			? 'billing.health.check_failed'
			: 'billing.health.check_executed',
		message: `Health check for ${PROVIDER_META[normalized]?.name || normalized}: ${snapshot.status} (${snapshot.healthScore})`,
		provider: normalized,
		severity: snapshot.validation?.result === 'FAIL' ? 'error' : 'info',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before: null,
		after: {
			status: snapshot.status,
			healthScore: snapshot.healthScore,
			validation: snapshot.validation?.result,
			connectivityOk: snapshot.connectivity?.ok,
		},
	});

	return {
		...buildProviderCard(normalized, saved.billing),
		snapshot: stored,
		updatedAt: saved.updatedAt,
	};
}

export async function runControlPlaneHealthCheckAll(actor = {}, requestMeta = {}) {
	const results = [];
	for (const code of CONTROL_PLANE_PROVIDER_CODES) {
		// PayPal still runs and reports Not Implemented.
		results.push(await runControlPlaneHealthCheck(code, actor, {
			...requestMeta,
			// Avoid stamping expectedUpdatedAt after first write — refresh each iteration.
			expectedUpdatedAt: null,
		}));
	}
	return { items: results };
}

export async function activateControlPlaneProvider(code, actor = {}, requestMeta = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	const meta = PROVIDER_META[normalized];
	if (!meta?.configurable) {
		throw httpError(422, 'Provider cannot be activated.', 'PROVIDER_NOT_CONFIGURABLE');
	}

	const { billing } = await getRawBillingPayload();
	const raw = billing.providers?.[normalized] || {};
	if (raw.enabled === false) {
		throw httpError(422, 'Enable the provider before activating it.', 'PROVIDER_DISABLED');
	}

	const connection = connectionState(normalized, raw);
	if (!connection.connected) {
		throw httpError(422, 'Configure credentials (Admin or environment) before activating.', 'PROVIDER_NOT_CONNECTED');
	}

	const validation = validateProvider(normalized, raw, billing);
	if (isValidationBlocking(validation)) {
		const error = httpError(422, 'Provider validation failed. Resolve diagnostics before activating.', 'PROVIDER_VALIDATION_FAILED');
		error.details = {
			validation: {
				result: validation.result,
				summary: validation.summary,
				diagnostics: validation.diagnostics,
			},
		};
		throw error;
	}

	const before = { provider: normalizeProviderCode(billing.provider) };
	const nextBilling = {
		...billing,
		provider: normalized,
		providers: {
			...(billing.providers || {}),
			[normalized]: { ...raw, enabled: true },
		},
	};

	const saved = await persistBillingPayload(nextBilling, actor, {
		expectedUpdatedAt: requestMeta.expectedUpdatedAt || null,
	});

	await writeControlPlaneAudit({
		action: 'billing.provider.activated',
		message: `${meta.name} set as active billing provider`,
		provider: normalized,
		severity: 'warn',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before,
		after: { provider: normalized, validation: validation.result },
	});

	return {
		...buildProviderCard(normalized, saved.billing),
		updatedAt: saved.updatedAt,
		validation,
	};
}

export async function updateControlPlaneCheckoutSettings(body = {}, actor = {}, requestMeta = {}) {
	const { billing } = await getRawBillingPayload();
	const before = { checkoutEnabled: Boolean(billing.checkoutEnabled) };
	const nextBilling = { ...billing };

	if (body.checkoutEnabled !== undefined) {
		nextBilling.checkoutEnabled = Boolean(body.checkoutEnabled);
		if (nextBilling.checkoutEnabled && normalizeProviderCode(nextBilling.provider) === 'none') {
			throw httpError(422, 'Activate a billing provider before enabling checkout.', 'NO_ACTIVE_PROVIDER');
		}
	}

	const saved = await persistBillingPayload(nextBilling, actor, {
		expectedUpdatedAt: body.expectedUpdatedAt || requestMeta.expectedUpdatedAt || null,
	});

	await writeControlPlaneAudit({
		action: nextBilling.checkoutEnabled ? 'billing.checkout.enabled' : 'billing.checkout.disabled',
		message: `Checkout ${nextBilling.checkoutEnabled ? 'enabled' : 'disabled'}`,
		provider: normalizeProviderCode(saved.billing.provider),
		severity: 'warn',
		actor,
		ip: requestMeta.ip,
		userAgent: requestMeta.userAgent,
		before,
		after: { checkoutEnabled: Boolean(saved.billing.checkoutEnabled) },
	});

	return {
		checkoutEnabled: Boolean(saved.billing.checkoutEnabled),
		activeProvider: normalizeProviderCode(saved.billing.provider),
		updatedAt: saved.updatedAt,
	};
}

export async function listControlPlaneLogs(query = {}) {
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const provider = String(query.provider || '').trim().toLowerCase();
	const severity = String(query.severity || '').trim().toLowerCase();
	const q = String(query.q || query.search || '').trim();

	const parts = [
		'(service = "billing-control-plane" || ui_category = "Billing Admin")',
	];
	if (provider) {
		parts.push(pocketbaseClient.filter('provider ~ {:provider}', { provider }));
	}
	if (severity) {
		parts.push(pocketbaseClient.filter('(severity = {:sev} || ui_severity = {:sev})', { sev: severity }));
	}
	if (q) {
		parts.push(pocketbaseClient.filter(
			'(action ~ {:q} || message ~ {:q} || actor_label ~ {:q} || correlation_id ~ {:q} || ip ~ {:q})',
			{ q },
		));
	}
	if (query.from) {
		parts.push(pocketbaseClient.filter('occurred_at >= {:from}', { from: String(query.from) }));
	}
	if (query.to) {
		parts.push(pocketbaseClient.filter('occurred_at <= {:to}', { to: String(query.to) }));
	}

	const result = await pocketbaseClient.collection('audit_logs').getList(page, perPage, {
		filter: parts.join(' && '),
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));

	const items = (result.items || []).map((row) => ({
		id: row.id,
		timestamp: row.occurred_at || row.created,
		administrator: row.actor_label || '—',
		provider: row.provider || '—',
		action: row.action || row.message || '—',
		severity: row.severity || row.ui_severity || 'info',
		auditId: row.correlation_id || row.id,
		ip: row.ip || '—',
		message: row.message || '',
		metadata: row.metadata || {},
	}));

	return {
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		items,
	};
}

export {
	SERVICE as BILLING_CONTROL_PLANE_SERVICE,
	UI_CATEGORY as BILLING_CONTROL_PLANE_UI_CATEGORY,
};
