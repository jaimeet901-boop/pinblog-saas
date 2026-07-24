/**
 * Pure helpers for Workspace Config (no PocketBase / IO).
 * Safe to import from unit tests without starting the API.
 */

const SECRET_KEY_PATTERN = /api[_-]?key|secret|password|ciphertext|token|private[_-]?key/i;

/** Mirrors DEFAULT_PLATFORM_SETTINGS.featureFlags — keep in sync when adding flags. */
export const FALLBACK_FEATURE_FLAGS = [
	{ id: 'ai-writer', label: 'AI Writer', enabled: true },
	{ id: 'ai-images', label: 'AI Images', enabled: true },
	{ id: 'templates', label: 'Templates', enabled: true },
	{ id: 'brand-kit', label: 'Brand Kit', enabled: true },
	{ id: 'analytics', label: 'Analytics', enabled: true },
	{ id: 'pinterest', label: 'Pinterest', enabled: true },
	{ id: 'wordpress', label: 'WordPress', enabled: true },
	{ id: 'calendar', label: 'Calendar', enabled: true },
	{ id: 'history', label: 'History', enabled: true },
	{ id: 'api-access', label: 'API Access', enabled: false },
];

export function isoNow(value) {
	if (!value) return new Date().toISOString();
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function withProvenance(value, {
	workspaceId,
	source = 'platform',
	version = '1',
	updatedAt = null,
} = {}) {
	if (Array.isArray(value)) {
		return value.map((item) => withProvenance(item, {
			workspaceId,
			source,
			version,
			updatedAt,
		}));
	}
	if (!value || typeof value !== 'object') {
		return {
			value,
			version: String(version),
			updated_at: isoNow(updatedAt),
			source,
			workspace_id: workspaceId || '',
		};
	}
	return {
		...value,
		version: String(value.version || version),
		updated_at: isoNow(value.updated_at || value.updatedAt || updatedAt),
		source: value.source || source,
		workspace_id: value.workspace_id || workspaceId || '',
	};
}

export function stripSecrets(input, depth = 0) {
	if (depth > 8 || input == null) return input;
	if (Array.isArray(input)) return input.map((item) => stripSecrets(item, depth + 1));
	if (typeof input !== 'object') return input;
	const out = {};
	for (const [key, value] of Object.entries(input)) {
		if (SECRET_KEY_PATTERN.test(key)) continue;
		if (typeof value === 'string' && (value.startsWith('enc:v1:') || value.includes('••••'))) continue;
		out[key] = stripSecrets(value, depth + 1);
	}
	return out;
}

export function defaultPrompts() {
	return {
		pinSystem: 'You are a Pinterest growth strategist for food and lifestyle brands. Produce unique, high-CTR pin copy.',
		pinUser: 'Create distinct Pinterest pins from the article. Vary title, description, hook, CTA, angle, and overlay tone.',
		writerSystem: 'You are an expert SEO content writer for recipe and lifestyle blogs.',
		imageSystem: 'Generate a vertical Pinterest-ready image that matches the brand kit and article theme.',
	};
}

export function buildFeatureFlags(settings, workspaceId, updatedAt, version) {
	const flags = Array.isArray(settings?.featureFlags) && settings.featureFlags.length
		? settings.featureFlags
		: FALLBACK_FEATURE_FLAGS;
	return flags.map((flag) => withProvenance({
		id: flag.id,
		label: flag.label || flag.id,
		enabled: Boolean(flag.enabled),
	}, {
		workspaceId,
		source: 'platform',
		updatedAt,
		version,
	}));
}

export function isWorkspaceConfigUnchanged(req, config) {
	const since = String(req.query?.since || req.get?.('If-None-Match') || '')
		.replace(/^W\//, '')
		.replaceAll('"', '')
		.trim();
	if (!since) return false;
	return since === String(config.configVersion);
}

export function workspaceConfigEtag(config) {
	return `"${String(config.configVersion)}"`;
}
