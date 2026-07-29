import { useEffect, useId, useRef } from 'react';
import {
	PRODUCT_EVENTS,
	buildTemplateEventProps,
	trackProductEvent,
} from '@/lib/productAnalytics';

export default function TemplatePreviewModal({ template, onClose, sourcePage = 'template_gallery' }) {
	const titleId = useId();
	const closeRef = useRef(null);
	const trackedIdRef = useRef('');

	useEffect(() => {
		if (!template) return undefined;
		const previous = document.activeElement;
		closeRef.current?.focus();
		function onKeyDown(event) {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose?.();
			}
		}
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			if (previous && typeof previous.focus === 'function') previous.focus();
		};
	}, [template, onClose]);

	useEffect(() => {
		if (!template?.id) {
			trackedIdRef.current = '';
			return;
		}
		if (trackedIdRef.current === template.id) return;
		trackedIdRef.current = template.id;
		trackProductEvent(
			PRODUCT_EVENTS.TEMPLATE_PREVIEW_OPEN,
			buildTemplateEventProps(template, { sourcePage }),
			{ dedupeKey: `template_preview_open:${sourcePage}:${template.id}` },
		);
	}, [template, sourcePage]);

	if (!template) return null;
	const url = template.previewUrl || template.thumbnail || '';

	return (
		<div className="tpl-gallery-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
			<button type="button" className="tpl-gallery-modal__backdrop" onClick={onClose} aria-label="Close preview" />
			<div className="tpl-gallery-modal__panel">
				<header>
					<div>
						<h2 id={titleId}>{template.name}</h2>
						<p>{template.category} · {template.visibility} · {template.status}</p>
					</div>
					<button type="button" ref={closeRef} onClick={onClose}>Close</button>
				</header>
				{url ? (
					<img src={url} alt={`Preview of ${template.name}`} />
				) : (
					<p className="tpl-gallery-hint">No cached preview. Open the editor and use Preview to generate one.</p>
				)}
				{template.configChecksum ? (
					<p className="tpl-gallery-hint">checksum: {template.configChecksum.slice(0, 12)}…</p>
				) : null}
			</div>
		</div>
	);
}
