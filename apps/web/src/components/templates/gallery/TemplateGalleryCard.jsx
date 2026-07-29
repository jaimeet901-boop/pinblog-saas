import { Archive, Copy, Download, Eye, Pencil, Star, Trash2, Type } from 'lucide-react';
import { Link } from 'react-router-dom';
import { resolveGalleryThumbnail } from '@/services/templates/previewCache';
import { isTemplateAccessLocked } from '@/lib/templateAccess';

export default function TemplateGalleryCard({
	template,
	selected,
	onToggleSelect,
	onFavorite,
	onDuplicate,
	onDelete,
	onArchive,
	onExport,
	onRename,
	onPreview,
	onTouch,
	onUpgradeRequest,
	mode = 'manage',
	onUse,
	busy = false,
}) {
	const thumb = resolveGalleryThumbnail(template);
	const name = template.name || 'Untitled template';
	const selectMode = mode === 'select';
	const locked = isTemplateAccessLocked(template);

	function requestUse() {
		if (locked) {
			onUpgradeRequest?.(template);
			return;
		}
		onUse?.(template);
	}

	function requestDuplicate() {
		if (locked) {
			onUpgradeRequest?.(template);
			return;
		}
		onDuplicate?.(template);
	}

	function requestExport() {
		if (locked) {
			onUpgradeRequest?.(template);
			return;
		}
		onExport?.(template);
	}

	function requestEdit(event) {
		if (locked) {
			event.preventDefault();
			onUpgradeRequest?.(template);
		} else {
			onTouch?.(template);
		}
	}

	return (
		<article
			className={`tpl-gallery-card ${selected ? 'is-selected' : ''} ${selectMode ? 'is-select-mode' : ''} ${locked ? 'is-locked' : ''}`}
			aria-label={name}
		>
			<div className="tpl-gallery-card__media">
				{selectMode ? null : (
					<label className="tpl-gallery-card__check">
						<input
							type="checkbox"
							checked={selected}
							onChange={() => onToggleSelect(template.id)}
							aria-label={`Select ${name}`}
						/>
					</label>
				)}
				{thumb.url ? (
					<img src={thumb.url} alt="" loading="lazy" />
				) : (
					<div className="tpl-gallery-card__placeholder" role="img" aria-label="No preview available">No preview</div>
				)}
				{thumb.fromCache ? <span className="tpl-gallery-card__cache">cached</span> : null}
				{selectMode ? (
					locked
						? <span className="tpl-gallery-card__premium">Upgrade</span>
						: <span className="tpl-gallery-card__free">Free</span>
				) : (
					locked ? <span className="tpl-gallery-card__premium">Upgrade</span> : null
				)}
				{onFavorite ? (
					<button
						type="button"
						className={`tpl-gallery-card__fav ${template.isFavorite ? 'is-on' : ''}`}
						onClick={() => onFavorite(template)}
						aria-label={template.isFavorite ? `Unfavorite ${name}` : `Favorite ${name}`}
						aria-pressed={Boolean(template.isFavorite)}
						title="Favorite"
					>
						<Star size={14} aria-hidden="true" />
					</button>
				) : null}
			</div>

			<div className="tpl-gallery-card__body">
				<div className="tpl-gallery-card__title-row">
					<h3 title={name}>{name}</h3>
					<span className="tpl-gallery-badge">{template.status || 'published'}</span>
				</div>
				<p className="tpl-gallery-card__meta">
					{template.category || 'general'} · {template.visibility || 'private'}
					{template.authorName ? ` · ${template.authorName}` : ''}
					{locked ? ' · Locked' : ''}
				</p>
				{template.tags?.length ? (
					<p className="tpl-gallery-card__tags">{template.tags.slice(0, 4).join(' · ')}</p>
				) : null}
			</div>

			{selectMode ? (
				<div className="tpl-gallery-card__actions tpl-gallery-card__actions--select">
					{onPreview ? (
						<button type="button" aria-label={`Preview ${name}`} title="Preview" onClick={() => onPreview(template)}>
							<Eye size={14} aria-hidden="true" />
						</button>
					) : null}
					<button
						type="button"
						className="tpl-gallery-card__use"
						disabled={busy}
						onClick={requestUse}
					>
						{locked
							? 'Upgrade to use'
							: (selected && busy ? 'Loading…' : selected ? 'Selected' : 'Use template')}
					</button>
				</div>
			) : (
				<div className="tpl-gallery-card__actions">
					{locked ? (
						<button
							type="button"
							aria-label={`Upgrade to edit ${name}`}
							title="Upgrade to edit"
							onClick={() => onUpgradeRequest?.(template)}
						>
							<Pencil size={14} aria-hidden="true" />
						</button>
					) : (
						<Link
							to={`/app/ai-pins/templates/${template.id}/edit`}
							onClick={requestEdit}
							aria-label={`Edit ${name}`}
							title="Edit"
						>
							<Pencil size={14} aria-hidden="true" />
						</Link>
					)}
					<button type="button" aria-label={`Preview ${name}`} title="Preview" onClick={() => onPreview(template)}>
						<Eye size={14} aria-hidden="true" />
					</button>
					<button type="button" aria-label={`Duplicate ${name}`} title="Duplicate" onClick={requestDuplicate}>
						<Copy size={14} aria-hidden="true" />
					</button>
					<button type="button" aria-label={`Rename ${name}`} title="Rename" onClick={() => onRename(template)}>
						<Type size={14} aria-hidden="true" />
					</button>
					<button type="button" aria-label={`Favorite ${name}`} title="Favorite" onClick={() => onFavorite(template)}>
						<Star size={14} aria-hidden="true" />
					</button>
					<button type="button" aria-label={`Archive ${name}`} title="Archive" onClick={() => onArchive(template)}>
						<Archive size={14} aria-hidden="true" />
					</button>
					<button type="button" aria-label={`Export ${name}`} title="Export" onClick={requestExport}>
						<Download size={14} aria-hidden="true" />
					</button>
					<button type="button" aria-label={`Delete ${name}`} title="Delete" onClick={() => onDelete(template)}>
						<Trash2 size={14} aria-hidden="true" />
					</button>
				</div>
			)}
		</article>
	);
}
