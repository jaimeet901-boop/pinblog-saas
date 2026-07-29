import { useEffect, useRef, useState } from 'react';
import { renderGalleryTemplatePreview } from '@/services/ai-pins/galleryLivePreview';
import { resolveGalleryPreviewContent } from '@/lib/pinGalleryDemoContent';
import { getCachedPreview } from '@/services/templates/previewCache';
import { isTemplateAccessLocked } from '@/lib/templateAccess';

function liveChecksum(template, contentKey) {
	const base = String(template?.configChecksum || template?.config_checksum || 'nocfg').trim().toLowerCase() || 'nocfg';
	const content = String(contentKey || 'demo').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96);
	return `${base}:live:${content}`;
}

/**
 * One-click gallery card with a live Template Engine pin preview.
 */
export default function PinTemplateChooserLiveCard({
	template,
	index = 0,
	article = null,
	selected = false,
	busy = false,
	disabled = false,
	onSelect,
}) {
	const mediaRef = useRef(null);
	const [visible, setVisible] = useState(false);
	const [previewUrl, setPreviewUrl] = useState('');
	const [status, setStatus] = useState('idle'); // idle | loading | ready | error
	const name = template.name || 'Untitled template';
	const isOfficial = template.visibility === 'official';
	const locked = isTemplateAccessLocked(template);
	const content = resolveGalleryPreviewContent({
		article,
		templateIndex: index,
		templateId: template.id,
	});

	useEffect(() => {
		const node = mediaRef.current;
		if (!node) return undefined;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setVisible(true);
			}
		}, { rootMargin: '240px' });
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!visible || !template?.id) return undefined;
		const checksum = liveChecksum(template, content.contentKey);
		const cached = getCachedPreview({
			templateId: template.id,
			configChecksum: checksum,
			format: 'png',
		});
		if (cached?.imageUrl) {
			setPreviewUrl(cached.imageUrl);
			setStatus('ready');
			return undefined;
		}

		const controller = new AbortController();
		setStatus('loading');
		setPreviewUrl('');
		renderGalleryTemplatePreview({
			templateSummary: template,
			article,
			templateIndex: index,
			signal: controller.signal,
		})
			.then((url) => {
				if (controller.signal.aborted) return;
				setPreviewUrl(url);
				setStatus('ready');
			})
			.catch((error) => {
				if (controller.signal.aborted) return;
				setStatus('error');
			});

		return () => controller.abort();
	}, [visible, template?.id, template?.configChecksum, content.contentKey, article, index]);

	return (
		<button
			type="button"
			className={`pin-tpl-library-card ${selected ? 'is-selected' : ''} ${busy ? 'is-busy' : ''} ${status === 'loading' ? 'is-rendering' : ''} ${locked ? 'is-locked' : ''}`}
			onClick={() => onSelect?.(template)}
			disabled={disabled}
			aria-pressed={selected}
			aria-label={locked ? `${name} — upgrade required` : (selected ? `Selected ${name}` : `Select ${name}`)}
		>
			<span className="pin-tpl-library-card__media" ref={mediaRef} aria-hidden="true">
				{previewUrl ? (
					<img src={previewUrl} alt="" loading="lazy" />
				) : (
					<span className={`pin-tpl-library-card__skeleton ${status === 'error' ? 'is-error' : ''}`}>
						{status === 'error' ? 'Preview unavailable' : 'Rendering pin…'}
					</span>
				)}
				{isOfficial ? <span className="pin-tpl-library-card__badge">Chef IA</span> : null}
				{locked ? <span className="pin-tpl-library-card__locked">Upgrade</span> : null}
				{content.source === 'demo' ? (
					<span className="pin-tpl-library-card__demo">Demo recipe</span>
				) : (
					<span className="pin-tpl-library-card__demo is-article">Your article</span>
				)}
			</span>
			<span className="pin-tpl-library-card__meta">
				<span className="pin-tpl-library-card__name">{name}</span>
				<span className="pin-tpl-library-card__category">
					{template.category || 'general'}
					{locked ? ' · Locked' : ''}
					{selected ? ' · Selected' : ''}
					{busy ? ' · Loading…' : ''}
				</span>
			</span>
		</button>
	);
}
