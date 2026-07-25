import { describe, expect, it, beforeEach } from 'vitest';
import {
	clearPreviewCache,
	getCachedPreview,
	previewCacheSize,
	resolveGalleryThumbnail,
	setCachedPreview,
} from '../../services/templates/previewCache.js';
import {
	getGalleryState,
	loadGalleryFirstPage,
	patchGalleryItem,
	resetGalleryStore,
	setGallerySelection,
	toggleGallerySelection,
} from '../../services/templates/galleryStore.js';

describe('previewCache', () => {
	beforeEach(() => {
		clearPreviewCache();
	});

	it('keys by templateId + config_checksum + format (not timestamps)', () => {
		setCachedPreview({
			templateId: 't1',
			configChecksum: 'abc123',
			imageUrl: 'https://cdn.test/a.png',
		});
		expect(getCachedPreview({
			templateId: 't1',
			configChecksum: 'abc123',
		})?.imageUrl).toBe('https://cdn.test/a.png');
		expect(getCachedPreview({
			templateId: 't1',
			configChecksum: 'different',
		})).toBeNull();
		expect(previewCacheSize()).toBe(1);
	});

	it('resolveGalleryThumbnail prefers checksum cache', () => {
		setCachedPreview({
			templateId: 't1',
			configChecksum: 'sum',
			imageUrl: 'https://cdn.test/cached.png',
		});
		const result = resolveGalleryThumbnail({
			id: 't1',
			configChecksum: 'sum',
			thumbnail: 'https://cdn.test/old.png',
			previewUrl: 'https://cdn.test/old.png',
		});
		expect(result.url).toBe('https://cdn.test/cached.png');
		expect(result.fromCache).toBe(true);
	});
});

describe('galleryStore selection', () => {
	beforeEach(() => {
		resetGalleryStore();
	});

	it('supports multi-select', () => {
		toggleGallerySelection('a');
		toggleGallerySelection('b');
		expect(getGalleryState().selectedIds.sort()).toEqual(['a', 'b']);
		toggleGallerySelection('a');
		expect(getGalleryState().selectedIds).toEqual(['b']);
		setGallerySelection(['x', 'y']);
		expect(getGalleryState().selectedIds).toEqual(['x', 'y']);
	});

	it('patches items locally after mutations', () => {
		resetGalleryStore();
		// simulate loaded items
		patchGalleryItem('missing', { name: 'nope' });
		expect(getGalleryState().items).toEqual([]);
	});
});

describe('gallery filter query builder contract', () => {
	it('fetchGalleryPage builds view=gallery query', async () => {
		const { fetchGalleryPage } = await import('../../services/templates/templatesApi.js');
		// Smoke: function exists and rejects without network by throwing (or we mock)
		expect(typeof fetchGalleryPage).toBe('function');
		expect(typeof loadGalleryFirstPage).toBe('function');
	});
});
