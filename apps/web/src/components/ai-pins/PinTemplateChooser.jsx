import { useEffect, useMemo, useRef, useState } from 'react';
import { Library, X } from 'lucide-react';
import TemplateGalleryEmpty, { TemplateGalleryLoading } from '@/components/templates/gallery/TemplateGalleryEmpty';
import TemplatePreviewModal from '@/components/templates/gallery/TemplatePreviewModal';
import PinTemplateChooserLiveCard from '@/components/ai-pins/PinTemplateChooserLiveCard';
import {
	loadGalleryFirstPage,
	loadGalleryNextPage,
	resetGalleryStore,
	setGalleryFilters,
	setPreviewTemplateId,
} from '@/services/templates/galleryStore';
import { useGalleryStore } from '@/services/templates/useGalleryStore';
import { revokeGalleryLivePreviewUrls } from '@/services/ai-pins/galleryLivePreview';
import { TEMPLATE_CATEGORIES } from '@/lib/pinEngineConstants';
import '@/pages/app/TemplatesPage.css';
import './PinTemplateChooser.css';

// Exact same filter surface as Admin Template Gallery (TemplatesPage → loadGalleryFirstPage).
const SELECT_FILTERS = {
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

/**
 * Read-only Chef IA pin template library.
 * Cards render real Template Engine previews (demo recipe or selected article).
 */
export default function PinTemplateChooser({
	open,
	onClose,
	selectedId = '',
	onSelect,
	selecting = false,
	selectingId = '',
	previewArticle = null,
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
	const panelRef = useRef(null);
	const [query, setQuery] = useState('');

	const previewTemplate = items.find((item) => item.id === previewTemplateId) || null;

	const hasFilters = useMemo(() => Boolean(
		filters.q || filters.category || filters.scope,
	), [filters]);

	const articleFingerprint = useMemo(() => {
		if (!previewArticle) return 'demo';
		return [
			previewArticle.id || '',
			previewArticle.title || '',
			previewArticle.featuredImage || '',
		].join('|');
	}, [previewArticle]);

	useEffect(() => {
		if (!open) return undefined;
		setQuery('');
		// Load first; only reset when the chooser actually closes (avoid dropping in-flight results).
		void loadGalleryFirstPage({ ...SELECT_FILTERS });
		return () => {
			revokeGalleryLivePreviewUrls();
			resetGalleryStore();
		};
	}, [open]);

	useEffect(() => {
		if (!open) return undefined;
		const node = sentinelRef.current;
		const root = panelRef.current;
		if (!node || loading || loadingMore) return undefined;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				void loadGalleryNextPage();
			}
		}, { root: root || null, rootMargin: '320px' });
		observer.observe(node);
		return () => observer.disconnect();
	}, [open, items.length, hasMore, loading, loadingMore]);

	if (!open) return null;

	function applySearch(value) {
		setQuery(value);
		setGalleryFilters({
			...SELECT_FILTERS,
			q: value,
			category: filters.category || '',
		});
	}

	function applyCategory(category) {
		setGalleryFilters({
			...SELECT_FILTERS,
			q: query,
			category,
		});
	}

	return (
		<div className="pin-tpl-chooser" role="dialog" aria-modal="true" aria-label="Choose template">
			<button type="button" className="pin-tpl-chooser__backdrop" aria-label="Close gallery" onClick={onClose} />
			<div className="pin-tpl-chooser__panel" ref={panelRef}>
				<header className="pin-tpl-chooser__header">
					<div className="pin-tpl-chooser__brand">
						<span className="pin-tpl-chooser__eyebrow">
							<Library size={14} aria-hidden="true" /> Chef IA Library
						</span>
						<h2>Choose Template</h2>
						<p>
							{previewArticle?.title
								? `Live previews use “${previewArticle.title}”. Pick a design — one click selects.`
								: 'Live pin previews with a demo recipe. Select an article to preview your content on every design.'}
						</p>
					</div>
					<button type="button" className="pin-tpl-chooser__close" onClick={onClose} aria-label="Close">
						<X size={18} />
					</button>
				</header>

				<div className="pin-tpl-chooser__toolbar">
					<label className="pin-tpl-chooser__search">
						<span className="sr-only">Search templates</span>
						<input
							value={query}
							onChange={(event) => applySearch(event.target.value)}
							placeholder="Search templates…"
							aria-label="Search templates"
						/>
					</label>
					<p className="pin-tpl-chooser__count">{totalItems} designs</p>
				</div>

				<div className="pin-tpl-chooser__categories" role="tablist" aria-label="Template categories">
					<button
						type="button"
						role="tab"
						aria-selected={!filters.category}
						className={!filters.category ? 'is-active' : ''}
						onClick={() => applyCategory('')}
					>
						All
					</button>
					{TEMPLATE_CATEGORIES.map((category) => (
						<button
							key={category}
							type="button"
							role="tab"
							aria-selected={filters.category === category}
							className={filters.category === category ? 'is-active' : ''}
							onClick={() => applyCategory(category)}
						>
							{category}
						</button>
					))}
				</div>

				{error ? <p className="pin-tpl-chooser__error" role="alert">{error}</p> : null}
				{loading ? <TemplateGalleryLoading count={9} /> : null}

				{!loading && items.length === 0 ? (
					<TemplateGalleryEmpty
						hasFilters={hasFilters}
						onCreate={null}
						onClear={() => {
							setQuery('');
							loadGalleryFirstPage({ ...SELECT_FILTERS });
						}}
					/>
				) : null}

				{!loading && items.length > 0 ? (
					<div className="pin-tpl-chooser__grid" key={articleFingerprint}>
						{items.map((template, index) => (
							<PinTemplateChooserLiveCard
								key={`${template.id}:${articleFingerprint}`}
								template={template}
								index={index}
								article={previewArticle}
								selected={selectedId === template.id}
								busy={selecting && selectingId === template.id}
								disabled={selecting}
								onSelect={onSelect}
							/>
						))}
					</div>
				) : null}

				<div ref={sentinelRef} className="pin-tpl-chooser__sentinel">
					{loadingMore ? 'Loading more…' : hasMore ? 'Scroll for more designs' : items.length ? 'End of library' : null}
				</div>

				<TemplatePreviewModal
					template={previewTemplate}
					onClose={() => setPreviewTemplateId(null)}
				/>
			</div>
		</div>
	);
}
