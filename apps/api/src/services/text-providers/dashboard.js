/**
 * Admin AI Runtime dashboard data (backend only — no UI redesign).
 */

import { getPlatformSettings, upsertPlatformSettings } from '../platform-settings.js';
import {
	isProviderConfigured,
	listProviders,
} from '../ai-providers.js';
import { isImplementedTextAdapter } from './adapters.js';
import {
	capabilitiesToFlags,
	normalizeProviderCapabilities,
} from './capabilities.js';
import {
	getRuntimeHealthState,
	listRuntimeHealthStates,
	syncRuntimeHealthFromProvider,
} from './health-state.js';
import {
	DEFAULT_RUNTIME_PRIORITY,
	normalizeRuntimePriorityList,
	orderProvidersByRuntimePriority,
	resolveDefaultProviderFromSettings,
	resolveRuntimePriorityOrder,
} from './priority.js';
import { discoverTextProviders } from './registry.js';
import { explainTextProviderSelection } from './selection.js';
import pocketbaseClient from '../../utils/pocketbaseClient.js';

/**
 * Persist Admin runtime priority order into platform settings and sync ai_providers.priority.
 * @param {string[]} order
 * @param {{ id?: string, email?: string, name?: string }} [actor]
 */
export async function setRuntimeProviderPriority(order, actor = {}) {
	const normalized = normalizeRuntimePriorityList(order);
	if (normalized.length === 0) {
		const error = new Error('runtimePriority must be a non-empty array of provider codes');
		error.status = 422;
		error.errorCode = 'VALIDATION_ERROR';
		throw error;
	}

	const { settings } = await upsertPlatformSettings({
		ai: {
			runtimePriority: normalized,
		},
	}, actor);

	const providers = await listProviders().catch(() => []);
	const byCode = new Map(providers.map((item) => [String(item.code).toLowerCase(), item]));

	await Promise.all(normalized.map(async (code, index) => {
		const provider = byCode.get(code);
		if (!provider?.id) return;
		const priority = (index + 1) * 10;
		if (Number(provider.priority) === priority) return;
		await pocketbaseClient.collection('ai_providers').update(provider.id, {
			priority,
		}).catch(() => null);
	}));

	return getAiRuntimeDashboard(settings);
}

export async function getRuntimePriority() {
	const { settings } = await getPlatformSettings();
	return {
		runtimePriority: resolveRuntimePriorityOrder(settings?.ai || null),
		default: DEFAULT_RUNTIME_PRIORITY,
		defaultProvider: settings?.ai?.defaultProvider || null,
		fallbackProvider: settings?.ai?.fallbackProvider || null,
	};
}

/**
 * Dashboard payload for Admin Console consumption.
 */
export async function getAiRuntimeDashboard(preloadedSettings = null) {
	const settings = preloadedSettings || (await getPlatformSettings()).settings;
	const aiSettings = settings?.ai || null;
	const providers = await listProviders().catch(() => []);
	const registry = await discoverTextProviders().catch(() => []);
	const registryByCode = new Map(registry.map((item) => [item.code, item]));

	for (const provider of providers) {
		const code = String(provider.code || '').toLowerCase();
		syncRuntimeHealthFromProvider(
			{ ...provider, configured: isProviderConfigured(provider) },
			{ available: isImplementedTextAdapter(code) },
		);
	}

	const ordered = orderProvidersByRuntimePriority(providers, aiSettings);
	const defaultProvider = resolveDefaultProviderFromSettings(ordered, aiSettings);
	const selection = explainTextProviderSelection(providers, aiSettings, {
		requestType: 'text',
		requireImplemented: true,
	});

	const providerRows = ordered.map((provider, index) => {
		const code = String(provider.code || '').toLowerCase();
		const registryEntry = registryByCode.get(code);
		const capabilities = normalizeProviderCapabilities(
			code,
			registryEntry?.capabilitiesDetailed || registryEntry?.capabilities,
		);
		const health = getRuntimeHealthState(code);
		const configured = isProviderConfigured(provider);

		return {
			code,
			name: provider.name || code,
			status: provider.status || (provider.enabled ? 'connected' : 'disconnected'),
			priority: index + 1,
			priorityWeight: Number(provider.priority) || ((index + 1) * 10),
			currentDefault: Boolean(
				defaultProvider
				&& String(defaultProvider.code).toLowerCase() === code,
			),
			health: {
				available: isImplementedTextAdapter(code),
				enabled: Boolean(provider.enabled),
				configured,
				healthy: health.healthy || String(provider.health || '').toLowerCase() === 'healthy',
				lastSuccessfulRequest: health.lastSuccessfulRequest || provider.lastSuccess || null,
				lastFailure: health.lastFailure
					|| (provider.lastError && provider.lastError !== '—'
						? { at: provider.lastChecked || null, message: provider.lastError }
						: null),
				latency: health.latencyMs ?? provider.lastLatencyMs ?? null,
				providerHealth: provider.health || 'unknown',
			},
			lastError: health.lastFailure?.message
				|| (provider.lastError && provider.lastError !== '—' ? provider.lastError : null),
			capabilities,
			capabilityFlags: capabilitiesToFlags(capabilities),
			usage: {
				requests: health.requestCount,
				successes: health.successCount,
				failures: health.failureCount,
				tokensPrompt: health.tokensPrompt,
				tokensCompletion: health.tokensCompletion,
				estimatedCostUsd: health.estimatedCostUsd,
			},
			fallbackCount: health.fallbackCount,
			implemented: isImplementedTextAdapter(code),
		};
	});

	const healthStates = listRuntimeHealthStates();
	const totals = healthStates.reduce((acc, item) => {
		acc.requests += item.requestCount;
		acc.successes += item.successCount;
		acc.failures += item.failureCount;
		acc.fallbacks += item.fallbackCount;
		acc.estimatedCostUsd += item.estimatedCostUsd;
		return acc;
	}, {
		requests: 0,
		successes: 0,
		failures: 0,
		fallbacks: 0,
		estimatedCostUsd: 0,
	});
	totals.estimatedCostUsd = Number(totals.estimatedCostUsd.toFixed(8));

	return {
		currentDefault: defaultProvider
			? { code: defaultProvider.code, name: defaultProvider.name }
			: null,
		runtimePriority: resolveRuntimePriorityOrder(aiSettings),
		failoverOrder: selection.selected,
		selection,
		providers: providerRows,
		totals,
		updatedAt: new Date().toISOString(),
	};
}
