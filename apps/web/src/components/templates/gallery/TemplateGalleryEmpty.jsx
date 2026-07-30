import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';

export default function TemplateGalleryEmpty({ hasFilters, onCreate, onClear }) {
	const { platformName } = usePlatformIdentity();

	return (
		<div className="tpl-gallery-empty">
			<h2>{hasFilters ? 'No templates match' : 'No templates yet'}</h2>
			<p>
				{hasFilters
					? 'Try clearing filters or searching a different term.'
					: onCreate
						? 'Create a layer template to start your gallery.'
						: `The ${platformName} template library will appear here once available.`}
			</p>
			<div className="tpl-gallery-empty__actions">
				{hasFilters ? (
					<button type="button" onClick={onClear}>Clear filters</button>
				) : null}
				{onCreate ? (
					<button type="button" className="is-primary" onClick={onCreate}>Create template</button>
				) : null}
			</div>
		</div>
	);
}

export function TemplateGalleryLoading({ count = 8 }) {
	return (
		<div className="tpl-gallery-grid">
			{Array.from({ length: count }).map((_, index) => (
				<div key={index} className="tpl-gallery-skeleton" />
			))}
		</div>
	);
}
