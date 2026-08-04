/**
 * Universal Text Runtime selection (pure — no PocketBase I/O).
 *
 * Pipeline:
 *   Request Type → Capabilities → Enabled → Configured → Healthy → Priority
 */

import { isProviderConfigured } from '../ai-provider-readiness.js';
import { TEXT_ADAPTER_LOADERS, isImplementedTextAdapter } from './adapters.js';
import {
	normalizeProviderCapabilities,
	providerSupportsRequestType,
} from './capabilities.js';
import { getRuntimeHealthState } from './health-state.js';
import { orderProvidersByRuntimePriority } from './priority.js';

function providerCapabilities(provider) {
	if (provider?.capabilities && typeof provider.capabilities === 'object'
		&& !Array.isArray(provider.capabilities)) {
		return normalizeProviderCapabilities(provider.code, provider.capabilities);
	}
	if (Array.isArray(provider?.capabilities)) {
		return normalizeProviderCapabilities(provider.code, provider.capabilities);
	}
	return normalizeProviderCapabilities(provider?.code);
}

function isEnabled(provider) {
	return Boolean(provider?.enabled);
}

function isConfigured(provider) {
	if (typeof provider?.configured === 'boolean') return provider.configured;
	return isProviderConfigured(provider);
}

function isHealthyProvider(provider) {
	const code = String(provider?.code || '').toLowerCase();
	const runtime = getRuntimeHealthState(code);
	if (runtime.requestCount > 0) {
		return Boolean(runtime.healthy);
	}
	const health = String(provider?.health || '').toLowerCase();
	if (health === 'healthy') return true;
	if (health === 'down' || health === 'error' || health === 'degraded') return false;
	// unknown → treat as eligible (not yet proven unhealthy)
	return true;
}

function isKnownUnhealthy(provider) {
	const code = String(provider?.code || '').toLowerCase();
	const runtime = getRuntimeHealthState(code);
	if (runtime.requestCount > 0 && !runtime.healthy) return true;
	const health = String(provider?.health || '').toLowerCase();
	return health === 'down' || health === 'error' || health === 'degraded';
}

/**
 * @param {object[]} providers Admin provider DTOs (or registry entries)
 * @param {object|null} aiSettings
 * @param {{
 *   requestType?: string,
 *   requireImplemented?: boolean,
 * }} [options]
 * @returns {object[]}
 */
export function buildTextProviderFailoverChain(providers, aiSettings, options = {}) {
	const requestType = options.requestType || 'text';
	const requireImplemented = options.requireImplemented !== false;
	const list = Array.isArray(providers) ? providers : [];

	/** @type {object[]} */
	let candidates = list.filter((item) => {
		const code = String(item?.code || '').toLowerCase();
		if (!code) return false;
		if (requireImplemented) {
			if (!isImplementedTextAdapter(code) || !TEXT_ADAPTER_LOADERS[code]) return false;
		}
		const caps = providerCapabilities(item);
		if (!providerSupportsRequestType(caps, requestType)) return false;
		if (!isEnabled(item)) return false;
		if (!isConfigured(item)) return false;
		return true;
	});

	const healthy = candidates.filter((item) => isHealthyProvider(item) && !isKnownUnhealthy(item));
	if (healthy.length > 0) {
		candidates = healthy;
	}

	return orderProvidersByRuntimePriority(candidates, aiSettings);
}

/**
 * Full visibility chain for dashboard (includes disabled / unconfigured / unhealthy).
 */
export function explainTextProviderSelection(providers, aiSettings, options = {}) {
	const requestType = options.requestType || 'text';
	const list = Array.isArray(providers) ? providers : [];
	const selected = buildTextProviderFailoverChain(list, aiSettings, options);

	return {
		requestType,
		runtimePriority: orderProvidersByRuntimePriority(list, aiSettings).map((item) => item.code),
		selected: selected.map((item) => item.code),
		stages: list.map((item) => {
			const code = String(item.code || '').toLowerCase();
			const caps = providerCapabilities(item);
			const capabilityOk = providerSupportsRequestType(caps, requestType);
			const enabled = isEnabled(item);
			const configured = isConfigured(item);
			const healthy = isHealthyProvider(item) && !isKnownUnhealthy(item);
			const implemented = isImplementedTextAdapter(code);
			return {
				code,
				capabilityOk,
				enabled,
				configured,
				healthy,
				implemented,
				selected: selected.some((row) => String(row.code).toLowerCase() === code),
			};
		}),
	};
}
