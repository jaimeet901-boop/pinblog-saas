import { PROVIDER_CATALOG } from '../ai-provider-catalog.js';
import {
	assertTextProviderConfigured,
	getPlatformProviderApiKey,
	isTextOrientedProvider,
	isProviderConfigured,
	listProviders,
	matchPreferredProvider,
} from '../ai-providers.js';
import { resolveTextModelIdForProvider } from '../ai-models.js';
import logger from '../../utils/logger.js';
import { TEXT_ADAPTER_LOADERS, listImplementedTextAdapters } from './adapters.js';
import { isRetiredGeminiModel, normalizeGeminiModelId } from './gemini-models.js';

export { listImplementedTextAdapters };

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

const ADAPTER_LOADERS = TEXT_ADAPTER_LOADERS;

/**
 * Resolve an enabled Admin text provider that has credentials AND a local adapter.
 * Model id comes from Admin AI Models (not hardcoded adapter defaults).
 *
 * @returns {Promise<TextProviderRuntime>}
 */
export async function resolveTextProviderRuntime() {
	const providers = await listProviders().catch(() => []);
	const ready = providers.filter((item) => (
		isTextOrientedProvider(item.code) && isProviderConfigured(item)
	));

	if (ready.length === 0) {
		await assertTextProviderConfigured();
	}

	let settings = null;
	try {
		const { getPlatformSettings } = await import('../platform-settings.js');
		({ settings } = await getPlatformSettings());
	} catch {
		settings = null;
	}

	const preferredName = String(
		settings?.ai?.defaultProvider
		|| settings?.ai?.fallbackProvider
		|| '',
	).trim();
	const preferredModelHint = normalizeGeminiModelId(
		settings?.ai?.defaultModel || settings?.ai?.fallbackModel || '',
	);

	const preferred = preferredName ? matchPreferredProvider(ready, preferredName) : null;
	const withAdapter = ready.filter((item) => Boolean(ADAPTER_LOADERS[String(item.code || '').toLowerCase()]));

	const selected = (preferred && ADAPTER_LOADERS[String(preferred.code).toLowerCase()] && preferred)
		|| withAdapter.find((item) => String(item.code).toLowerCase() === 'gemini')
		|| withAdapter[0]
		|| null;

	if (!selected) {
		const codes = ready.map((item) => item.code).join(', ') || 'none';
		const implemented = listImplementedTextAdapters().join(', ');
		const error = new Error(
			`No implemented text adapter for the configured providers (${codes}). `
			+ `Implemented adapters: ${implemented}. Enable Google Gemini in Admin Providers, or add an adapter.`,
		);
		error.status = 503;
		error.errorCode = 'AI_TEXT_ADAPTER_UNAVAILABLE';
		throw error;
	}

	const code = String(selected.code).toLowerCase();
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

	const hint = preferredModelHint && !isRetiredGeminiModel(preferredModelHint)
		? preferredModelHint
		: normalizeGeminiModelId(selected.currentModel || '');

	const resolvedModel = await resolveTextModelIdForProvider(code, {
		preferredModelId: isRetiredGeminiModel(hint) ? '' : hint,
	});

	const model = normalizeGeminiModelId(resolvedModel.modelId);
	if (!model) {
		const error = new Error(
			`No usable text model configured for provider ${selected.name || code} in Admin AI Models.`,
		);
		error.status = 400;
		error.errorCode = 'AI_TEXT_MODEL_MISSING';
		throw error;
	}

	logger.info('[text-providers] Resolved text generation model', {
		provider: code,
		providerName: selected.name || code,
		model,
		modelSource: resolvedModel.source,
	});

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
 * Stream text from the resolved Admin registry provider.
 *
 * @param {{ systemPrompt: string, messages: ChatMessage[] }} params
 * @returns {AsyncGenerator<{ type: 'content', text: string, provider: TextProviderRuntime }>}
 */
export async function* streamTextWithRegistry({ systemPrompt, messages }) {
	const runtime = await resolveTextProviderRuntime();
	const loader = ADAPTER_LOADERS[runtime.code];
	if (!loader) {
		const error = new Error(`Text adapter not implemented for provider "${runtime.code}".`);
		error.status = 503;
		error.errorCode = 'AI_TEXT_ADAPTER_UNAVAILABLE';
		throw error;
	}

	const adapter = await loader();
	if (typeof adapter.streamText !== 'function') {
		const error = new Error(`Text adapter "${runtime.code}" is missing streamText().`);
		error.status = 503;
		error.errorCode = 'AI_TEXT_ADAPTER_INVALID';
		throw error;
	}

	logger.info('[text-providers] Starting text stream', {
		provider: runtime.code,
		model: runtime.model,
		modelSource: runtime.modelSource,
	});

	for await (const chunk of adapter.streamText({
		runtime,
		systemPrompt: String(systemPrompt || ''),
		messages: Array.isArray(messages) ? messages : [],
	})) {
		if (chunk?.type === 'content' && typeof chunk.text === 'string' && chunk.text) {
			yield { type: 'content', text: chunk.text, provider: runtime };
		}
	}
}
