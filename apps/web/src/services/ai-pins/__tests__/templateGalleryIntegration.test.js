import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/apiServerClient', () => ({
	default: {
		fetch: vi.fn(),
	},
}));

import { openDesignLibraryChooser } from '../previewService.js';
import {
	clearPersistedGalleryTemplateSelection,
	clearTemplateHydrationCache,
	fetchTemplateCached,
	getCachedHydratedTemplate,
	GALLERY_TEMPLATE_SESSION_KEY,
	persistGalleryTemplateSelection,
	readPersistedGalleryTemplateSelection,
	resolveGenerateTemplate,
} from '../templateHydration.js';

function createSessionStorageMock() {
	const store = new Map();
	return {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => { store.set(key, String(value)); },
		removeItem: (key) => { store.delete(key); },
		clear: () => { store.clear(); },
	};
}

describe('AI Pins Template Gallery integration', () => {
	beforeEach(() => {
		globalThis.sessionStorage = createSessionStorageMock();
		clearTemplateHydrationCache();
		clearPersistedGalleryTemplateSelection();
	});

	it('open gallery: Design Library seam reports available', () => {
		const bridge = openDesignLibraryChooser({ onSelect: () => {} });
		expect(bridge.available).toBe(true);
		expect(typeof bridge.onSelect).toBe('function');
		expect(bridge.message).toBe('');
	});

	it('select template: persists gallery selection id for refresh', () => {
		persistGalleryTemplateSelection({ id: 'tpl_gallery_1', source: 'gallery' });
		expect(readPersistedGalleryTemplateSelection()).toEqual({
			id: 'tpl_gallery_1',
			source: 'gallery',
		});
		expect(sessionStorage.getItem(GALLERY_TEMPLATE_SESSION_KEY)).toContain('tpl_gallery_1');
	});

	it('fetchTemplate success: hydrates full configuration and caches for the session', async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			id: 'tpl_ok',
			name: 'Gallery Hero',
			configuration: { schemaVersion: 2, layers: [{ id: 'title', type: 'text' }] },
		});

		const first = await fetchTemplateCached('tpl_ok', fetchFn);
		const second = await fetchTemplateCached('tpl_ok', fetchFn);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(first.configuration.layers).toHaveLength(1);
		expect(second).toBe(first);
		expect(getCachedHydratedTemplate('tpl_ok')?.name).toBe('Gallery Hero');
	});

	it('fetchTemplate failure: surfaces error and does not cache; selection id can remain', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error('Template not found'));
		persistGalleryTemplateSelection({ id: 'tpl_missing', source: 'gallery' });

		await expect(fetchTemplateCached('tpl_missing', fetchFn)).rejects.toThrow('Template not found');
		expect(getCachedHydratedTemplate('tpl_missing')).toBeNull();
		expect(readPersistedGalleryTemplateSelection()?.id).toBe('tpl_missing');

		await expect(fetchTemplateCached('tpl_missing', fetchFn)).rejects.toThrow('Template not found');
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('generate with selected template: uses hydrated configuration, never silent default', () => {
		const hydrated = {
			id: 'tpl_ok',
			name: 'Gallery Hero',
			configuration: {
				schemaVersion: 2,
				canvas: { width: 1000, height: 1500 },
				layers: [{ id: 'overlay', type: 'text', text: 'Hello' }],
			},
		};

		const resolved = resolveGenerateTemplate({
			gallerySelectionActive: true,
			hydratedTemplate: hydrated,
			hydrationError: '',
			studioTemplate: {
				id: 'studio_default',
				name: 'Studio Default',
				configuration: { schemaVersion: 1, layers: [] },
			},
		});

		expect(resolved.source).toBe('gallery');
		expect(resolved.id).toBe('tpl_ok');
		expect(resolved.name).toBe('Gallery Hero');
		expect(resolved.configuration.layers?.[0]?.id || resolved.configuration).toBeTruthy();
		expect(JSON.stringify(resolved.configuration)).not.toContain('studio_default');
	});

	it('generate with failed gallery selection: throws and does not fall back to default', () => {
		expect(() => resolveGenerateTemplate({
			gallerySelectionActive: true,
			hydratedTemplate: null,
			hydrationError: 'Template not found',
			studioTemplate: {
				id: 'studio_default',
				configuration: { schemaVersion: 1 },
			},
		})).toThrow('Template not found');

		expect(() => resolveGenerateTemplate({
			gallerySelectionActive: true,
			hydratedTemplate: { id: 'tpl_broken', name: 'Broken' },
			hydrationError: '',
			studioTemplate: null,
		})).toThrow(/could not be loaded/i);
	});

	it('refresh page: persisted gallery selection survives sessionStorage round-trip', () => {
		persistGalleryTemplateSelection({ id: 'tpl_refresh', source: 'gallery' });
		const restored = readPersistedGalleryTemplateSelection();
		expect(restored).toEqual({ id: 'tpl_refresh', source: 'gallery' });

		// Simulate remount reading session before hydrate completes
		clearTemplateHydrationCache();
		expect(readPersistedGalleryTemplateSelection()?.id).toBe('tpl_refresh');
	});

	it('backward compatibility: without gallery selection, studio/default path still works', () => {
		const resolvedEmpty = resolveGenerateTemplate({
			gallerySelectionActive: false,
			hydratedTemplate: null,
			studioTemplate: null,
		});
		expect(resolvedEmpty.source).toBe('studio');
		expect(resolvedEmpty.configuration).toBeTruthy();

		const resolvedStudio = resolveGenerateTemplate({
			gallerySelectionActive: false,
			studioTemplate: {
				id: 'studio_1',
				name: 'Studio Layout',
				configuration: { schemaVersion: 2, layers: [{ id: 'a', type: 'text' }] },
			},
		});
		expect(resolvedStudio.id).toBe('studio_1');
		expect(resolvedStudio.name).toBe('Studio Layout');
		expect(resolvedStudio.source).toBe('studio');
	});
});
