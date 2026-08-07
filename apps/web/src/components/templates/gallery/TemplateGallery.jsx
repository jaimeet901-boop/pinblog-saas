import { useEffect, useMemo, useRef } from 'react';
import TemplateGalleryCard from './TemplateGalleryCard';
import TemplateGalleryEmpty, { TemplateGalleryLoading } from './TemplateGalleryEmpty';
import TemplateGalleryFilters from './TemplateGalleryFilters';
import TemplatePreviewModal from './TemplatePreviewModal';
import {
	clearGallerySelection,
	loadGalleryFirstPage,
	loadGalleryNextPage,
	setGalleryFilters,
	setPreviewTemplateId,
	toggleGallerySelection,
} from '@/services/templates/galleryStore';
import { useGalleryStore } from '@/services/templates/useGalleryStore';
import {
	PRODUCT_EVENTS,
	trackProductEvent,
} from '@/lib/productAnalytics';

export default function TemplateGallery({
	onCreate,
	onFavorite,
	onDuplicate,
	onDelete,
	onArchive,
	onExport,
	onRename,
	onTouch,
	onBulk,
	onUpgradeRequest,
}) {
	const items = useGalleryStore((s) => s.items);
	const loading = useGalleryStore((s) => s.loading);
	const loadingMore = useGalleryStore((s) => s.loadingMore);
	const hasMore = useGalleryStore((s) => s.hasMore);
	const filters = useGalleryStore((s) => s.filters);
	const selectedIds = useGalleryStore((s) => s.selectedIds);
	const error = useGalleryStore((s) => s.error);
	const totalItems = useGalleryStore((s) => s.totalItems);
	const previewTemplateId = useGalleryStore((s) => s.previewTemplateId);
	const sentinelRef = useRef(null);
	const viewedRef = useRef(false);

	const previewTemplate = items.find((item) => item.id === previewTemplateId) || null;

	const hasFilters = useMemo(() => Boolean(
		filters.q
		|| filters.category
		|| filters.status
		|| filters.visibility
		|| filters.scope
		|| filters.favorite
		|| filters.recentlyUsed
		|| filters.tag
		|| filters.includeArchived,
	), [filters]);

	useEffect(() => {
		if (viewedRef.current) return;
		viewedRef.current = true;
		trackProductEvent(
			PRODUCT_EVENTS.TEMPLATE_GALLERY_VIEW,
			{ sourcePage: 'templates_gallery' },
			{ dedupeKey: 'template_gallery_view:templates_gallery' },
		);
	}, []);

	useEffect(() => {
		const node = sentinelRef.current;
		if (!node) return undefined;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				loadGalleryNextPage();
			}
		}, { rootMargin: '240px' });
		observer.observe(node);
		return () => observer.disconnect();
	}, [items.length, hasMore]);

	return (
		<div className="tpl-gallery">
			<div className="tpl-gallery-toolbar">
				<div>
					<h1>Template Gallery</h1>
					<p>{totalItems} templates · infinite scroll · marketplace-ready scopes</p>
				</div>
				<div className="tpl-gallery-toolbar__actions">
					<button type="button" className="is-primary" onClick={onCreate}>New template</button>
				</div>
			</div>

			<TemplateGalleryFilters
				filters={filters}
				onChange={(partial) => setGalleryFilters(partial)}
			/>

			{selectedIds.length > 0 ? (
				<div className="tpl-gallery-bulk">
					<span>{selectedIds.length} selected</span>
					<button type="button" onClick={() => onBulk('duplicate', selectedIds)}>Duplicate</button>
					<button type="button" onClick={() => onBulk('export', selectedIds)}>Export</button>
					<button type="button" onClick={() => onBulk('archive', selectedIds)}>Archive</button>
					<button type="button" onClick={() => onBulk('restore', selectedIds)}>Restore</button>
					<button type="button" onClick={() => onBulk('delete', selectedIds)}>Delete</button>
					<button type="button" onClick={() => clearGallerySelection()}>Clear</button>
				</div>
			) : null}

			{error ? <p className="tpl-gallery-error">{error}</p> : null}
			{loading ? <TemplateGalleryLoading /> : null}

			{!loading && items.length === 0 ? (
				<TemplateGalleryEmpty
					hasFilters={hasFilters}
					onCreate={onCreate}
					onClear={() => loadGalleryFirstPage({
						q: '', category: '', status: '', visibility: '', scope: '',
						favorite: false, recentlyUsed: false, tag: '', includeArchived: false,
						sort: 'recently_updated',
						channel: filters.channel || '',
					})}
				/>
			) : null}

			{!loading && items.length > 0 ? (
				<div className="tpl-gallery-grid">
					{items.map((template) => (
						<TemplateGalleryCard
							key={template.id}
							template={template}
							selected={selectedIds.includes(template.id)}
							onToggleSelect={toggleGallerySelection}
							onFavorite={onFavorite}
							onDuplicate={onDuplicate}
							onDelete={onDelete}
							onArchive={onArchive}
							onExport={onExport}
							onRename={onRename}
							onPreview={(item) => setPreviewTemplateId(item.id)}
							onTouch={onTouch}
							onUpgradeRequest={onUpgradeRequest}
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
				sourcePage="templates_gallery"
			/>
		</div>
	);
}