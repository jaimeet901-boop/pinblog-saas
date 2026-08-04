/**
 * Text Provider Registry — discover / load / metadata / capabilities / health / enabled.
 */

import { PROVIDER_CATALOG } from '../ai-provider-catalog.js';
import {
	isTextOrientedProvider,
	isProviderConfigured,
	listProviders,
} from '../ai-providers.js';
import {
	TEXT_ADAPTER_LOADERS,
	listImplementedTextAdapters,
	listRegisteredTextAdapters,
	isImplementedTextAdapter,
} from './adapters.js';
import {
	capabilitiesToFlags,
	normalizeProviderCapabilities,
} from './capabilities.js';
import {
	getRuntimeHealthState,
	syncRuntimeHealthFromProvider,
} from './health-state.js';
import { resolveRuntimePriorityOrder } from './priority.js';

/**
 * @typedef {{
 *   code: string,
 *   name: string,
 *   implemented: boolean,
 *   capabilities: string[],
 *   capabilitiesDetailed: object,
 *   enabled: boolean,
 *   configured: boolean,
 *   healthy: boolean,
 *   priority: number,
 *   catalog?: object,
 *   provider?: object,
 *   health?: object,
 * }} TextProviderRegistryEntry
 */

export async function loadTextAdapter(code) {
	const normalized = String(code || '').trim().toLowerCase();
	const loader = TEXT_ADAPTER_LOADERS[normalized];
	if (!loader) {
		const error = new Error(`Text adapter not registered for provider "${normalized || 'unknown'}".`);
		error.status = 503;
		error.errorCode = 'AI_TEXT_ADAPTER_UNAVAILABLE';
		throw error;
	}
	const adapter = await loader();
	return adapter;
}

export function getTextAdapterMeta(adapter, code) {
	const meta = adapter?.meta || {};
	const capabilitiesDetailed = meta.capabilitiesDetailed
		|| normalizeProviderCapabilities(meta.code || code, meta.capabilities);
	return {
		code: String(meta.code || code || '').toLowerCase(),
		name: String(meta.name || code || ''),
		implemented: meta.implemented !== false && isImplementedTextAdapter(meta.code || code),
		capabilities: Array.isArray(meta.capabilities)
			? meta.capabilities
			: capabilitiesToFlags(capabilitiesDetailed),
		capabilitiesDetailed,
	};
}

/**
 * Discover all registered text adapters merged with Admin provider rows.
 * @returns {Promise<TextProviderRegistryEntry[]>}
 */
export async function discoverTextProviders() {
	const providers = await listProviders().catch(() => []);
	const byCode = new Map(
		providers.map((item) => [String(item.code || '').toLowerCase(), item]),
	);

	const codes = new Set([
		...listRegisteredTextAdapters(),
		...providers.filter((item) => isTextOrientedProvider(item.code)).map((item) => String(item.code).toLowerCase()),
	]);

	/** @type {TextProviderRegistryEntry[]} */
	const entries = [];

	for (const code of codes) {
		const catalog = PROVIDER_CATALOG.find((item) => item.code === code);
		const provider = byCode.get(code) || null;
		const registered = Boolean(TEXT_ADAPTER_LOADERS[code]);
		let capabilitiesDetailed = normalizeProviderCapabilities(code);
		let capabilities = capabilitiesToFlags(capabilitiesDetailed);
		let name = catalog?.name || provider?.name || code;
		let implemented = isImplementedTextAdapter(code);

		if (registered) {
			try {
				const adapter = await loadTextAdapter(code);
				const meta = getTextAdapterMeta(adapter, code);
				capabilities = meta.capabilities;
				capabilitiesDetailed = meta.capabilitiesDetailed;
				name = meta.name || name;
				implemented = meta.implemented;
			} catch {
				implemented = false;
			}
		} else {
			implemented = false;
		}

		const configured = provider ? isProviderConfigured(provider) : false;
		if (provider) {
			syncRuntimeHealthFromProvider(
				{ ...provider, configured },
				{ available: implemented },
			);
		}
		const health = getRuntimeHealthState(code);

		entries.push({
			code,
			name,
			implemented,
			capabilities,
			capabilitiesDetailed,
			enabled: Boolean(provider?.enabled),
			configured,
			healthy: health.healthy || String(provider?.health || '').toLowerCase() === 'healthy',
			priority: Number(provider?.priority) || Number(catalog?.priority) || 999,
			catalog: catalog || null,
			provider: provider || null,
			health: {
				available: implemented,
				enabled: Boolean(provider?.enabled),
				configured,
				healthy: health.healthy || String(provider?.health || '').toLowerCase() === 'healthy',
				lastSuccessfulRequest: health.lastSuccessfulRequest,
				lastFailure: health.lastFailure,
				latency: health.latencyMs ?? provider?.lastLatencyMs ?? null,
			},
		});
	}

	return entries.sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
}

export async function getTextProviderRegistrySnapshot() {
	const entries = await discoverTextProviders();
	let runtimePriority = null;
	try {
		const { getPlatformSettings } = await import('../platform-settings.js');
		const { settings } = await getPlatformSettings();
		runtimePriority = resolveRuntimePriorityOrder(settings?.ai || null);
	} catch {
		runtimePriority = resolveRuntimePriorityOrder(null);
	}

	return {
		implemented: listImplementedTextAdapters(),
		registered: listRegisteredTextAdapters(),
		runtimePriority,
		providers: entries,
	};
}

export {
	listImplementedTextAdapters,
	listRegisteredTextAdapters,
	isImplementedTextAdapter,
};
