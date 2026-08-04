/**
 * Universal Text Provider Runtime.
 *
 * Application → AI Runtime → Provider Registry → Provider Adapter → Provider API
 *
 * Image generation stays in image-providers/* (separate runtime).
 */

import { PROVIDER_CATALOG } from '../ai-provider-catalog.js';
import {
	assertTextProviderConfigured,
	getPlatformProviderApiKey,
	isTextOrientedProvider,
	isProviderConfigured,
	listProviders,
	recordProviderRuntimeOutcome,
} from '../ai-providers.js';
import { resolveTextModelIdForProvider } from '../ai-models.js';
import logger from '../../utils/logger.js';
import {
	TEXT_ADAPTER_LOADERS,
	listImplementedTextAdapters,
} from './adapters.js';
import { isFailoverableTextError } from './contract.js';
import { isRetiredGeminiModel, normalizeGeminiModelId } from './gemini-models.js';
import {
	loadTextAdapter,
	discoverTextProviders,
	getTextProviderRegistrySnapshot,
} from './registry.js';
import { buildTextProviderFailoverChain } from './selection.js';
import { estimateRequestCostUsd, estimateTokenUsage } from './cost.js';
import { logAiRuntimeRequest } from './request-log.js';

export {
	listImplementedTextAdapters,
	discoverTextProviders,
	getTextProviderRegistrySnapshot,
	loadTextAdapter,
	buildTextProviderFailoverChain,
};
export { isFailoverableTextError } from './contract.js';
export {
	getAiRuntimeDashboard,
	getRuntimePriority,
	setRuntimeProviderPriority,
} from './dashboard.js';
export {
	normalizeProviderCapabilities,
	capabilitiesToFlags,
} from './capabilities.js';
export {
	resolveRuntimePriorityOrder,
	DEFAULT_RUNTIME_PRIORITY,
} from './priority.js';

/**
 * @typedef {{ role: string, content: string, images?: string[] }} ChatMessage
 */

/**
 * @typedef {{
 *   code: string,
 *   name: string,
 *   apiKey: string,
 *   baseUrl: string,
 *   model: string,
 *   modelSource: string,
 *   timeoutMs: number,
 * }} TextProviderRuntime
 */

function normalizeModelForProvider(code, modelId) {
	const normalizedCode = String(code || '').toLowerCase();
	const raw = String(modelId || '').trim();
	if (!raw) return '';
	if (normalizedCode === 'gemini') {
		return normalizeGeminiModelId(raw);
	}
	return raw;
}

async function loadPlatformAiSettings() {
	try {
		const { getPlatformSettings } = await import('../platform-settings.js');
		const { settings } = await getPlatformSettings();
		return settings?.ai || null;
	} catch {
		return null;
	}
}

/**
 * Build runtime credentials + model for one Admin provider row.
 * @returns {Promise<TextProviderRuntime>}
 */
export async function buildTextProviderRuntime(selected, aiSettings = null) {
	const code = String(selected.code || '').toLowerCase();
	const catalog = PROVIDER_CATALOG.find((item) => item.code === code);
	const apiKey = await getPlatformProviderApiKey(code);
	if (!apiKey) {
		const error = new Error(
			`Text provider ${selected.name || code} has no usable Admin API key. `
			+ 'Save credentials and enable the provider in Admin Settings.',
		);
		error.status = 400;
		error.errorCode = 'AI_TEXT_PROVIDER_KEY_MISSING';
		throw error;
	}

	const preferredHintRaw = String(
		aiSettings?.defaultModel
		|| aiSettings?.fallbackModel
		|| selected.currentModel
		|| '',
	).trim();

	const preferredHint = code === 'gemini'
		? (preferredHintRaw && !isRetiredGeminiModel(normalizeGeminiModelId(preferredHintRaw))
			? normalizeGeminiModelId(preferredHintRaw)
			: '')
		: preferredHintRaw;

	const resolvedModel = await resolveTextModelIdForProvider(code, {
		preferredModelId: preferredHint,
	});

	const model = normalizeModelForProvider(code, resolvedModel.modelId);
	if (!model) {
		const error = new Error(
			`No usable text model configured for provider ${selected.name || code} in Admin AI Models.`,
		);
		error.status = 400;
		error.errorCode = 'AI_TEXT_MODEL_MISSING';
		throw error;
	}

	return {
		code,
		name: selected.name || code,
		apiKey,
		baseUrl: String(selected.endpoint || catalog?.base_url || '').replace(/\/+$/, ''),
		model,
		modelSource: resolvedModel.source,
		timeoutMs: Number(selected.timeoutMs) || Number(catalog?.timeout_ms) || 60000,
	};
}

/**
 * Resolve the primary (first in failover chain) text provider runtime.
 * @returns {Promise<TextProviderRuntime>}
 */
export async function resolveTextProviderRuntime(options = {}) {
	const { chain, aiSettings } = await resolveFailoverCandidates(options);
	const runtime = await buildTextProviderRuntime(chain[0], aiSettings);
	logger.info('[text-runtime] Resolved primary text provider', {
		provider: runtime.code,
		providerName: runtime.name,
		model: runtime.model,
		modelSource: runtime.modelSource,
		failoverCandidates: chain.map((item) => item.code),
	});
	return runtime;
}

/**
 * @returns {Promise<{ chain: object[], aiSettings: object|null }>}
 */
async function resolveFailoverCandidates(options = {}) {
	const requestType = options.requestType || 'text';
	const providers = await listProviders().catch(() => []);
	const ready = providers.filter((item) => (
		isTextOrientedProvider(item.code) && isProviderConfigured(item)
	));

	if (ready.length === 0) {
		await assertTextProviderConfigured();
	}

	const aiSettings = await loadPlatformAiSettings();
	const chain = buildTextProviderFailoverChain(providers, aiSettings, {
		requestType,
		requireImplemented: true,
	});

	if (chain.length === 0) {
		const codes = ready.map((item) => item.code).join(', ') || 'none';
		const implemented = listImplementedTextAdapters().join(', ');
		const error = new Error(
			`No implemented text adapter for the configured providers (${codes}). `
			+ `Implemented adapters: ${implemented}. Enable Gemini or OpenAI in Admin Providers.`,
		);
		error.status = 503;
		error.errorCode = 'AI_TEXT_ADAPTER_UNAVAILABLE';
		throw error;
	}

	return { chain, aiSettings };
}

async function assertAdapterMethod(adapter, code, method) {
	if (typeof adapter[method] !== 'function') {
		const error = new Error(`Text adapter "${code}" is missing ${method}().`);
		error.status = 503;
		error.errorCode = 'AI_TEXT_ADAPTER_INVALID';
		throw error;
	}
	if (adapter.meta?.implemented === false) {
		const error = new Error(`Text adapter "${code}" is not implemented.`);
		error.status = 503;
		error.errorCode = 'AI_TEXT_ADAPTER_NOT_IMPLEMENTED';
		throw error;
	}
}

function persistRuntimeOutcome(code, outcome) {
	recordProviderRuntimeOutcome(code, outcome).catch(() => null);
}

/**
 * Stream text through the Universal Runtime with automatic failover.
 *
 * @param {{ systemPrompt: string, messages: ChatMessage[], options?: object }} params
 * @returns {AsyncGenerator<{ type: 'content', text: string, provider: TextProviderRuntime }>}
 */
export async function* streamTextWithRegistry({ systemPrompt, messages, options }) {
	const requestType = options?.requestType || 'stream';
	const { chain, aiSettings } = await resolveFailoverCandidates({ requestType });
	/** @type {Error|null} */
	let lastError = null;
	/** @type {string|null} */
	let previousFailureReason = null;

	for (let index = 0; index < chain.length; index += 1) {
		const candidate = chain[index];
		const code = String(candidate.code).toLowerCase();
		const isLast = index === chain.length - 1;
		const started = Date.now();
		let outputText = '';

		try {
			const runtime = await buildTextProviderRuntime(candidate, aiSettings);
			const adapter = await loadTextAdapter(runtime.code);
			await assertAdapterMethod(adapter, runtime.code, 'streamText');

			logger.info('[text-runtime] Starting text stream', {
				provider: runtime.code,
				model: runtime.model,
				modelSource: runtime.modelSource,
				attempt: index + 1,
				candidates: chain.length,
			});

			for await (const chunk of adapter.streamText({
				runtime,
				systemPrompt: String(systemPrompt || ''),
				messages: Array.isArray(messages) ? messages : [],
				options: options || {},
			})) {
				if (chunk?.type === 'content' && typeof chunk.text === 'string' && chunk.text) {
					outputText += chunk.text;
					yield { type: 'content', text: chunk.text, provider: runtime };
				}
			}

			const latencyMs = Date.now() - started;
			const tokens = estimateTokenUsage({
				systemPrompt,
				messages,
				outputText,
			});
			const costEstimate = estimateRequestCostUsd(runtime.code, tokens);
			logAiRuntimeRequest({
				provider: runtime.code,
				model: runtime.model,
				latencyMs,
				success: true,
				tokens,
				costEstimate,
				fallbackReason: previousFailureReason,
				requestType,
			});
			persistRuntimeOutcome(runtime.code, { ok: true, latencyMs });
			return;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			const latencyMs = Date.now() - started;
			const failover = !isLast && isFailoverableTextError(lastError);
			const fallbackReason = failover
				? `${code}: ${lastError.message}`.slice(0, 300)
				: null;

			logAiRuntimeRequest({
				provider: code,
				model: String(candidate.currentModel || ''),
				latencyMs,
				success: false,
				tokens: estimateTokenUsage({ systemPrompt, messages, outputText }),
				fallbackReason: previousFailureReason,
				requestType,
				errorMessage: lastError.message,
			});
			persistRuntimeOutcome(code, {
				ok: false,
				latencyMs,
				errorMessage: lastError.message,
			});

			logger.warn('[text-runtime] streamText provider attempt failed', {
				provider: code,
				attempt: index + 1,
				failover,
				status: lastError.status || null,
				errorCode: lastError.errorCode || null,
				message: lastError.message,
			});

			if (!failover) {
				throw lastError;
			}
			previousFailureReason = fallbackReason;
		}
	}

	throw lastError || new Error('Text stream failed for all providers');
}

/**
 * Non-streaming generateText with the same selection + failover policy.
 *
 * @param {{ systemPrompt?: string, messages: ChatMessage[], options?: object }} params
 * @returns {Promise<{ text: string, usage?: object|null, provider: TextProviderRuntime }>}
 */
export async function generateTextWithRegistry({ systemPrompt = '', messages, options }) {
	const requestType = options?.requestType || 'text';
	const { chain, aiSettings } = await resolveFailoverCandidates({ requestType });
	/** @type {Error|null} */
	let lastError = null;
	/** @type {string|null} */
	let previousFailureReason = null;

	for (let index = 0; index < chain.length; index += 1) {
		const candidate = chain[index];
		const code = String(candidate.code).toLowerCase();
		const isLast = index === chain.length - 1;
		const started = Date.now();

		try {
			const runtime = await buildTextProviderRuntime(candidate, aiSettings);
			const adapter = await loadTextAdapter(runtime.code);
			await assertAdapterMethod(adapter, runtime.code, 'generateText');

			logger.info('[text-runtime] Starting generateText', {
				provider: runtime.code,
				model: runtime.model,
				modelSource: runtime.modelSource,
				attempt: index + 1,
				candidates: chain.length,
			});

			const result = await adapter.generateText({
				runtime,
				systemPrompt: String(systemPrompt || ''),
				messages: Array.isArray(messages) ? messages : [],
				options: options || {},
			});

			const text = String(result?.text || '');
			const latencyMs = Date.now() - started;
			const tokens = estimateTokenUsage({
				systemPrompt,
				messages,
				outputText: text,
				usage: result?.usage,
			});
			const costEstimate = estimateRequestCostUsd(runtime.code, tokens);
			logAiRuntimeRequest({
				provider: runtime.code,
				model: runtime.model,
				latencyMs,
				success: true,
				tokens,
				costEstimate,
				fallbackReason: previousFailureReason,
				requestType,
			});
			persistRuntimeOutcome(runtime.code, { ok: true, latencyMs });

			return {
				text,
				usage: result?.usage ?? null,
				provider: runtime,
				meta: {
					latencyMs,
					tokens,
					costEstimate,
					fallbackReason: previousFailureReason,
				},
			};
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			const latencyMs = Date.now() - started;
			const failover = !isLast && isFailoverableTextError(lastError);
			const fallbackReason = failover
				? `${code}: ${lastError.message}`.slice(0, 300)
				: null;

			logAiRuntimeRequest({
				provider: code,
				model: String(candidate.currentModel || ''),
				latencyMs,
				success: false,
				tokens: estimateTokenUsage({ systemPrompt, messages }),
				fallbackReason: previousFailureReason,
				requestType,
				errorMessage: lastError.message,
			});
			persistRuntimeOutcome(code, {
				ok: false,
				latencyMs,
				errorMessage: lastError.message,
			});

			logger.warn('[text-runtime] generateText provider attempt failed', {
				provider: code,
				attempt: index + 1,
				failover,
				status: lastError.status || null,
				errorCode: lastError.errorCode || null,
				message: lastError.message,
			});

			if (!failover) {
				throw lastError;
			}
			previousFailureReason = fallbackReason;
		}
	}

	throw lastError || new Error('generateText failed for all providers');
}

/** Public aliases matching the universal interface. */
export const generateText = generateTextWithRegistry;
export const streamText = streamTextWithRegistry;

export async function countTokensWithRegistry({ text, providerCode }) {
	const code = String(providerCode || '').trim().toLowerCase();
	if (code && TEXT_ADAPTER_LOADERS[code]) {
		const adapter = await loadTextAdapter(code);
		if (typeof adapter.countTokens === 'function') {
			return adapter.countTokens({ text });
		}
	}
	const { estimateTokenCount } = await import('./contract.js');
	return estimateTokenCount(text);
}

export async function validateTextProvider(runtime) {
	const adapter = await loadTextAdapter(runtime.code);
	if (typeof adapter.validate !== 'function') {
		return { ok: Boolean(runtime?.apiKey && runtime?.model) };
	}
	return adapter.validate({ runtime });
}

export async function healthCheckTextProvider(runtime) {
	const adapter = await loadTextAdapter(runtime.code);
	if (typeof adapter.healthCheck !== 'function') {
		return validateTextProvider(runtime);
	}
	return adapter.healthCheck({ runtime });
}
