/** Adapter registry map (no PocketBase I/O). */

export const TEXT_ADAPTER_LOADERS = {
	gemini: () => import('./gemini.js'),
	// Future: openai, claude, openrouter, deepseek, mistral, grok
};

export function listImplementedTextAdapters() {
	return Object.keys(TEXT_ADAPTER_LOADERS);
}
