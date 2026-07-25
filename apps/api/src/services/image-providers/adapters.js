/** Image adapter registry map (no PocketBase I/O). */

export const IMAGE_ADAPTER_LOADERS = {
	openai: () => import('./openai.js').then((mod) => ({ generate: mod.generateWithOpenAI })),
	fal: () => import('./fal.js').then((mod) => ({ generate: mod.generateWithFal })),
	flux: () => import('./fal.js').then((mod) => ({ generate: mod.generateWithFal, forceModel: 'fal-ai/flux/dev' })),
	gemini: () => import('./gemini.js').then((mod) => ({ generate: mod.generateWithGemini })),
};

export function listImplementedImageAdapters() {
	return Object.keys(IMAGE_ADAPTER_LOADERS);
}

export function resolveImageAdapterCode(provider) {
	const name = String(provider || '').trim().toLowerCase();
	if (name === 'flux') return 'flux';
	if (name === 'fal') return 'fal';
	if (name === 'gemini' || name === 'google' || name === 'google gemini') return 'gemini';
	if (name === 'openai') return 'openai';
	return name;
}
