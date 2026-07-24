/**
 * Safe defaults for Workspace Config when the platform payload is missing or incomplete.
 * Modules must tolerate these — never crash on absent sections.
 */

export const WORKSPACE_CONFIG_DEFAULTS = {
	apiVersion: 'v1',
	configVersion: '0',
	updated_at: null,
	source: 'defaults',
	workspace_id: '',
	featureFlags: [],
	ai: {},
	images: {},
	content: {},
	pinterest: {},
	wordpress: {},
	security: {},
	prompts: {},
	publishingRules: {},
	schedulingDefaults: {},
	watermark: { enabled: false },
	typographyHints: {},
	textProviders: [],
	imageProviders: [],
	models: [],
	textModels: [],
	imageModels: [],
	credits: {
		balance: 0,
		quota: 0,
		used: 0,
		remaining: 0,
		planSlug: 'free',
		planName: 'Free',
	},
	limits: {},
	queueDefaults: { pollHintMs: 15000 },
	brandKits: [],
	templates: [],
	pinStyles: [],
	general: {
		platformName: 'Chef IA',
		defaultLanguage: 'en',
		timezone: 'UTC',
		maintenanceMode: false,
	},
};

export function mergeWorkspaceConfig(partial) {
	if (!partial || typeof partial !== 'object') {
		return { ...WORKSPACE_CONFIG_DEFAULTS };
	}
	return {
		...WORKSPACE_CONFIG_DEFAULTS,
		...partial,
		featureFlags: Array.isArray(partial.featureFlags) ? partial.featureFlags : WORKSPACE_CONFIG_DEFAULTS.featureFlags,
		textProviders: Array.isArray(partial.textProviders) ? partial.textProviders : WORKSPACE_CONFIG_DEFAULTS.textProviders,
		imageProviders: Array.isArray(partial.imageProviders) ? partial.imageProviders : WORKSPACE_CONFIG_DEFAULTS.imageProviders,
		models: Array.isArray(partial.models) ? partial.models : WORKSPACE_CONFIG_DEFAULTS.models,
		textModels: Array.isArray(partial.textModels) ? partial.textModels : WORKSPACE_CONFIG_DEFAULTS.textModels,
		imageModels: Array.isArray(partial.imageModels) ? partial.imageModels : WORKSPACE_CONFIG_DEFAULTS.imageModels,
		brandKits: Array.isArray(partial.brandKits) ? partial.brandKits : WORKSPACE_CONFIG_DEFAULTS.brandKits,
		templates: Array.isArray(partial.templates) ? partial.templates : WORKSPACE_CONFIG_DEFAULTS.templates,
		pinStyles: Array.isArray(partial.pinStyles) ? partial.pinStyles : WORKSPACE_CONFIG_DEFAULTS.pinStyles,
		credits: { ...WORKSPACE_CONFIG_DEFAULTS.credits, ...(partial.credits || {}) },
		limits: { ...WORKSPACE_CONFIG_DEFAULTS.limits, ...(partial.limits || {}) },
		prompts: { ...WORKSPACE_CONFIG_DEFAULTS.prompts, ...(partial.prompts || {}) },
		general: { ...WORKSPACE_CONFIG_DEFAULTS.general, ...(partial.general || {}) },
	};
}

export function isFeatureEnabledInConfig(config, flagId, fallback = false) {
	const flags = Array.isArray(config?.featureFlags) ? config.featureFlags : [];
	const match = flags.find((flag) => flag && flag.id === flagId);
	if (!match) return fallback;
	return Boolean(match.enabled);
}
