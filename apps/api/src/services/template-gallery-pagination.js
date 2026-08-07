/**
 * Pure in-memory pagination for channel-scoped gallery lists.
 * Filter first, then slice — guarantees correct totalItems/hasMore.
 */

export function paginateGalleryItems(items, page, perPage) {
	const totalItems = items.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
	const safePage = Math.min(Math.max(1, page), totalPages);
	const start = (safePage - 1) * perPage;
	return {
		items: items.slice(start, start + perPage),
		page: safePage,
		perPage,
		totalItems,
		totalPages,
		hasMore: safePage < totalPages,
	};
}
