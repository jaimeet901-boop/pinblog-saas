/**
 * Gallery template hydration for AI Pins.
 * Session-cached fetchTemplate + optional sessionStorage persistence.
 * Does not touch draft/publish/image-generation pipelines.
 */

import { fetchTemplate as fetchTemplateApi } from '@/services/templates/templatesApi.js';
import { createDefaultTemplateConfig, normalizeTemplateConfig } from '@/lib/pinTemplates';

const SESSION_KEY = 'pinblog.aiPins.galleryTemplate';

/** @type {Map<string, { status: 'pending'|'fulfilled', promise?: Promise<any>, value?: any }>} */
const hydrationCache = new Map();

export function clearTemplateHydrationCache() {
	hydrationCache.clear();
}

export function getCachedHydratedTemplate(id) {
	if (!id) return null;
	const entry = hydrationCache.get(id);
	return entry?.status === 'fulfilled' ? entry.value : null;
}

/**
 * fetchTemplate(id) with in-session cache. Successful responses are not refetched.
 * Failed fetches are not cached so the user can retry.
 */
export async function fetchTemplateCached(id, fetchFn = fetchTemplateApi) {
	const templateId = String(id || '').trim();
	if (!templateId) {
		throw new Error('Template id is required');
	}

	const existing = hydrationCache.get(templateId);
	if (existing?.status === 'fulfilled') {
		return existing.value;
	}
	if (existing?.status === 'pending' && existing.promise) {
		return existing.promise;
	}

	const promise = Promise.resolve()
		.then(() => fetchFn(templateId))
		.then((item) => {
			if (!item || typeof item !== 'object') {
				throw new Error('Template not found');
			}
			hydrationCache.set(templateId, { status: 'fulfilled', value: item });
			return item;
		})
		.catch((error) => {
			hydrationCache.delete(templateId);
			throw error;
		});

	hydrationCache.set(templateId, { status: 'pending', promise });
	return promise;
}

export function persistGalleryTemplateSelection(selection) {
	try {
		if (typeof sessionStorage === 'undefined') return;
		if (!selection?.id) {
			sessionStorage.removeItem(SESSION_KEY);
			return;
		}
		sessionStorage.setItem(SESSION_KEY, JSON.stringify({
			id: String(selection.id),
			source: 'gallery',
		}));
	} catch {
		// sessionStorage may be unavailable; selection still lives in React state
	}
}

export function readPersistedGalleryTemplateSelection() {
	try {
		if (typeof sessionStorage === 'undefined') return null;
		const raw = sessionStorage.getItem(SESSION_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed?.source === 'gallery' && parsed?.id) {
			return { id: String(parsed.id), source: 'gallery' };
		}
		return null;
	} catch {
		return null;
	}
}

export function clearPersistedGalleryTemplateSelection() {
	persistGalleryTemplateSelection(null);
}

/**
 * Resolve the template used for Preview / Generate / pin.templateConfig.
 * Gallery selection is optional — without it, behavior matches the legacy studio path.
 */
export function resolveGenerateTemplate({
	gallerySelectionActive = false,
	hydratedTemplate = null,
	hydrationError = '',
	studioTemplate = null,
} = {}) {
	if (gallerySelectionActive) {
		if (hydrationError) {
			throw new Error(hydrationError);
		}
		if (!hydratedTemplate?.configuration) {
			throw new Error(
				'Selected template could not be loaded. Choose another template or clear the gallery selection.',
			);
		}
		return {
			id: hydratedTemplate.id || '',
			name: hydratedTemplate.name || 'Pin Layout',
			templateUuid: hydratedTemplate.templateUuid || hydratedTemplate.template_uuid || '',
			configuration: normalizeTemplateConfig(hydratedTemplate.configuration),
			source: 'gallery',
		};
	}

	return {
		id: studioTemplate?.id || '',
		name: studioTemplate?.name || 'Pin Layout',
		templateUuid: studioTemplate?.templateUuid || studioTemplate?.template_uuid || '',
		configuration: normalizeTemplateConfig(
			studioTemplate?.configuration || createDefaultTemplateConfig(),
		),
		source: 'studio',
	};
}

export function isPremiumGalleryTemplate(template) {
	const meta = template?.marketplace?.meta || template?.marketplace_meta || {};
	return Boolean(template?.premium || meta.premium || meta.isPremium);
}

export { SESSION_KEY as GALLERY_TEMPLATE_SESSION_KEY };
