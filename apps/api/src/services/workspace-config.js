/**
 * Core platform service: Workspace Config
 * Admin writes platform settings/providers/models; modules only read this secret-safe DTO.
 * Versioned, cached, invalidatable, backward-compatible under /workspace/v1/config.
 *
 * Rollout note: this service is additive. Unmigrated modules keep their existing APIs.
 */

import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getPlatformSettings, DEFAULT_PLATFORM_SETTINGS } from './platform-settings.js';
import { listProviders } from './ai-providers.js';
import { listModels } from './ai-models.js';
import { getWorkspaceCredits } from './workspace-billing.js';
import { listWorkspaceTemplates } from './workspace-templates.js';
import { getSubscriptionPlan } from './workspace-context.js';
import { getUserCreditUsage } from './ai-pin-credits.js';
import {
	bumpWorkspaceConfigVersion,
	getCachedWorkspaceConfig,
	getWorkspaceConfigMetrics,
	getWorkspaceConfigPlatformVersion,
	recordAssembly,
	setCachedWorkspaceConfig,
	subscribeWorkspaceConfigStream,
} from './workspace-config-bus.js';
import {
	buildFeatureFlags,
	defaultPrompts,
	isWorkspaceConfigUnchanged,
	stripSecrets,
	withProvenance,
	workspaceConfigEtag,
} from './workspace-config-helpers.js';

export const WORKSPACE_CONFIG_API_VERSION = 'v1';

export {
	bumpWorkspaceConfigVersion,
	buildFeatureFlags,
	defaultPrompts,
	getWorkspaceConfigMetrics,
	getWorkspaceConfigPlatformVersion,
	isWorkspaceConfigUnchanged,
	stripSecrets,
	subscribeWorkspaceConfigStream,
	withProvenance,
	workspaceConfigEtag,
};

function mapPublicProvider(provider, workspaceId, updatedAt) {
	return withProvenance({
		id: provider.id,
		code: provider.code,
		name: provider.name,
		badge: provider.badge,
		status: provider.status,
		enabled: Boolean(provider.enabled),
		health: provider.health,
		currentModel: provider.currentModel || provider.config?.defaultModel || '',
		endpoint: provider.endpoint || provider.config?.baseUrl || '',
		priority: provider.priority,
		hasCredentials: Boolean(provider.config?.hasApiKey || provider.config?.hasSecretKey),
		capabilityHints: Array.isArray(provider.models) ? provider.models.slice(0, 20) : [],
	}, {
		workspaceId,
		source: 'platform',
		version: String(getWorkspaceConfigPlatformVersion()),
		updatedAt: provider.updated || updatedAt,
	});
}

function mapPublicModel(model, workspaceId) {
	return withProvenance({
		id: model.id,
		modelId: model.modelId,
		name: model.displayName || model.name,
		providerId: model.providerId,
		providerCode: model.providerCode,
		provider: model.provider,
		capability: model.capability,
		capabilities: model.capabilities || [],
		enabled: Boolean(model.enabled) && model.status !== 'disabled' && model.status !== 'deprecated',
		isDefault: Boolean(model.isDefault),
		supportsVision: Boolean(model.supportsVision),
		supportsStreaming: Boolean(model.supportsStreaming),
		contextWindow: model.contextWindow || 0,
	}, {
		workspaceId,
		source: 'platform',
		version: String(getWorkspaceConfigPlatformVersion()),
		updatedAt: model.updated || model.updatedAt,
	});
}

async function listBrandKits(ownerId, workspaceId) {
	const rows = await pocketbaseClient.collection('brand_kits').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		sort: '-updated',
		requestKey: null,
	}).catch(() => []);

	return rows.map((row) => withProvenance({
		id: row.id,
		name: row.name,
		logoUrl: row.logo_url || '',
		primaryColor: row.primary_color || '',
		secondaryColor: row.secondary_color || '',
		accentColor: row.accent_color || '',
		fontHeading: row.font_heading || '',
		fontBody: row.font_body || '',
		watermarkText: row.watermark_text || '',
		watermarkUrl: row.watermark_url || '',
		websiteUrl: row.website_url || '',
		isDefault: Boolean(row.is_default),
	}, {
		workspaceId,
		source: 'workspace',
		version: String(getWorkspaceConfigPlatformVersion()),
		updatedAt: row.updated,
	}));
}

function deepCloneSettings(value) {
	try {
		return structuredClone(value);
	} catch {
		return JSON.parse(JSON.stringify(value || {}));
	}
}

function estimatePayloadBytes(payload) {
	try {
		return Buffer.byteLength(JSON.stringify(payload), 'utf8');
	} catch {
		return 0;
	}
}

/**
 * Assemble secret-safe workspace config. Never throws for missing optional data.
 */
export async function buildWorkspaceConfig(req) {
	const workspaceId = req.workspace?.id || '';
	const ownerId = req.pocketbaseUserId;
	const cacheKey = workspaceId || ownerId || 'anonymous';

	const cached = getCachedWorkspaceConfig(cacheKey);
	if (cached) {
		return cached;
	}

	const started = Date.now();
	const platformUpdatedAt = new Date().toISOString();
	let settings = structuredClone(DEFAULT_PLATFORM_SETTINGS);
	let settingsMeta = { updatedAt: platformUpdatedAt, source: 'defaults' };

	try {
		const platform = await getPlatformSettings();
		settings = deepCloneSettings(platform.settings || settings);
		settingsMeta = platform.meta || settingsMeta;
	} catch {
		// defaults already set
	}

	if (!settings.prompts || typeof settings.prompts !== 'object') {
		settings.prompts = defaultPrompts();
	} else {
		settings.prompts = { ...defaultPrompts(), ...settings.prompts };
	}

	const [providersRaw, modelsRaw, credits, templatesResult, brandKits, plan, pinCredits] = await Promise.all([
		listProviders().catch(() => []),
		listModels({}).catch(() => ({ items: [] })),
		getWorkspaceCredits(req).catch(() => ({
			balance: 0,
			quota: 0,
			used: 0,
			remaining: 0,
			planSlug: 'free',
			planName: 'Free',
			ledger: [],
		})),
		listWorkspaceTemplates(req, { category: 'pin', perPage: 100 }).catch(() => ({ items: [] })),
		listBrandKits(ownerId, workspaceId),
		getSubscriptionPlan(req.workspaceSubscription).catch(() => null),
		ownerId
			? getUserCreditUsage(pocketbaseClient, ownerId).catch(() => null)
			: Promise.resolve(null),
	]);

	const version = String(getWorkspaceConfigPlatformVersion());

	const providers = (Array.isArray(providersRaw) ? providersRaw : [])
		.filter((item) => item && item.enabled !== false)
		.map((item) => mapPublicProvider(item, workspaceId, settingsMeta.updatedAt));

	const models = (modelsRaw.items || modelsRaw || [])
		.filter((item) => item && item.enabled !== false && item.status !== 'disabled')
		.map((item) => mapPublicModel(item, workspaceId));

	const textModels = models.filter((item) => item.capability === 'text' || !item.capability);
	const imageModels = models.filter((item) => item.capability === 'image');

	const textProviderCodes = new Set(textModels.map((item) => item.providerCode).filter(Boolean));
	const imageProviderCodes = new Set(imageModels.map((item) => item.providerCode).filter(Boolean));

	const textProviders = providers.filter((item) => (
		textProviderCodes.size === 0 || textProviderCodes.has(item.code) || !imageProviderCodes.has(item.code)
	));
	const imageProviders = providers.filter((item) => (
		imageProviderCodes.size === 0
		|| imageProviderCodes.has(item.code)
		|| String(item.code || '').toLowerCase().includes('fal')
	));

	const templates = (templatesResult.items || []).map((item) => withProvenance({
		id: item.id,
		name: item.name,
		category: item.category || 'pin',
		sourceCollection: item.source || item.sourceCollection || 'ai_pin_templates',
		thumbnailUrl: item.thumbnailUrl || item.thumbnail || item.thumbnail_url || '',
		isDefault: Boolean(item.isDefault || item.is_default),
		configuration: item.configuration || {},
	}, {
		workspaceId,
		source: 'workspace',
		version,
		updatedAt: item.updated || item.updatedAt || item.createdAt,
	}));

	const pinStyleList = Array.isArray(settings.content?.pinStyles) && settings.content.pinStyles.length
		? settings.content.pinStyles.map(String)
		: (DEFAULT_PLATFORM_SETTINGS.content?.pinStyles || []);
	const pinStyles = pinStyleList.map((style) => withProvenance({
		id: style,
		label: style,
	}, {
		workspaceId,
		source: 'platform',
		version,
		updatedAt: settingsMeta.updatedAt,
	}));

	const limits = withProvenance({
		aiRequests: Number(plan?.limits?.aiRequests) || Number(plan?.credits) || 0,
		imageGenerations: Number(plan?.limits?.imageGenerations) || 0,
		pinsPerBatch: Number(plan?.limits?.pinsPerBatch) || 20,
		websites: Number(plan?.limits?.websites) || 0,
		planSlug: plan?.slug || credits.planSlug || 'free',
		planName: plan?.name || credits.planName || 'Free',
	}, {
		workspaceId,
		source: 'plan',
		version,
		updatedAt: settingsMeta.updatedAt,
	});

	const stamp = {
		workspaceId,
		version,
		updatedAt: settingsMeta.updatedAt || platformUpdatedAt,
	};

	const payload = stripSecrets({
		apiVersion: WORKSPACE_CONFIG_API_VERSION,
		configVersion: version,
		updated_at: settingsMeta.updatedAt ? new Date(settingsMeta.updatedAt).toISOString() : platformUpdatedAt,
		source: settingsMeta.source === 'pocketbase' ? 'platform' : 'derived',
		workspace_id: workspaceId,
		featureFlags: buildFeatureFlags(settings, workspaceId, settingsMeta.updatedAt, version),
		ai: withProvenance(settings.ai || DEFAULT_PLATFORM_SETTINGS.ai, {
			...stamp,
			source: 'platform',
		}),
		images: withProvenance(settings.images || DEFAULT_PLATFORM_SETTINGS.images, {
			...stamp,
			source: 'platform',
		}),
		content: withProvenance(settings.content || DEFAULT_PLATFORM_SETTINGS.content, {
			...stamp,
			source: 'platform',
		}),
		pinterest: withProvenance(settings.pinterest || DEFAULT_PLATFORM_SETTINGS.pinterest, {
			...stamp,
			source: 'platform',
		}),
		wordpress: withProvenance(settings.wordpress || DEFAULT_PLATFORM_SETTINGS.wordpress, {
			...stamp,
			source: 'platform',
		}),
		security: withProvenance({
			sessionTimeout: settings.security?.sessionTimeout,
			passwordPolicy: settings.security?.passwordPolicy,
			require2fa: Boolean(settings.security?.require2fa),
			apiRateLimit: settings.security?.apiRateLimit,
		}, { ...stamp, source: 'platform' }),
		prompts: withProvenance(settings.prompts || defaultPrompts(), {
			...stamp,
			source: 'platform',
		}),
		publishingRules: withProvenance({
			wordpress: settings.wordpress || DEFAULT_PLATFORM_SETTINGS.wordpress,
			pinterest: settings.pinterest || DEFAULT_PLATFORM_SETTINGS.pinterest,
		}, { ...stamp, source: 'platform' }),
		schedulingDefaults: withProvenance({
			pinterestScheduling: settings.pinterest?.scheduling || 'smart-slots',
			timezone: settings.general?.timezone || 'UTC',
		}, { ...stamp, source: 'platform' }),
		watermark: withProvenance({
			enabled: Boolean(settings.images?.watermark),
			fromImagesSettings: true,
		}, { ...stamp, source: 'platform' }),
		typographyHints: withProvenance({
			defaultLanguage: settings.general?.defaultLanguage || 'en',
		}, { ...stamp, source: 'platform' }),
		textProviders,
		imageProviders,
		models,
		textModels,
		imageModels,
		credits: withProvenance({
			balance: Number(credits.balance) || 0,
			quota: Number(credits.quota) || 0,
			used: Number(credits.used) || 0,
			remaining: Number(credits.remaining) || 0,
			planSlug: credits.planSlug || pinCredits?.plan || 'free',
			planName: credits.planName || 'Free',
			ai: pinCredits?.ai || {
				used: Number(credits.used) || 0,
				limit: Number(credits.quota) || 0,
				remaining: Number(credits.remaining) || 0,
			},
			image: pinCredits?.image || {
				used: 0,
				limit: 0,
				remaining: Number(credits.remaining) || 0,
			},
		}, {
			workspaceId,
			source: 'workspace',
			version,
			updatedAt: settingsMeta.updatedAt,
		}),
		limits,
		pinStyles,
		queueDefaults: withProvenance({
			pollHintMs: 15000,
		}, { ...stamp, source: 'derived' }),
		brandKits,
		templates,
		general: withProvenance({
			platformName: settings.general?.platformName || 'Chef IA',
			defaultLanguage: settings.general?.defaultLanguage || 'en',
			timezone: settings.general?.timezone || 'UTC',
			maintenanceMode: Boolean(settings.general?.maintenanceMode),
		}, { ...stamp, source: 'platform' }),
	});

	const payloadBytes = estimatePayloadBytes(payload);
	const durationMs = Date.now() - started;
	recordAssembly({ durationMs, payloadBytes });
	setCachedWorkspaceConfig(cacheKey, payload, payloadBytes);

	return payload;
}
