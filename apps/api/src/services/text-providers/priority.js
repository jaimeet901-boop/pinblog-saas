/**
 * Admin-defined runtime provider priority (failover order).
 * Source of truth: platform_settings.ai.runtimePriority (ordered provider codes).
 */

import { PROVIDER_CATALOG } from '../ai-provider-catalog.js';
import { matchPreferredProvider } from '../ai-provider-readiness.js';

/** Default failover order when Admin has not set runtimePriority. */
export const DEFAULT_RUNTIME_PRIORITY = [
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
];

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeRuntimePriorityList(value) {
	const raw = Array.isArray(value) ? value : [];
	const seen = new Set();
	/** @type {string[]} */
	const ordered = [];
	for (const item of raw) {
		const code = String(item || '').trim().toLowerCase();
		if (!code || seen.has(code)) continue;
		seen.add(code);
		ordered.push(code);
	}
	return ordered;
}

/**
 * Resolve ordered provider codes from AI settings (or catalog default).
 * @param {object|null} aiSettings
 * @returns {string[]}
 */
export function resolveRuntimePriorityOrder(aiSettings) {
	const fromSettings = normalizeRuntimePriorityList(aiSettings?.runtimePriority);
	if (fromSettings.length > 0) {
		return fromSettings;
	}

	const fromCatalog = [...PROVIDER_CATALOG]
		.sort((a, b) => (Number(a.priority) || 999) - (Number(b.priority) || 999))
		.map((item) => item.code);
	const merged = normalizeRuntimePriorityList([...DEFAULT_RUNTIME_PRIORITY, ...fromCatalog]);
	return merged.length > 0 ? merged : [...DEFAULT_RUNTIME_PRIORITY];
}

/**
 * Sort provider rows by Admin runtimePriority. Unknown codes go last by numeric priority.
 * @param {object[]} providers
 * @param {object|null} aiSettings
 * @returns {object[]}
 */
export function orderProvidersByRuntimePriority(providers, aiSettings) {
	const order = resolveRuntimePriorityOrder(aiSettings);
	const rank = new Map(order.map((code, index) => [code, index]));

	return [...(Array.isArray(providers) ? providers : [])].sort((a, b) => {
		const ca = String(a?.code || '').toLowerCase();
		const cb = String(b?.code || '').toLowerCase();
		const ra = rank.has(ca) ? rank.get(ca) : 10_000 + (Number(a?.priority) || 999);
		const rb = rank.has(cb) ? rank.get(cb) : 10_000 + (Number(b?.priority) || 999);
		if (ra !== rb) return ra - rb;
		return ca.localeCompare(cb);
	});
}

/**
 * Resolve the Admin "current default" provider from settings (display / model hints).
 */
export function resolveDefaultProviderFromSettings(providers, aiSettings) {
	const preferred = matchPreferredProvider(
		providers,
		String(aiSettings?.defaultProvider || '').trim(),
	);
	if (preferred) return preferred;
	const ordered = orderProvidersByRuntimePriority(providers, aiSettings);
	return ordered[0] || null;
}
