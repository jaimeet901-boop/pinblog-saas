/**
 * Text Provider Adapter registry map (no PocketBase I/O).
 * Implemented: gemini, openai. Placeholders: claude, openrouter, deepseek, replicate, ollama, huggingface.
 */

import { PLACEHOLDER_TEXT_ADAPTERS } from './placeholders.js';

export const TEXT_ADAPTER_LOADERS = {
	gemini: () => import('./gemini.js'),
	openai: () => import('./openai.js'),
	claude: async () => PLACEHOLDER_TEXT_ADAPTERS.claude,
	openrouter: async () => PLACEHOLDER_TEXT_ADAPTERS.openrouter,
	deepseek: async () => PLACEHOLDER_TEXT_ADAPTERS.deepseek,
	replicate: async () => PLACEHOLDER_TEXT_ADAPTERS.replicate,
	ollama: async () => PLACEHOLDER_TEXT_ADAPTERS.ollama,
	huggingface: async () => PLACEHOLDER_TEXT_ADAPTERS.huggingface,
};

/** Adapters that can fulfill live text requests today. */
export const IMPLEMENTED_TEXT_ADAPTER_CODES = ['gemini', 'openai'];

export function listImplementedTextAdapters() {
	return [...IMPLEMENTED_TEXT_ADAPTER_CODES];
}

export function listRegisteredTextAdapters() {
	return Object.keys(TEXT_ADAPTER_LOADERS);
}

export function isImplementedTextAdapter(code) {
	return IMPLEMENTED_TEXT_ADAPTER_CODES.includes(String(code || '').trim().toLowerCase());
}
