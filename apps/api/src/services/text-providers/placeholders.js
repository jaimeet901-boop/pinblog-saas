/**
 * Placeholder text adapters — discoverable in the registry, not callable yet.
 */

import { createNotImplementedAdapter } from './contract.js';
import { normalizeProviderCapabilities } from './capabilities.js';

function placeholder(code, name) {
	return createNotImplementedAdapter({
		code,
		name,
		capabilities: normalizeProviderCapabilities(code),
	});
}

export const claude = placeholder('claude', 'Anthropic Claude');
export const openrouter = placeholder('openrouter', 'OpenRouter');
export const deepseek = placeholder('deepseek', 'DeepSeek');
export const replicate = placeholder('replicate', 'Replicate');
export const ollama = placeholder('ollama', 'Ollama');
export const huggingface = placeholder('huggingface', 'Hugging Face');

export const PLACEHOLDER_TEXT_ADAPTERS = {
	claude,
	openrouter,
	deepseek,
	replicate,
	ollama,
	huggingface,
};
