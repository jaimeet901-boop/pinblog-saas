import pocketbaseClient from '../utils/pocketbaseClient.js';
import { encryptPinterestSecret } from '../utils/secretCrypto.js';
import { writeAuditLog } from './audit/write.js';
import { getPinterestAppCredentialsPublic } from './pinterest-app-credentials.js';
import { listProviders } from './ai-providers.js';
import { sanitizeBillingForPublic, stripControlPlaneBillingWrites } from './billing/control-plane-helpers.js';
import { syncUsersRegistrationCreateRule } from './users-privileged-fields.js';

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
	/** Platform Identity — logo/media URLs. Display name SoT is general.platformName. */
	branding: {
		platformLogoUrl: '',
		sidebarLogoUrl: '',
		loginLogoUrl: '',
		faviconUrl: '',
		/** Uploaded brand asset metadata keyed by AssetUploader assetKey. */
		assets: {},
	},
	domains: {
		primaryDomain: '',
		appUrl: '',
		apiUrl: '',
		documentationUrl: '',
	},
	/** contactEmail only; supportEmail SoT is general.supportEmail. */
	contact: {
		contactEmail: '',
	},
	/** SEO Identity — public browser / search / social metadata. */
	seo: {
		browserTitle: '',
		metaTitle: '',
		metaDescription: '',
		metaKeywords: '',
		canonicalUrl: '',
		ogTitle: '',
		ogDescription: '',
		ogImageUrl: '',
		twitterCardType: 'summary_large_image',
		twitterTitle: '',
		twitterDescription: '',
		twitterImageUrl: '',
		googleSiteVerification: '',
		bingSiteVerification: '',
		pinterestSiteVerification: '',
		facebookDomainVerification: '',
	},
	social: {
		facebook: '',
		twitter: '',
		linkedin: '',
		youtube: '',
		discord: '',
		github: '',
	},
	ai: {
		defaultProvider: 'Google Gemini',
		defaultModel: 'gemini-3.5-flash',
		fallbackProvider: 'OpenAI',
		fallbackModel: 'gpt-4.1',
		/** Ordered provider codes used by Universal Text Runtime failover. */
		runtimePriority: [
			'openai',
			'gemini',
			'claude',
			'openrouter',
			'deepseek',
			'mistral',
			'grok',
			'ollama',
			'huggingface',
			'replicate',
		],
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
		/** featured_first | ai_first | always_featured | always_ai */
		imageSourceStrategy: 'ai_first',
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
		packs: {
			facebook: {
				copySystem: 'You are a Facebook Page content strategist for food and lifestyle brands. Produce engaging link-post copy optimized for reach and clicks.',
				copyUser: 'Create distinct Facebook link posts from the article. Vary headline, message, hook, CTA, angle, and overlay tone.',
				imageSystem: 'Generate a landscape Facebook link-post image (1200×630, 1.91:1) that matches the brand kit and article theme.',
				analyzeSystem: 'You are a Facebook Page content strategist. Reply with JSON only.',
				analyzeHints: {
					itemNoun: 'post',
					itemNounPlural: 'posts',
					network: 'Facebook',
					aspect: '1.91:1',
					imageDimensions: '1200x630',
					defaultCta: 'Learn more',
					heuristicDescriptionSuffix: '— tap to read the full story.',
				},
			},
		},
	},
	license: {
		currentVersion: '0.0.0',
		buildNumber: '2026.07.22.1',
		licenseStatus: 'Active',
		releaseChannel: 'stable',
	},
	credits: {
		defaultFreeCredits: 50,
		featureCosts: {
			ai_analyze: 1,
			ai_prompt: 1,
			ai_writer: 2,
			ai_pin_copy: 1,
			ai_image: 1,
			pin_publish: 1,
			wordpress_publish: 1,
			facebook_publish: 1,
			template_export: 1,
		},
		defaultTrial: {
			enabled: false,
			days: 14,
			credits: 100,
		},
		resetDayOfMonth: 1,
		keepPurchasedOnReset: true,
		payAsYouGo: {
			enabled: false,
			minPackCredits: 100,
			autoTopupThreshold: 0,
			autoTopupPackCredits: 500,
		},
		creditPacks: [
			{ id: 'pack-100', name: 'Starter Pack', credits: 100, price: 9, currency: 'USD', active: true },
			{ id: 'pack-500', name: 'Growth Pack', credits: 500, price: 29, currency: 'USD', active: true },
			{ id: 'pack-2000', name: 'Scale Pack', credits: 2000, price: 99, currency: 'USD', active: true },
		],
	},
	billing: {
		provider: 'none',
		checkoutEnabled: false,
		planEnforcementEnabled: false,
		autoRenew: true,
		autoResetCredits: true,
		gracePeriodDays: 3,
		webhookPath: '/billing/webhooks',
		providers: {
			stripe: { enabled: true, mode: 'test', secretKeySet: false, webhookSecretSet: false },
			paddle: { enabled: true, mode: 'test', apiKeySet: false, webhookSecretSet: false, sandbox: true },
			lemonsqueezy: { enabled: true, mode: 'test', apiKeySet: false, webhookSecretSet: false },
			paypal: { enabled: false, mode: 'test' },
		},
		priceMappings: {
			version: 1,
			plans: {},
			packs: {},
			meta: {},
		},
		failover: {
			policyVersion: 1,
			autoFailoverEnabled: false,
			mode: 'automatic',
			forcedProvider: null,
			priority: ['stripe', 'lemonsqueezy', 'paddle'],
			preferredPrimary: 'stripe',
			eligibility: {
				requireEnabled: true,
				requireImplemented: true,
				forbidHealth: ['Critical', 'Offline', 'Unknown'],
				forbidValidation: ['FAIL'],
				allowWarning: true,
			},
			cooldownSeconds: 300,
			autoOnHealthCheck: false,
			recovery: {
				mode: 'manual',
				autoRestorePreferred: false,
				requireHealthyPrimary: true,
			},
			lastDecision: {
				at: null,
				type: null,
				from: null,
				to: null,
				reasonCode: null,
				fingerprint: null,
			},
			recentEvents: [],
		},
		monitoring: {
			policyVersion: 1,
			pollHintSeconds: 30,
			windows: {
				metricsHours: 24,
				trendsDays: 30,
				timelineLimit: 100,
				eventsPageMax: 100,
			},
			thresholds: {
				criticalProvidersMin: 1,
				failoverBurstCount: 3,
				failoverBurstMinutes: 60,
				validationFailStreak: 2,
			},
			alerts: {
				items: [],
			},
		},
		disasterRecovery: {
			policyVersion: 1,
			maxBackups: 20,
			cooldownSeconds: 60,
			backups: [],
			checkpoints: {
				preRestore: null,
			},
			lastRestore: null,
			restoreHistory: [],
		},
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

function normalizeSeoIdentity(seo = {}, raw = {}) {
	const next = { ...(seo && typeof seo === 'object' ? seo : {}) };
	const rawSeo = raw?.seo && typeof raw.seo === 'object' ? raw.seo : {};
	const rawBranding = raw?.branding && typeof raw.branding === 'object' ? raw.branding : {};

	// Legacy Phase 1 keys → SEO Identity SoT.
	if (!String(next.metaTitle || '').trim() && String(rawSeo.defaultMetaTitle || next.defaultMetaTitle || '').trim()) {
		next.metaTitle = String(rawSeo.defaultMetaTitle || next.defaultMetaTitle).trim();
	}
	if (!String(next.metaKeywords || '').trim() && String(rawSeo.defaultKeywords || next.defaultKeywords || '').trim()) {
		next.metaKeywords = String(rawSeo.defaultKeywords || next.defaultKeywords).trim();
	}
	if (!String(next.ogImageUrl || '').trim() && String(rawBranding.openGraphImageUrl || '').trim()) {
		next.ogImageUrl = String(rawBranding.openGraphImageUrl).trim();
	}

	const card = String(next.twitterCardType || '').trim().toLowerCase();
	next.twitterCardType = card === 'summary' ? 'summary' : 'summary_large_image';

	delete next.defaultMetaTitle;
	delete next.defaultKeywords;
	return next;
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
	merged.billing = sanitizeBillingForPublic(merged.billing || {});

	// Single source of truth: general.platformName + general.supportEmail.
	// Migrate any legacy independent copies once, then drop them so sections cannot diverge.
	const legacyBrandName = String(raw?.branding?.platformName || '').trim();
	const legacySupport = String(raw?.contact?.supportEmail || '').trim();
	if (!String(merged.general?.platformName || '').trim() && legacyBrandName) {
		merged.general.platformName = legacyBrandName;
	}
	if (!String(merged.general?.supportEmail || '').trim() && legacySupport) {
		merged.general.supportEmail = legacySupport;
	}
	if (merged.branding && Object.prototype.hasOwnProperty.call(merged.branding, 'platformName')) {
		delete merged.branding.platformName;
	}
	if (merged.contact && Object.prototype.hasOwnProperty.call(merged.contact, 'supportEmail')) {
		delete merged.contact.supportEmail;
	}
	if (merged.branding && Object.prototype.hasOwnProperty.call(merged.branding, 'openGraphImageUrl')) {
		delete merged.branding.openGraphImageUrl;
	}

	merged.seo = normalizeSeoIdentity(merged.seo, raw);

	return merged;
}

export async function getPlatformSettings() {
	const row = await getSettingsRow();
	const settings = normalizePayload(row?.payload || {});

	const [providers, pinterest] = await Promise.all([
		listProviders().catch(() => []),
		getPinterestAppCredentialsPublic().catch(() => null),
	]);

	const defaultProvider = providers.find((item) => (
		item.enabled && !['fal', 'flux', 'replicate'].includes(String(item.code || '').toLowerCase())
	)) || providers.find((item) => item.enabled) || providers[0];
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

/**
 * Public, non-secret identity slice for auth/shell/public consumers.
 * Does not change GET/PUT /admin/v1/settings.
 */
export async function getPublicPlatformIdentity() {
	const { settings, meta } = await getPlatformSettings();
	const branding = settings.branding || {};
	const domains = settings.domains || {};
	const contact = settings.contact || {};
	const seo = settings.seo || {};

	const platformName = String(settings.general?.platformName || 'Chef IA').trim() || 'Chef IA';
	const supportEmail = String(settings.general?.supportEmail || '').trim();
	const contactEmail = String(contact.contactEmail || '').trim();

	return {
		platformName,
		platformLogoUrl: String(branding.platformLogoUrl || '').trim(),
		sidebarLogoUrl: String(branding.sidebarLogoUrl || '').trim(),
		loginLogoUrl: String(branding.loginLogoUrl || '').trim(),
		faviconUrl: String(branding.faviconUrl || '').trim(),
		supportEmail,
		contactEmail,
		primaryDomain: String(domains.primaryDomain || '').trim(),
		appUrl: String(domains.appUrl || '').trim(),
		documentationUrl: String(domains.documentationUrl || '').trim(),
		canonicalUrl: String(seo.canonicalUrl || '').trim(),
		seo: {
			browserTitle: String(seo.browserTitle || '').trim(),
			metaTitle: String(seo.metaTitle || '').trim(),
			metaDescription: String(seo.metaDescription || '').trim(),
			metaKeywords: String(seo.metaKeywords || '').trim(),
			canonicalUrl: String(seo.canonicalUrl || '').trim(),
			ogTitle: String(seo.ogTitle || '').trim(),
			ogDescription: String(seo.ogDescription || '').trim(),
			ogImageUrl: String(seo.ogImageUrl || '').trim(),
			twitterCardType: seo.twitterCardType === 'summary' ? 'summary' : 'summary_large_image',
			twitterTitle: String(seo.twitterTitle || '').trim(),
			twitterDescription: String(seo.twitterDescription || '').trim(),
			twitterImageUrl: String(seo.twitterImageUrl || '').trim(),
			googleSiteVerification: String(seo.googleSiteVerification || '').trim(),
			bingSiteVerification: String(seo.bingSiteVerification || '').trim(),
			pinterestSiteVerification: String(seo.pinterestSiteVerification || '').trim(),
			facebookDomainVerification: String(seo.facebookDomainVerification || '').trim(),
		},
		meta: {
			updatedAt: meta?.updatedAt || null,
			source: meta?.source || 'defaults',
		},
	};
}

export async function upsertPlatformSettings(nextSettings = {}, actor = {}) {
	const existing = await getSettingsRow();
	const currentRaw = existing?.payload || {};
	const current = normalizePayload(currentRaw);
	// Single Write Authority: Global Settings cannot mutate Control Plane–owned billing fields.
	const safeIncoming = stripControlPlaneBillingWrites(nextSettings || {}, currentRaw.billing || {});
	const merged = deepMerge(current, safeIncoming);

	// Preserve encrypted billing provider secrets from the raw row (not present on normalized current).
	if (currentRaw.billing?.providers) {
		merged.billing = merged.billing || {};
		merged.billing.providers = structuredClone(currentRaw.billing.providers);
	}
	if (Object.prototype.hasOwnProperty.call(currentRaw.billing || {}, 'provider')) {
		merged.billing.provider = currentRaw.billing.provider;
	}
	if (Object.prototype.hasOwnProperty.call(currentRaw.billing || {}, 'checkoutEnabled')) {
		merged.billing.checkoutEnabled = currentRaw.billing.checkoutEnabled;
	}
	if (Object.prototype.hasOwnProperty.call(currentRaw.billing || {}, 'webhookPath')) {
		merged.billing.webhookPath = currentRaw.billing.webhookPath;
	}

	if (safeIncoming?.email?.smtpPassword && !String(safeIncoming.email.smtpPassword).includes('•')) {
		merged.email.smtpPasswordCipher = encryptPinterestSecret(String(safeIncoming.email.smtpPassword).trim());
		merged.email.smtpPasswordSet = true;
	} else if (existing?.payload?.email?.smtpPasswordCipher) {
		merged.email.smtpPasswordCipher = existing.payload.email.smtpPasswordCipher;
		merged.email.smtpPasswordSet = true;
	}

	merged.email.smtpStatus = deriveSmtpStatus(merged.email);
	delete merged.email.smtpPassword;

	// Enforce identity SoT on write (general.* only).
	if (merged.branding && Object.prototype.hasOwnProperty.call(merged.branding, 'platformName')) {
		delete merged.branding.platformName;
	}
	if (merged.contact && Object.prototype.hasOwnProperty.call(merged.contact, 'supportEmail')) {
		delete merged.contact.supportEmail;
	}
	if (merged.branding && Object.prototype.hasOwnProperty.call(merged.branding, 'openGraphImageUrl')) {
		delete merged.branding.openGraphImageUrl;
	}
	merged.seo = normalizeSeoIdentity(merged.seo, {
		seo: merged.seo,
		branding: merged.branding,
	});

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

	await syncUsersRegistrationCreateRule(
		pocketbaseClient,
		merged.general?.allowRegistration !== false,
	);

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
