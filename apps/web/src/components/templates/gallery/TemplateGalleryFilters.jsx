import { Search } from 'lucide-react';
import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_STATUS,
	TEMPLATE_VISIBILITY,
} from '@/lib/pinEngineConstants';

const SORTS = [
	{ id: 'recently_updated', label: 'Recently Updated' },
	{ id: 'recently_used', label: 'Recently Used' },
	{ id: 'most_used', label: 'Most Used' },
	{ id: 'alphabetical', label: 'Alphabetical' },
	{ id: 'created_date', label: 'Created Date' },
];

const SCOPES = [
	{ id: '', label: 'All' },
	{ id: 'mine', label: 'My Templates' },
	{ id: 'workspace', label: 'Workspace' },
	{ id: 'official', label: 'Official' },
	{ id: 'community', label: 'Community' },
];

export default function TemplateGalleryFilters({ filters, onChange }) {
	return (
		<div className="tpl-gallery-filters" role="search" aria-label="Template filters">
			<div className="tpl-gallery-search">
				<Search size={16} aria-hidden="true" />
				<input
					value={filters.q}
					placeholder="Search name, category, tags, author…"
					aria-label="Search templates"
					onChange={(event) => onChange({ q: event.target.value })}
				/>
			</div>

			<div className="tpl-gallery-filter-row">
				<label className="tpl-gallery-sr-only" htmlFor="tpl-filter-category">Category</label>
				<select id="tpl-filter-category" value={filters.category} onChange={(e) => onChange({ category: e.target.value })} aria-label="Category">
					<option value="">All categories</option>
					{TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
				</select>
				<label className="tpl-gallery-sr-only" htmlFor="tpl-filter-status">Status</label>
				<select id="tpl-filter-status" value={filters.status} onChange={(e) => onChange({ status: e.target.value })} aria-label="Status">
					<option value="">All statuses</option>
					{TEMPLATE_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
				</select>
				<label className="tpl-gallery-sr-only" htmlFor="tpl-filter-visibility">Visibility</label>
				<select id="tpl-filter-visibility" value={filters.visibility} onChange={(e) => onChange({ visibility: e.target.value })} aria-label="Visibility">
					<option value="">All visibility</option>
					{TEMPLATE_VISIBILITY.map((v) => <option key={v} value={v}>{v}</option>)}
				</select>
				<label className="tpl-gallery-sr-only" htmlFor="tpl-filter-scope">Scope</label>
				<select id="tpl-filter-scope" value={filters.scope} onChange={(e) => onChange({ scope: e.target.value })} aria-label="Scope">
					{SCOPES.map((s) => <option key={s.id || 'all'} value={s.id}>{s.label}</option>)}
				</select>
				<label className="tpl-gallery-sr-only" htmlFor="tpl-filter-sort">Sort</label>
				<select id="tpl-filter-sort" value={filters.sort} onChange={(e) => onChange({ sort: e.target.value })} aria-label="Sort by">
					{SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
				</select>
			</div>

			<div className="tpl-gallery-chips">
				<label>
					<input
						type="checkbox"
						checked={filters.favorite}
						onChange={(e) => onChange({ favorite: e.target.checked })}
					/>
					Favorites
				</label>
				<label>
					<input
						type="checkbox"
						checked={filters.recentlyUsed}
						onChange={(e) => onChange({ recentlyUsed: e.target.checked })}
					/>
					Recently Used
				</label>
				<label>
					<input
						type="checkbox"
						checked={filters.includeArchived}
						onChange={(e) => onChange({ includeArchived: e.target.checked })}
					/>
					Include archived
				</label>
				<input
					className="tpl-gallery-tag"
					value={filters.tag}
					placeholder="Tag filter"
					aria-label="Filter by tag"
					onChange={(e) => onChange({ tag: e.target.value })}
				/>
			</div>
		</div>
	);
}
