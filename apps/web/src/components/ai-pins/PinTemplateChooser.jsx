import { useEffect, useMemo, useRef, useState } from 'react';
import { Library, X } from 'lucide-react';
import TemplateGalleryEmpty, { TemplateGalleryLoading } from '@/components/templates/gallery/TemplateGalleryEmpty';
import TemplatePreviewModal from '@/components/templates/gallery/TemplatePreviewModal';
import {
	loadGalleryFirstPage,
	loadGalleryNextPage,
	resetGalleryStore,
	setGalleryFilters,
	setPreviewTemplateId,
} from '@/services/templates/galleryStore';
import { useGalleryStore } from '@/services/templates/useGalleryStore';
import { resolveGalleryThumbnail } from '@/services/templates/previewCache';
import { TEMPLATE_CATEGORIES } from '@/lib/pinEngineConstants';
import '@/pages/app/TemplatesPage.css';
import './PinTemplateChooser.css';

const SELECT_FILTERS = {
	status: 'published',
	includeArchived: false,
	sort: 'recently_updated',
};

/**
 * Read-only Chef IA pin template library for workspace users.
 * Built-in official templates + published workspace templates.
 * One click selects — no template building.
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
	const [query, setQuery] = useState('');

	const previewTemplate = items.find((item) => item.id === previewTemplateId) || null;

	const hasFilters = useMemo(() => Boolean(
		filters.q || filters.category || filters.scope,
	), [filters]);

	useEffect(() => {
		if (!open) return undefined;
		setQuery('');
		loadGalleryFirstPage({ ...SELECT_FILTERS, q: '', category: '', scope: '' });
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
		}, { rootMargin: '280px' });
		observer.observe(node);
		return () => observer.disconnect();
	}, [open, items.length, hasMore]);

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
			<div className="pin-tpl-chooser__panel">
				<header className="pin-tpl-chooser__header">
					<div className="pin-tpl-chooser__brand">
						<span className="pin-tpl-chooser__eyebrow">
							<Library size={14} aria-hidden="true" /> Chef IA Library
						</span>
						<h2>Choose Template</h2>
						<p>Select a design for your Pinterest pins. Ready-made layouts — no building required.</p>
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
							loadGalleryFirstPage({
								q: '', category: '', scope: '',
								...SELECT_FILTERS,
							});
						}}
					/>
				) : null}

				{!loading && items.length > 0 ? (
					<div className="pin-tpl-chooser__grid">
						{items.map((template) => {
							const thumb = resolveGalleryThumbnail(template);
							const name = template.name || 'Untitled template';
							const selected = selectedId === template.id;
							const busy = selecting && selectingId === template.id;
							const isOfficial = template.visibility === 'official';
							return (
								<button
									key={template.id}
									type="button"
									className={`pin-tpl-library-card ${selected ? 'is-selected' : ''} ${busy ? 'is-busy' : ''}`}
									onClick={() => onSelect?.(template)}
									disabled={selecting}
									aria-pressed={selected}
									aria-label={selected ? `Selected ${name}` : `Select ${name}`}
								>
									<span className="pin-tpl-library-card__media" aria-hidden="true">
										{thumb.url ? (
											<img src={thumb.url} alt="" loading="lazy" />
										) : (
											<span className="pin-tpl-library-card__placeholder">Preview</span>
										)}
										{isOfficial ? <span className="pin-tpl-library-card__badge">Chef IA</span> : null}
									</span>
									<span className="pin-tpl-library-card__meta">
										<span className="pin-tpl-library-card__name">{name}</span>
										<span className="pin-tpl-library-card__category">
											{template.category || 'general'}
											{selected ? ' · Selected' : ''}
											{busy ? ' · Loading…' : ''}
										</span>
									</span>
								</button>
							);
						})}
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
