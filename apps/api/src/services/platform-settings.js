import pocketbaseClient from '../utils/pocketbaseClient.js';
import { encryptPinterestSecret } from '../utils/secretCrypto.js';
import { writeAuditLog } from './audit/write.js';
import { getPinterestAppCredentialsPublic } from './pinterest-app-credentials.js';
import { listProviders } from './ai-providers.js';

const CONFIG_KEY = 'platform';

export const DEFAULT_PLATFORM_SETTINGS = {
	general: {
		platformName: 'Chef IA',
		supportEmail: 'support@chef-ia.example',
		defaultLanguage: 'en',
		timezone: 'UTC',
		dateFormat: 'YYYY-MM-DD',
		maintenanceMode: false,
		allowRegistration: true,
		defaultWorkspacePlan: 'free',
	},
	ai: {
		defaultProvider: 'OpenAI',
		defaultModel: 'gpt-4.1',
		fallbackProvider: 'Google Gemini',
		fallbackModel: 'gemini-2.5-flash',
		temperature: '0.7',
		topP: '0.9',
		maxTokens: '4096',
		streamingEnabled: true,
		reasoningEnabled: false,
	},
	content: {
		articleLength: '1200-1800 words',
		recipeStyle: 'Friendly food blog',
		seoEnabled: true,
		autoMetaDescription: true,
		autoSlug: true,
		autoCategories: true,
		autoTags: true,
		internalLinking: true,
		pinStyles: [
			'Food',
			'Recipe',
			'Fitness',
			'Travel',
			'DIY',
			'Home',
			'Beauty',
			'Fashion',
			'Technology',
			'Business',
			'Lifestyle',
		],
		defaultPinAudience: '',
		defaultPinTone: '',
	},
	images: {
		defaultImageProvider: 'Fal.ai',
		defaultImageModel: 'flux-pro',
		imageSize: '1080x1440',
		quality: 'high',
		storageProvider: 'Object Storage',
		compression: 'lossy-80',
		watermark: false,
		estimateCreditsPerAiPin: 0.7,
	},
	wordpress: {
		publishingStatus: 'draft',
		retryPolicy: '3 exponential',
		featuredImageRequired: true,
		categories: 'Recipes, Tips',
		tags: 'pinterest, seo',
		autoPublish: false,
	},
	pinterest: {
		defaultBoard: 'New Pins',
		scheduling: 'smart-slots',
		retryPolicy: '2 linear',
		pinTemplate: 'Atelier Portrait',
		imageRatio: '2:3',
		dailyLimit: 50,
		intervalMinutes: 30,
		autoPublish: false,
		publishingWindows: [
			{ days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '20:00' },
		],
	},
	email: {
		smtpStatus: 'pending',
		smtpHost: '',
		smtpPort: '587',
		smtpUsername: '',
		smtpPasswordSet: false,
		senderName: 'Chef IA',
		senderEmail: 'noreply@chef-ia.example',
		dailyLimit: '5000',
		queueLimit: '250',
	},
	security: {
		sessionTimeout: '7 days',
		passwordPolicy: 'min 10 · upper · number · symbol',
		require2fa: false,
		apiRateLimit: '120 / min',
		allowedOrigins: 'http://localhost:3000',
	},
	system: {
		logRetention: '90 days',
		backupSchedule: 'Daily 02:00 UTC',
		cacheTtl: '15 minutes',
		storageLimit: '2 TB',
		defaultRegion: 'eu-west-1',
	},
	featureFlags: [
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
	],
	prompts: {
		pinSystem: 'You are a Pinterest growth strategist for food and lifestyle brands. Produce unique, high-CTR pin copy.',
		pinUser: 'Create distinct Pinterest pins from the article. Vary title, description, hook, CTA, angle, and overlay tone.',
		writerSystem: 'You are an expert SEO content writer for recipe and lifestyle blogs.',
		imageSystem: 'Generate a vertical Pinterest-ready image that matches the brand kit and article theme.',
	},
	license: {
		currentVersion: '0.0.0',
		buildNumber: '2026.07.22.1',
		licenseStatus: 'Active',
		releaseChannel: 'stable',
	},
};

function deepMerge(base, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
		return patch === undefined ? base : patch;
	}
	const out = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (Array.isArray(value)) {
			out[key] = value;
		} else if (value && typeof value === 'object') {
			out[key] = deepMerge(base?.[key] && typeof base[key] === 'object' ? base[key] : {}, value);
		} else if (value !== undefined) {
			out[key] = value;
		}
	}
	return out;
}

function deriveSmtpStatus(email = {}) {
	if (email.smtpHost && email.senderEmail) return 'connected';
	if (email.smtpStatus === 'connected' && email.senderEmail) return 'connected';
	if (email.smtpHost || email.smtpUsername) return 'pending';
	return 'pending';
}

async function getSettingsRow() {
	return pocketbaseClient.collection('platform_settings').getFirstListItem(
		pocketbaseClient.filter('config_key = {:key}', { key: CONFIG_KEY }),
		{ requestKey: null },
	).catch(() => null);
}

function normalizePayload(raw = {}) {
	const merged = deepMerge(DEFAULT_PLATFORM_SETTINGS, raw || {});
	merged.email = {
		...merged.email,
		smtpStatus: deriveSmtpStatus(merged.email),
		smtpPasswordSet: Boolean(merged.email?.smtpPasswordSet || merged.email?.smtpPasswordCipher),
	};
	// Never expose ciphertext to clients.
	delete merged.email.smtpPasswordCipher;
	delete merged.email.smtpPassword;
	return merged;
}

export async function getPlatformSettings() {
	const row = await getSettingsRow();
	const settings = normalizePayload(row?.payload || {});

	const [providers, pinterest] = await Promise.all([
		listProviders().catch(() => []),
		getPinterestAppCredentialsPublic().catch(() => null),
	]);

	const defaultProvider = providers.find((item) => item.enabled) || providers[0];
	if (defaultProvider && (!row || !row.payload?.ai?.defaultProvider)) {
		settings.ai.defaultProvider = defaultProvider.name || settings.ai.defaultProvider;
		settings.ai.defaultModel = defaultProvider.config?.defaultModel || defaultProvider.currentModel || settings.ai.defaultModel;
	}

	return {
		settings,
		meta: {
			updatedAt: row?.updated || null,
			source: row ? 'pocketbase' : 'defaults',
			pinterestConfigured: Boolean(pinterest?.configured),
			pinterestTrialAccessPending: Boolean(pinterest?.trialAccessPending),
			providersConfigured: providers.filter((item) => item.enabled).length,
		},
	};
}

export async function upsertPlatformSettings(nextSettings = {}, actor = {}) {
	const existing = await getSettingsRow();
	const current = normalizePayload(existing?.payload || {});
	const merged = deepMerge(current, nextSettings || {});

	if (nextSettings?.email?.smtpPassword && !String(nextSettings.email.smtpPassword).includes('•')) {
		merged.email.smtpPasswordCipher = encryptPinterestSecret(String(nextSettings.email.smtpPassword).trim());
		merged.email.smtpPasswordSet = true;
	} else if (existing?.payload?.email?.smtpPasswordCipher) {
		merged.email.smtpPasswordCipher = existing.payload.email.smtpPasswordCipher;
		merged.email.smtpPasswordSet = true;
	}

	merged.email.smtpStatus = deriveSmtpStatus(merged.email);
	delete merged.email.smtpPassword;

	const body = {
		config_key: CONFIG_KEY,
		payload: merged,
		version: 'v1',
		meta: {
			...(existing?.meta || {}),
			updatedBy: actor.email || actor.id || 'admin',
			updatedAt: new Date().toISOString(),
		},
	};

	const saved = existing
		? await pocketbaseClient.collection('platform_settings').update(existing.id, body)
		: await pocketbaseClient.collection('platform_settings').create(body);

	await writeAuditLog({
		category: 'admin',
		uiCategory: 'System',
		action: 'Updated platform settings',
		actorUserId: actor.id,
		actorLabel: actor.email || actor.name || 'admin',
		resourceType: 'platform_settings',
		resourceId: saved.id,
		result: 'ok',
	}).catch(() => null);

	const { bumpWorkspaceConfigVersion } = await import('./workspace-config-bus.js');
	bumpWorkspaceConfigVersion('platform_settings');

	return {
		settings: normalizePayload(saved.payload),
		meta: {
			updatedAt: saved.updated,
			source: 'pocketbase',
		},
	};
}

export async function resetPlatformSettings(actor = {}) {
	return upsertPlatformSettings(structuredClone(DEFAULT_PLATFORM_SETTINGS), actor);
}

export async function exportPlatformSettings() {
	const { settings, meta } = await getPlatformSettings();
	return {
		exportedAt: new Date().toISOString(),
		version: 'v1',
		meta,
		settings,
	};
}

export async function importPlatformSettings(document = {}, actor = {}) {
	const incoming = document.settings || document.payload || document;
	if (!incoming || typeof incoming !== 'object') {
		const error = new Error('Invalid settings document');
		error.status = 422;
		error.errorCode = 'VALIDATION_ERROR';
		throw error;
	}
	return upsertPlatformSettings(incoming, actor);
}

export async function ensurePlatformSettingsSeeded() {
	const existing = await getSettingsRow();
	if (existing) return normalizePayload(existing.payload);
	const created = await pocketbaseClient.collection('platform_settings').create({
		config_key: CONFIG_KEY,
		payload: DEFAULT_PLATFORM_SETTINGS,
		version: 'v1',
		meta: { seededAt: new Date().toISOString() },
	}).catch(() => null);
	return normalizePayload(created?.payload || DEFAULT_PLATFORM_SETTINGS);
}
