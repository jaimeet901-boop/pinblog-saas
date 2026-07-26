import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import TemplateGalleryCard from '@/components/templates/gallery/TemplateGalleryCard';
import TemplateGalleryEmpty, { TemplateGalleryLoading } from '@/components/templates/gallery/TemplateGalleryEmpty';
import TemplateGalleryFilters from '@/components/templates/gallery/TemplateGalleryFilters';
import TemplatePreviewModal from '@/components/templates/gallery/TemplatePreviewModal';
import {
	galleryApi,
	loadGalleryFirstPage,
	loadGalleryNextPage,
	patchGalleryItem,
	resetGalleryStore,
	setGalleryFilters,
	setPreviewTemplateId,
} from '@/services/templates/galleryStore';
import { useGalleryStore } from '@/services/templates/useGalleryStore';
import '@/pages/app/TemplatesPage.css';
import './PinTemplateChooser.css';

const SELECT_FILTERS = {
	status: 'published',
	includeArchived: false,
	sort: 'recently_updated',
};

/**
 * Read-only Template Gallery chooser for AI Pins workspace users.
 * Template CRUD remains in Admin Console / Templates page.
 */
export default function PinTemplateChooser({
	open,
	onClose,
	selectedId = '',
	onSelect,
	selecting = false,
	selectingId = '',
}) {
	const items = useGalleryStore((s) => s.items);
	const loading = useGalleryStore((s) => s.loading);
	const loadingMore = useGalleryStore((s) => s.loadingMore);
	const hasMore = useGalleryStore((s) => s.hasMore);
	const filters = useGalleryStore((s) => s.filters);
	const error = useGalleryStore((s) => s.error);
	const totalItems = useGalleryStore((s) => s.totalItems);
	const previewTemplateId = useGalleryStore((s) => s.previewTemplateId);
	const sentinelRef = useRef(null);
	const [localError, setLocalError] = useState('');

	const previewTemplate = items.find((item) => item.id === previewTemplateId) || null;

	const hasFilters = useMemo(() => Boolean(
		filters.q
		|| filters.category
		|| filters.scope
		|| filters.favorite
		|| filters.recentlyUsed
		|| filters.tag,
	), [filters]);

	useEffect(() => {
		if (!open) return undefined;
		setLocalError('');
		loadGalleryFirstPage({ ...SELECT_FILTERS });
		return () => {
			resetGalleryStore();
		};
	}, [open]);

	useEffect(() => {
		const node = sentinelRef.current;
		if (!open || !node) return undefined;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				loadGalleryNextPage();
			}
		}, { rootMargin: '240px' });
		observer.observe(node);
		return () => observer.disconnect();
	}, [open, items.length, hasMore]);

	if (!open) return null;

	async function handleFavorite(template) {
		try {
			const result = await galleryApi.favoriteTemplate(template.id);
			patchGalleryItem(template.id, { isFavorite: result.isFavorite });
		} catch (err) {
			setLocalError(err.message || 'Favorite failed');
		}
	}

	function handleFilterChange(partial) {
		setGalleryFilters({
			...partial,
			...SELECT_FILTERS,
		});
	}

	return (
		<div className="pin-tpl-chooser" role="dialog" aria-modal="true" aria-label="Choose template">
			<button type="button" className="pin-tpl-chooser__backdrop" aria-label="Close gallery" onClick={onClose} />
			<div className="pin-tpl-chooser__panel">
				<header className="pin-tpl-chooser__header">
					<div>
						<h2>Choose Template</h2>
						<p>Read-only gallery · {totalItems} templates · select one to use for generation</p>
					</div>
					<button type="button" className="pin-tpl-chooser__close" onClick={onClose} aria-label="Close">
						<X size={18} />
					</button>
				</header>

				<TemplateGalleryFilters
					mode="select"
					filters={filters}
					onChange={handleFilterChange}
				/>

				{error || localError ? (
					<p className="tpl-gallery-error" role="alert">{error || localError}</p>
				) : null}
				{loading ? <TemplateGalleryLoading /> : null}

				{!loading && items.length === 0 ? (
					<TemplateGalleryEmpty
						hasFilters={hasFilters}
						onCreate={null}
						onClear={() => loadGalleryFirstPage({
							q: '', category: '', scope: '', favorite: false, recentlyUsed: false, tag: '',
							...SELECT_FILTERS,
						})}
					/>
				) : null}

				{!loading && items.length > 0 ? (
					<div className="tpl-gallery-grid pin-tpl-chooser__grid">
						{items.map((template) => (
							<TemplateGalleryCard
								key={template.id}
								mode="select"
								template={template}
								selected={selectedId === template.id}
								busy={selecting && selectingId === template.id}
								onFavorite={handleFavorite}
								onPreview={(item) => setPreviewTemplateId(item.id)}
								onUse={(item) => onSelect?.(item)}
							/>
						))}
					</div>
				) : null}

				<div ref={sentinelRef} className="tpl-gallery-sentinel">
					{loadingMore ? 'Loading more…' : hasMore ? 'Scroll for more' : items.length ? 'End of gallery' : null}
				</div>

				<TemplatePreviewModal
					template={previewTemplate}
					onClose={() => setPreviewTemplateId(null)}
				/>
			</div>
		</div>
	);
}
