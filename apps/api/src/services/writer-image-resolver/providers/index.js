/**
 * Writer Image Resolver — provider registry (M2-B).
 */

import { resolveFalSlot } from './fal-adapter.js';
import { resolvePexelsSlot } from './stock-pexels.js';

export const PROVIDER_IDS = Object.freeze({
	FAL: 'fal',
	PEXELS: 'pexels',
});

/**
 * @param {string} id
 * @returns {null | { id: string, resolve: Function }}
 */
export function getProvider(id) {
	const code = String(id || '').trim().toLowerCase();
	if (code === PROVIDER_IDS.FAL) {
		return { id: PROVIDER_IDS.FAL, resolve: resolveFalSlot };
	}
	if (code === PROVIDER_IDS.PEXELS || code === 'stock_pexels') {
		return { id: PROVIDER_IDS.PEXELS, resolve: resolvePexelsSlot };
	}
	return null;
}

export function listProviders() {
	return [
		{ id: PROVIDER_IDS.PEXELS, role: 'stock_preferred' },
		{ id: PROVIDER_IDS.FAL, role: 'ai_fallback' },
	];
}

export { resolveFalSlot, resolvePexelsSlot };
