import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptSecret, encryptSecret } from '../utils/secretCrypto.js';
import { httpError } from '../middleware/require-admin.js';
import { PROVIDER_CATALOG, PROVIDER_CODES } from './ai-provider-catalog.js';
import { probeProviderConnection } from './ai-provider-health.js';
import { bumpWorkspaceConfigVersion } from './workspace-config-bus.js';
import {
	isImageOrientedProvider,
	isProviderConfigured,
	isTextOrientedProvider,
	matchPreferredProvider,
	normalizeImageProviderAlias,
	providerHasCredentials,
} from './ai-provider-readiness.js';
import logger from '../utils/logger.js';

export {
	isImageOrientedProvider,
	isProviderConfigured,
	isTextOrientedProvider,
	matchPreferredProvider,
	normalizeImageProviderAlias,
	providerHasCredentials,
};

const MASK = '••••••••••••••••';

function formatDateTime(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toISOString().replace('T', ' ').slice(0, 16);
}

function pushHistory(history, text) {
	const next = Array.isArray(history) ? [...history] : [];
	next.unshift({ text, time: 'just now' });
	return next.slice(0, 20);
}

function looksMasked(value) {
	if (typeof value !== 'string') return true;
	const trimmed = value.trim();
	if (!trimmed) return true;
	return trimmed.includes('•') || trimmed.includes('*');
}

function parseTimeoutMs(value, fallback = 30000) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.max(1000, Math.round(value));
	}
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return fallback;
	const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds)?$/);
	if (!match) {
		const asNumber = Number(trimmed);
		return Number.isFinite(asNumber) ? Math.max(1000, Math.round(asNumber)) : fallback;
	}
	const amount = Number(match[1]);
	const unit = match[2] || 'ms';
	if (unit === 'ms') return Math.max(1000, Math.round(amount));
	return Math.max(1000, Math.round(amount * 1000));
}

function parseRetryCount(value, fallback = 2) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.max(0, Math.min(10, Math.round(value)));
	}
	if (typeof value !== 'string') return fallback;
	const match = value.match(/(\d+)/);
	if (!match) return fallback;
	return Math.max(0, Math.min(10, Number(match[1])));
}

async function getSecretRecord(providerId) {
	try {
		return await pocketbaseClient.collection('ai_provider_secrets').getFirstListItem(
			pocketbaseClient.filter('provider = {:provider}', { provider: providerId }),
		);
	} catch {
		return null;
	}
}

async function getDecryptedSecrets(providerId) {
	const record = await getSecretRecord(providerId);
	return {
		record,
		apiKey: record?.api_key ? decryptSecret(record.api_key) : '',
		secretKey: record?.secret_key ? decryptSecret(record.secret_key) : '',
	};
}

export function mapProviderDto(record, secretsMeta = {}) {
	const hasApiKey = Boolean(secretsMeta.hasApiKey);
	const hasSecretKey = Boolean(secretsMeta.hasSecretKey);
	const timeoutMs = Number(record.timeout_ms) || 30000;
	const retryCount = Number(record.retry_count) || 0;

	return {
		id: record.id,
		code: record.code,
		name: record.name,
		badge: record.badge || String(record.name || '?').slice(0, 2).toUpperCase(),
		accent: record.accent || 'from-[#64748b] to-[#334155]',
		status: record.status || 'disconnected',
		enabled: Boolean(record.enabled),
		health: record.health || 'unknown',
		lastChecked: formatDateTime(record.last_checked),
		currentModel: record.default_model || '',
		endpoint: record.base_url || '',
		apiVersion: record.api_version || '',
		rateLimit: record.rate_limit || '—',
		lastSuccess: formatDateTime(record.last_success_at),
		lastError: record.last_error || '—',
		lastLatencyMs: record.last_latency_ms ?? null,
		models: Array.isArray(record.models) ? record.models : [],
		history: Array.isArray(record.history) ? record.history : [],
		priority: Number(record.priority) || 100,
		timeoutMs,
		retryCount,
		created: record.created,
		updated: record.updated,
		config: {
			apiKey: hasApiKey ? `••••${MASK.slice(4)}` : '',
			secretKey: hasSecretKey ? `••••${MASK.slice(4)}` : '',
			organizationId: record.organization_id || '',
			baseUrl: record.base_url || '',
			webhookUrl: record.webhook_url || '',
			redirectUri: record.redirect_uri || '',
			scopes: record.scopes || '',
			timeout: `${Math.round(timeoutMs / 1000)}s`,
			retryPolicy: `${retryCount} retries`,
			defaultModel: record.default_model || '',
			hasApiKey,
			hasSecretKey,
		},
	};
}

async function attachSecretsMeta(records) {
	const list = Array.isArray(records) ? records : [records];
	const metas = await Promise.all(list.map(async (record) => {
		const secret = await getSecretRecord(record.id);
		return {
			id: record.id,
			hasApiKey: Boolean(secret?.api_key),
			hasSecretKey: Boolean(secret?.secret_key),
		};
	}));
	const byId = Object.fromEntries(metas.map((item) => [item.id, item]));
	return list.map((record) => mapProviderDto(record, byId[record.id] || {}));
}

export async function ensureProviderCatalogSeeded() {
	const existing = await pocketbaseClient.collection('ai_providers').getFullList({
		fields: 'id,code',
		requestKey: null,
	}).catch(() => []);

	const existingCodes = new Set(existing.map((item) => item.code));
	for (const seed of PROVIDER_CATALOG) {
		if (existingCodes.has(seed.code)) continue;
		await pocketbaseClient.collection('ai_providers').create({
			code: seed.code,
			name: seed.name,
			badge: seed.badge,
			accent: seed.accent,
			status: 'disconnected',
			enabled: false,
			health: 'unknown',
			default_model: seed.default_model,
			base_url: seed.base_url,
			api_version: seed.api_version,
			rate_limit: seed.rate_limit || '',
			organization_id: '',
			priority: seed.priority,
			timeout_ms: seed.timeout_ms,
			retry_count: seed.retry_count,
			webhook_url: '',
			redirect_uri: '',
			scopes: seed.scopes || '',
			models: seed.models,
			history: [{ text: 'Provider seeded for Admin Console', time: 'just now' }],
			last_error: 'Not configured',
		});
	}
}

export async function listProviders() {
	await ensureProviderCatalogSeeded();
	const records = await pocketbaseClient.collection('ai_providers').getFullList({
		sort: 'priority,name',
		requestKey: null,
	});
	const dtos = await attachSecretsMeta(records);
	return promoteConfiguredHealthyProviders(dtos);
}

/**
 * Providers seeded/configured with keys + healthy checks often never flipped `enabled`.
 * Auto-enable only when credentials exist AND health is healthy.
 * Explicit Disable clears health (see setProviderEnabled) so this will not re-enable them.
 */
async function promoteConfiguredHealthyProviders(dtos) {
	const list = Array.isArray(dtos) ? dtos : [];
	const next = [];

	for (const dto of list) {
		const hasCreds = providerHasCredentials(dto);
		const healthy = String(dto.health || '').toLowerCase() === 'healthy';
		if (!dto.enabled && hasCreds && healthy) {
			await pocketbaseClient.collection('ai_providers').update(dto.id, {
				enabled: true,
				status: dto.status === 'disconnected' ? 'connected' : (dto.status || 'connected'),
				history: pushHistory(dto.history, 'Auto-enabled for workspace use (credentials + healthy)'),
			}).catch(() => null);
			bumpWorkspaceConfigVersion('provider_auto_enable');
			next.push({ ...dto, enabled: true });
			continue;
		}
		next.push(dto);
	}

	return next;
}

export async function getProviderById(id) {
	const record = await pocketbaseClient.collection('ai_providers').getOne(id);
	const [dto] = await attachSecretsMeta([record]);
	return dto;
}

/**
 * Decrypted Admin platform API key by provider code.
 * Returns empty when the provider is missing, disabled, or has no secret.
 */
export async function getPlatformProviderApiKey(code) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!normalized) return '';

	const lookupCode = normalized === 'flux' ? 'fal' : normalized;
	const records = await pocketbaseClient.collection('ai_providers').getFullList({
		filter: pocketbaseClient.filter('code = {:code}', { code: lookupCode }),
		requestKey: null,
	}).catch(() => []);

	const record = records[0];
	if (!record || !record.enabled) return '';

	const { apiKey } = await getDecryptedSecrets(record.id);
	return apiKey || '';
}

/** Backend gate for text generation (integrated-ai / AI Pins copy). */
export async function assertTextProviderConfigured() {
	const providers = await listProviders().catch(() => []);
	const ready = providers.filter((item) => isTextOrientedProvider(item.code) && isProviderConfigured(item));
	if (ready.length > 0) {
		return ready;
	}

	const error = new Error('No text AI provider configured. Enable a text provider (e.g. Google Gemini) in Admin Settings.');
	error.status = 400;
	error.errorCode = 'AI_TEXT_PROVIDER_NOT_CONFIGURED';
	error.meta = {
		providersTotal: providers.length,
		textEnabled: providers.filter((item) => isTextOrientedProvider(item.code) && item.enabled).length,
		textWithCredentials: providers.filter((item) => (
			isTextOrientedProvider(item.code) && providerHasCredentials(item)
		)).length,
	};
	throw error;
}

/**
 * Resolve a configured image provider from the Admin registry.
 *
 * Rules:
 * - If providerCode is non-empty and valid → use that code unchanged (alias-normalized only).
 * - NEVER substitute another provider (e.g. gemini → fal).
 * - Workspace/default provider is used ONLY when providerCode is empty AND allowWorkspaceDefault.
 */
export async function resolveConfiguredImageProvider(providerCode = '', options = {}) {
	const allowWorkspaceDefault = options.allowWorkspaceDefault !== false;
	const providers = await listProviders().catch(() => []);
	const requestedRaw = String(providerCode || '').trim().toLowerCase();
	const requested = normalizeImageProviderAlias(requestedRaw);

	logger.info('[resolveConfiguredImageProvider] before', {
		requestedRaw: requestedRaw || null,
		requested: requested || null,
		allowWorkspaceDefault,
	});
	console.log(`[INFO] [resolveConfiguredImageProvider] before ${JSON.stringify({
		requestedRaw: requestedRaw || null,
		requested: requested || null,
		allowWorkspaceDefault,
	})}`);

	let code = requested;

	if (!code) {
		if (!allowWorkspaceDefault) {
			const error = new Error('Image provider is required on the job and was missing.');
			error.status = 400;
			error.errorCode = 'AI_IMAGE_PROVIDER_MISSING';
			throw error;
		}
		const { getPlatformSettings } = await import('./platform-settings.js');
		const { settings } = await getPlatformSettings().catch(() => ({ settings: null }));
		const preferred = settings?.images?.defaultImageProvider || '';
		const matched = matchPreferredProvider(providers, preferred);
		code = normalizeImageProviderAlias(matched?.code || '');
	}

	const provider = providers.find((item) => (
		normalizeImageProviderAlias(item.code) === code
		|| String(item.code || '').toLowerCase() === code
	));
	if (provider && isProviderConfigured(provider)) {
		const resolvedCode = normalizeImageProviderAlias(provider.code) || String(provider.code || '').toLowerCase();
		// Hard guarantee: never return a different provider than the job asked for.
		if (requested && resolvedCode !== requested) {
			const error = new Error(
				`Image provider mismatch: job requested "${requestedRaw}" but registry resolved "${provider.code}".`,
			);
			error.status = 500;
			error.errorCode = 'AI_IMAGE_PROVIDER_MUTATED';
			error.meta = { requested: requestedRaw, resolved: provider.code };
			throw error;
		}

		logger.info('[resolveConfiguredImageProvider] after', {
			requestedRaw: requestedRaw || null,
			resolved: provider.code,
			providerName: provider.name || null,
			usedWorkspaceDefault: !requestedRaw,
		});
		console.log(`[INFO] [resolveConfiguredImageProvider] after ${JSON.stringify({
			requestedRaw: requestedRaw || null,
			resolved: provider.code,
			providerName: provider.name || null,
			usedWorkspaceDefault: !requestedRaw,
		})}`);
		return provider;
	}

	const label = provider?.name || code || 'image provider';
	const error = new Error(
		provider && !provider.enabled
			? `Image provider ${label} is disabled. Enable it in Admin Settings.`
			: requestedRaw
				? `Image provider "${requestedRaw}" is not configured. Enable it and add credentials in Admin Settings.`
				: `No image AI provider configured. Enable an image provider (e.g. Fal.ai or Google Gemini) in Admin Settings.`,
	);
	error.status = 400;
	error.errorCode = 'AI_IMAGE_PROVIDER_NOT_CONFIGURED';
	error.meta = { providerCode: code || null, requestedProvider: requestedRaw || null };
	throw error;
}

/** Backend gate for AI image jobs (Fal / OpenAI Images / Gemini Image). */
export async function assertImageProviderConfigured(providerCode = '') {
	const hasExplicit = Boolean(String(providerCode || '').trim());
	return resolveConfiguredImageProvider(providerCode, {
		// Only fall back to workspace default when the caller passed nothing.
		allowWorkspaceDefault: !hasExplicit,
	});
}

export async function createProvider(payload = {}) {
	const code = String(payload.code || '').trim().toLowerCase();
	if (!code || !/^[a-z0-9_-]{2,64}$/.test(code)) {
		throw httpError(422, 'code must be 2–64 lowercase letters, numbers, _ or -', 'VALIDATION_ERROR');
	}
	const name = String(payload.name || '').trim();
	if (!name) {
		throw httpError(422, 'name is required', 'VALIDATION_ERROR');
	}

	const catalog = PROVIDER_CATALOG.find((item) => item.code === code);
	try {
		const record = await pocketbaseClient.collection('ai_providers').create({
			code,
			name,
			badge: payload.badge || catalog?.badge || name.slice(0, 2).toUpperCase(),
			accent: payload.accent || catalog?.accent || 'from-[#64748b] to-[#334155]',
			status: 'disconnected',
			enabled: Boolean(payload.enabled),
			health: 'unknown',
			default_model: payload.defaultModel || catalog?.default_model || '',
			base_url: payload.baseUrl || catalog?.base_url || '',
			api_version: payload.apiVersion || catalog?.api_version || '',
			rate_limit: payload.rateLimit || catalog?.rate_limit || '',
			organization_id: payload.organizationId || '',
			priority: Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : (catalog?.priority || 100),
			timeout_ms: parseTimeoutMs(payload.timeout ?? payload.timeoutMs, catalog?.timeout_ms || 30000),
			retry_count: parseRetryCount(payload.retryCount ?? payload.retryPolicy, catalog?.retry_count || 2),
			webhook_url: payload.webhookUrl || '',
			redirect_uri: payload.redirectUri || '',
			scopes: payload.scopes || catalog?.scopes || '',
			models: Array.isArray(payload.models) ? payload.models : (catalog?.models || []),
			history: [{ text: 'Provider created', time: 'just now' }],
			last_error: 'Not configured',
		});

		if (payload.apiKey && !looksMasked(payload.apiKey)) {
			await upsertProviderSecrets(record.id, { apiKey: payload.apiKey, secretKey: payload.secretKey });
		}

		const created = await getProviderById(record.id);
		bumpWorkspaceConfigVersion('provider_create');
		return created;
	} catch (error) {
		if (String(error?.message || '').toLowerCase().includes('unique')) {
			throw httpError(409, `Provider code "${code}" already exists`, 'CONFLICT');
		}
		throw error;
	}
}

export async function updateProviderConfig(id, payload = {}) {
	const existing = await pocketbaseClient.collection('ai_providers').getOne(id);
	const config = payload.config && typeof payload.config === 'object' ? payload.config : payload;

	const updates = {
		name: config.name != null ? String(config.name).trim() || existing.name : existing.name,
		base_url: config.baseUrl != null ? String(config.baseUrl).trim() : existing.base_url,
		organization_id: config.organizationId != null ? String(config.organizationId).trim() : existing.organization_id,
		default_model: config.defaultModel != null ? String(config.defaultModel).trim() : existing.default_model,
		api_version: config.apiVersion != null ? String(config.apiVersion).trim() : existing.api_version,
		rate_limit: config.rateLimit != null ? String(config.rateLimit).trim() : existing.rate_limit,
		webhook_url: config.webhookUrl != null ? String(config.webhookUrl).trim() : existing.webhook_url,
		redirect_uri: config.redirectUri != null ? String(config.redirectUri).trim() : existing.redirect_uri,
		scopes: config.scopes != null ? String(config.scopes).trim() : existing.scopes,
		timeout_ms: config.timeout != null || config.timeoutMs != null
			? parseTimeoutMs(config.timeout ?? config.timeoutMs, existing.timeout_ms || 30000)
			: existing.timeout_ms,
		retry_count: config.retryCount != null || config.retryPolicy != null
			? parseRetryCount(config.retryCount ?? config.retryPolicy, existing.retry_count || 0)
			: existing.retry_count,
		priority: config.priority != null && Number.isFinite(Number(config.priority))
			? Number(config.priority)
			: existing.priority,
		history: pushHistory(existing.history, 'Configuration updated'),
	};

	if (Array.isArray(config.models)) {
		updates.models = config.models.map(String);
	}

	if (typeof config.enabled === 'boolean') {
		updates.enabled = config.enabled;
	}

	await pocketbaseClient.collection('ai_providers').update(id, updates);

	const secretUpdates = {};
	if (config.apiKey != null && !looksMasked(config.apiKey)) {
		secretUpdates.apiKey = String(config.apiKey).trim();
	}
	if (config.secretKey != null && !looksMasked(config.secretKey)) {
		secretUpdates.secretKey = String(config.secretKey).trim();
	}
	if (Object.keys(secretUpdates).length > 0) {
		await upsertProviderSecrets(id, secretUpdates);
		await pocketbaseClient.collection('ai_providers').update(id, {
			history: pushHistory(updates.history, 'Secrets rotated (masked)'),
		});
	}

	const updated = await getProviderById(id);
	bumpWorkspaceConfigVersion('provider_update');
	return updated;
}

export async function upsertProviderSecrets(providerId, { apiKey, secretKey } = {}) {
	await pocketbaseClient.collection('ai_providers').getOne(providerId);
	const existing = await getSecretRecord(providerId);
	const payload = {
		provider: providerId,
		kek_version: 'enc:v1',
		rotated_at: new Date().toISOString(),
	};

	if (typeof apiKey === 'string') {
		payload.api_key = apiKey ? encryptSecret(apiKey) : '';
	}
	if (typeof secretKey === 'string') {
		payload.secret_key = secretKey ? encryptSecret(secretKey) : '';
	}

	if (existing) {
		const updated = await pocketbaseClient.collection('ai_provider_secrets').update(existing.id, payload);
		bumpWorkspaceConfigVersion('provider_secrets');
		return updated;
	}

	const created = await pocketbaseClient.collection('ai_provider_secrets').create({
		api_key: payload.api_key || '',
		secret_key: payload.secret_key || '',
		...payload,
	});
	bumpWorkspaceConfigVersion('provider_secrets');
	return created;
}

export async function setProviderEnabled(id, enabled) {
	const existing = await pocketbaseClient.collection('ai_providers').getOne(id);
	const updates = {
		enabled: Boolean(enabled),
		history: pushHistory(existing.history, enabled ? 'Provider enabled' : 'Provider disabled'),
	};
	// Clearing health on disable prevents promoteConfiguredHealthyProviders from flipping it back on.
	if (!enabled) {
		updates.health = 'unknown';
		updates.status = 'disconnected';
		updates.last_error = 'Disabled in Admin Console';
	}
	await pocketbaseClient.collection('ai_providers').update(id, updates);
	const dto = await getProviderById(id);
	bumpWorkspaceConfigVersion(enabled ? 'provider_enable' : 'provider_disable');
	return dto;
}

export async function deleteProvider(id) {
	const record = await pocketbaseClient.collection('ai_providers').getOne(id);
	if (PROVIDER_CODES.includes(record.code)) {
		throw httpError(400, 'Built-in catalog providers cannot be deleted. Disable them instead.', 'PROVIDER_PROTECTED');
	}
	await pocketbaseClient.collection('ai_providers').delete(id);
	bumpWorkspaceConfigVersion('provider_delete');
	return { ok: true, id };
}

export async function testProviderConnection(id) {
	const record = await pocketbaseClient.collection('ai_providers').getOne(id);
	const { apiKey } = await getDecryptedSecrets(id);
	const result = await probeProviderConnection({
		code: record.code,
		baseUrl: record.base_url,
		apiVersion: record.api_version,
		apiKey,
		organizationId: record.organization_id,
		timeoutMs: Number(record.timeout_ms) || 15000,
	});

	const checkedAt = new Date().toISOString();
	await pocketbaseClient.collection('ai_providers').update(id, {
		status: result.status,
		health: result.health,
		enabled: result.ok ? true : record.enabled,
		last_checked: checkedAt,
		last_latency_ms: result.latencyMs || 0,
		last_error: result.ok ? '' : result.message,
		last_success_at: result.ok ? checkedAt : record.last_success_at,
		history: pushHistory(record.history, result.ok
			? `Health check passed (${result.latencyMs}ms); provider enabled for workspace use`
			: `Health check failed: ${result.message}`),
	});

	bumpWorkspaceConfigVersion(result.ok ? 'provider_health_ok' : 'provider_health_fail');
	const provider = await getProviderById(id);
	return {
		ok: result.ok,
		message: result.message,
		latencyMs: result.latencyMs,
		status: result.status,
		health: result.health,
		checkedAt: formatDateTime(checkedAt),
		provider,
	};
}

/**
 * Persist lightweight runtime outcome onto ai_providers (last success/failure/latency).
 * Best-effort — never throws to the caller.
 */
export async function recordProviderRuntimeOutcome(code, {
	ok,
	latencyMs = 0,
	errorMessage = '',
} = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!normalized) return null;

	try {
		const records = await pocketbaseClient.collection('ai_providers').getFullList({
			filter: pocketbaseClient.filter('code = {:code}', { code: normalized }),
			requestKey: null,
		});
		const record = records[0];
		if (!record) return null;

		const checkedAt = new Date().toISOString();
		const updates = {
			last_checked: checkedAt,
			last_latency_ms: Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : (record.last_latency_ms || 0),
		};

		if (ok) {
			updates.status = 'connected';
			updates.health = 'healthy';
			updates.last_error = '';
			updates.last_success_at = checkedAt;
		} else {
			updates.health = 'degraded';
			updates.last_error = String(errorMessage || 'Runtime request failed').slice(0, 500);
		}

		await pocketbaseClient.collection('ai_providers').update(record.id, updates);
		return true;
	} catch {
		return null;
	}
}
