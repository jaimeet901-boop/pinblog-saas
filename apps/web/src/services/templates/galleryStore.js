/**
 * Gallery store — filters, selection, infinite scroll cursor.
 * Marketplace scopes are first-class filters (no architecture change later).
 */

import { setCachedPreview } from './previewCache.js';
import * as api from './templatesApi.js';

const DEFAULT_FILTERS = {
	q: '',
	category: '',
	status: '',
	visibility: '',
	scope: '',
	sort: 'recently_updated',
	favorite: false,
	recentlyUsed: false,
	tag: '',
	includeArchived: false,
};

function createState() {
	return {
		items: [],
		page: 0,
		perPage: 24,
		hasMore: true,
		totalItems: 0,
		loading: false,
		loadingMore: false,
		error: '',
		filters: { ...DEFAULT_FILTERS },
		facets: null,
		selectedIds: [],
		previewTemplateId: null,
	};
}

let state = createState();
const listeners = new Set();

function emit() {
	for (const listener of listeners) listener();
}

function setState(partial) {
	state = { ...state, ...partial };
	emit();
}

export function getGalleryState() {
	return state;
}

export function subscribeGallery(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function resetGalleryStore() {
	state = createState();
	emit();
}

function ingestItems(items) {
	for (const item of items) {
		if (item.previewCached && item.previewUrl && item.configChecksum) {
			setCachedPreview({
				templateId: item.id,
				configChecksum: item.configChecksum,
				imageUrl: item.previewUrl,
				source: 'server',
			});
		}
	}
}

export async function loadGalleryFirstPage(overrides = {}) {
	const filters = { ...state.filters, ...overrides };
	setState({
		loading: true,
		error: '',
		filters,
		page: 0,
		items: [],
		hasMore: true,
	});
	try {
		const payload = await api.fetchGalleryPage({ ...filters, page: 1, perPage: state.perPage });
		ingestItems(payload.items || []);
		setState({
			items: payload.items || [],
			page: payload.page || 1,
			hasMore: Boolean(payload.hasMore),
			totalItems: payload.totalItems || 0,
			facets: payload.facets || state.facets,
			loading: false,
			selectedIds: [],
		});
	} catch (error) {
		setState({ loading: false, error: error.message || 'Failed to load gallery' });
	}
}

export async function loadGalleryNextPage() {
	if (state.loading || state.loadingMore || !state.hasMore) return;
	setState({ loadingMore: true, error: '' });
	try {
		const nextPage = (state.page || 1) + 1;
		const payload = await api.fetchGalleryPage({
			...state.filters,
			page: nextPage,
			perPage: state.perPage,
		});
		ingestItems(payload.items || []);
		const incoming = payload.items || [];
		const seen = new Set(state.items.map((item) => item.id));
		const merged = [...state.items, ...incoming.filter((item) => !seen.has(item.id))];
		setState({
			items: merged,
			page: payload.page || nextPage,
			hasMore: Boolean(payload.hasMore),
			totalItems: payload.totalItems || state.totalItems,
			loadingMore: false,
		});
	} catch (error) {
		setState({ loadingMore: false, error: error.message || 'Failed to load more' });
	}
}

export function toggleGallerySelection(id) {
	const selected = new Set(state.selectedIds);
	if (selected.has(id)) selected.delete(id);
	else selected.add(id);
	setState({ selectedIds: [...selected] });
}

export function setGallerySelection(ids) {
	setState({ selectedIds: [...new Set(ids)] });
}

export function clearGallerySelection() {
	setState({ selectedIds: [] });
}

export function setPreviewTemplateId(id) {
	setState({ previewTemplateId: id });
}

export function patchGalleryItem(id, patch) {
	setState({
		items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
	});
}

export function removeGalleryItems(ids) {
	const remove = new Set(ids);
	setState({
		items: state.items.filter((item) => !remove.has(item.id)),
		selectedIds: state.selectedIds.filter((id) => !remove.has(id)),
	});
}

let filterDebounceTimer = null;
const DEBOUNCED_FILTER_KEYS = new Set(['q', 'tag']);

/**
 * Apply filters. Debounces text filters to reduce API chatter.
 */
export function setGalleryFilters(partial = {}) {
	const nextFilters = { ...state.filters, ...partial };
	setState({ filters: nextFilters });

	const keys = Object.keys(partial);
	const shouldDebounce = keys.length > 0 && keys.every((key) => DEBOUNCED_FILTER_KEYS.has(key));
	if (filterDebounceTimer) {
		clearTimeout(filterDebounceTimer);
		filterDebounceTimer = null;
	}
	if (shouldDebounce) {
		filterDebounceTimer = setTimeout(() => {
			filterDebounceTimer = null;
			loadGalleryFirstPage({});
		}, 320);
		return undefined;
	}
	return loadGalleryFirstPage({});
}

export { api as galleryApi };
