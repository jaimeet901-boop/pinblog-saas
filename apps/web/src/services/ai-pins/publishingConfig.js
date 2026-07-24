/**
 * Normalize Pinterest publishing settings from Workspace Config only.
 * Admin → platform_settings → /workspace/v1/config → here.
 * Never duplicate Admin publishing policy in module-local storage.
 */

const DEFAULT_WINDOWS = [
	{ days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '20:00' },
];

function asNumber(value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseRetryPolicy(raw) {
	const text = String(raw || '2 linear').trim().toLowerCase();
	const match = text.match(/(\d+)\s*(exponential|linear|fixed)?/);
	return {
		maxAttempts: match ? Math.max(1, Number(match[1]) || 2) : 2,
		strategy: match?.[2] || 'linear',
		raw: String(raw || '2 linear'),
	};
}

function normalizeWindows(raw) {
	if (!Array.isArray(raw) || raw.length === 0) {
		return DEFAULT_WINDOWS.map((item) => ({ ...item, days: [...item.days] }));
	}
	return raw
		.map((item) => {
			const days = Array.isArray(item?.days)
				? item.days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
				: [0, 1, 2, 3, 4, 5, 6];
			return {
				days: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
				start: String(item?.start || '08:00').slice(0, 5),
				end: String(item?.end || '20:00').slice(0, 5),
			};
		})
		.filter(Boolean);
}

function mapFeatureFlags(config) {
	const flags = Array.isArray(config?.featureFlags) ? config.featureFlags : [];
	const byId = {};
	for (const flag of flags) {
		if (!flag?.id) continue;
		byId[flag.id] = Boolean(flag.enabled);
	}
	return {
		pinterest: byId.pinterest !== false,
		calendar: byId.calendar !== false,
		history: byId.history !== false,
		analytics: byId.analytics !== false,
		templates: byId.templates !== false,
		'ai-images': byId['ai-images'] !== false,
		raw: flags,
	};
}

/**
 * @param {object} config - Workspace Config DTO from useWorkspaceConfig()
 */
export function resolvePublishingConfig(config) {
	const pinterest = config?.publishingRules?.pinterest || config?.pinterest || {};
	const scheduling = config?.schedulingDefaults || {};
	const queue = config?.queueDefaults || {};
	const general = config?.general || {};

	return {
		configVersion: String(config?.configVersion || '0'),
		timezone: String(
			scheduling.timezone
			|| general.timezone
			|| 'UTC',
		),
		schedulingMode: String(scheduling.pinterestScheduling || pinterest.scheduling || 'smart-slots'),
		defaultBoard: String(pinterest.defaultBoard || ''),
		retryPolicy: parseRetryPolicy(pinterest.retryPolicy),
		dailyLimit: asNumber(pinterest.dailyLimit, 50),
		intervalMinutes: asNumber(pinterest.intervalMinutes, 30),
		publishingWindows: normalizeWindows(pinterest.publishingWindows),
		autoPublish: Boolean(pinterest.autoPublish),
		pollHintMs: asNumber(queue.pollHintMs, 15000),
		queueDefaults: {
			pollHintMs: asNumber(queue.pollHintMs, 15000),
		},
		imageRatio: String(pinterest.imageRatio || '2:3'),
		pinTemplate: String(pinterest.pinTemplate || ''),
		featureFlags: mapFeatureFlags(config),
	};
}
