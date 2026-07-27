/**
 * Regression: chooser IntersectionObserver must not request page 2 while page is still 0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchGalleryPage = vi.fn();

vi.mock('../templatesApi.js', () => ({
	fetchGalleryPage: (...args) => fetchGalleryPage(...args),
	fetchTemplate: vi.fn(),
	duplicateTemplate: vi.fn(),
	deleteTemplate: vi.fn(),
	renameTemplate: vi.fn(),
	favoriteTemplate: vi.fn(),
	setTemplateStatus: vi.fn(),
	touchTemplate: vi.fn(),
	exportTemplate: vi.fn(),
	bulkTemplateAction: vi.fn(),
	createGalleryTemplate: vi.fn(),
	lookupPreviewCache: vi.fn(),
}));

vi.mock('../previewCache.js', () => ({
	setCachedPreview: vi.fn(),
	getCachedPreview: vi.fn(),
	clearPreviewCache: vi.fn(),
	previewCacheSize: vi.fn(),
	resolveGalleryThumbnail: vi.fn(),
}));

describe('galleryStore chooser race', () => {
	beforeEach(async () => {
		fetchGalleryPage.mockReset();
		const store = await import('../galleryStore.js');
		store.resetGalleryStore();
	});

	it('loadGalleryNextPage with page=0 does not fetch page 2', async () => {
		const store = await import('../galleryStore.js');
		fetchGalleryPage.mockResolvedValue({
			items: [{ id: 'a', name: 'One', configChecksum: '', previewCached: false }],
			page: 1,
			perPage: 24,
			totalItems: 1,
			hasMore: false,
		});

		await store.loadGalleryNextPage();
		expect(fetchGalleryPage).not.toHaveBeenCalled();

		await store.loadGalleryFirstPage({
			includeArchived: false,
			sort: 'recently_updated',
			q: '',
			category: '',
			scope: '',
			status: '',
		});
		expect(fetchGalleryPage).toHaveBeenCalledTimes(1);
		expect(fetchGalleryPage.mock.calls[0][0].page).toBe(1);
		expect(store.getGalleryState().items.map((item) => item.id)).toEqual(['a']);
	});

	it('reset invalidates in-flight first page responses', async () => {
		const store = await import('../galleryStore.js');
		let resolveFetch;
		fetchGalleryPage.mockImplementation(() => new Promise((resolve) => {
			resolveFetch = resolve;
		}));

		const loadPromise = store.loadGalleryFirstPage({});
		store.resetGalleryStore();
		resolveFetch({
			items: [{ id: 'late', name: 'Late', configChecksum: '', previewCached: false }],
			page: 1,
			perPage: 24,
			totalItems: 1,
			hasMore: false,
		});
		await loadPromise;
		expect(store.getGalleryState().items).toEqual([]);
	});
});
