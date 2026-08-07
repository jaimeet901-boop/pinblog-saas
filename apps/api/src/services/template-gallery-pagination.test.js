import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { paginateGalleryItems } from './template-gallery-pagination.js';

describe('template-gallery-pagination', () => {
	const pinterestOnly = Array.from({ length: 100 }, (_, index) => ({ id: `p${index}` }));

	it('page 1 returns 24 items with correct totalItems and hasMore', () => {
		const page1 = paginateGalleryItems(pinterestOnly, 1, 24);
		assert.equal(page1.items.length, 24);
		assert.equal(page1.totalItems, 100);
		assert.equal(page1.totalPages, 5);
		assert.equal(page1.hasMore, true);
		assert.equal(page1.items[0].id, 'p0');
		assert.equal(page1.items[23].id, 'p23');
	});

	it('page 2 and page 3 continue the filtered list without gaps', () => {
		const page2 = paginateGalleryItems(pinterestOnly, 2, 24);
		const page3 = paginateGalleryItems(pinterestOnly, 3, 24);
		assert.equal(page2.items.length, 24);
		assert.equal(page2.items[0].id, 'p24');
		assert.equal(page2.items[23].id, 'p47');
		assert.equal(page3.items[0].id, 'p48');
		assert.equal(page3.hasMore, true);
	});

	it('last page returns remainder without empty pages', () => {
		const page5 = paginateGalleryItems(pinterestOnly, 5, 24);
		assert.equal(page5.items.length, 4);
		assert.equal(page5.items[0].id, 'p96');
		assert.equal(page5.hasMore, false);
	});

	it('mixed catalog filter-then-slice excludes non-channel rows before pagination', () => {
		const mixed = [
			...Array.from({ length: 50 }, (_, index) => ({ id: `fb${index}`, channel: 'facebook' })),
			...Array.from({ length: 100 }, (_, index) => ({ id: `pin${index}`, channel: 'pinterest' })),
		];
		const pinterestRows = mixed.filter((row) => row.channel === 'pinterest');
		const page1 = paginateGalleryItems(pinterestRows, 1, 24);
		const page5 = paginateGalleryItems(pinterestRows, 5, 24);
		assert.equal(page1.totalItems, 100);
		assert.equal(page1.items[0].id, 'pin0');
		assert.equal(page5.items.length, 4);
		assert.equal(page5.hasMore, false);
	});
});
