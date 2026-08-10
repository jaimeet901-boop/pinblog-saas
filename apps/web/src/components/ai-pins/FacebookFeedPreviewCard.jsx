import { Globe } from 'lucide-react';
import { formatPinDomain } from '@/lib/pinTemplates';
import './FacebookFeedPreviewCard.css';

function resolveInitial(name = '') {
	const trimmed = String(name || '').trim();
	return trimmed.charAt(0).toUpperCase() || 'P';
}

export default function FacebookFeedPreviewCard({
	title = '',
	description = '',
	imageUrl = '',
	featuredImageUrl = '',
	pageName = 'Your Facebook Page',
	linkUrl = '',
	logoUrl = '',
	publishedAtLabel = 'Just now',
	className = '',
	compact = false,
	mediaAspectClass = 'aspect-[1200/630]',
}) {
	const mediaUrl = imageUrl || featuredImageUrl || '';
	const domain = formatPinDomain(linkUrl);
	const message = [title, description].filter(Boolean).join('\n\n');
	const mediaFrameClass = String(mediaAspectClass || 'aspect-[1200/630]').trim() || 'aspect-[1200/630]';

	return (
		<div className={`fb-feed-preview ${compact ? 'is-compact' : ''} ${className}`.trim()}>
			<div className="fb-feed-preview__header">
				<div className="fb-feed-preview__avatar" aria-hidden="true">
					{logoUrl ? (
						<img src={logoUrl} alt="" />
					) : (
						<span>{resolveInitial(pageName)}</span>
					)}
				</div>
				<div className="fb-feed-preview__meta">
					<p className="fb-feed-preview__page">{pageName}</p>
					<p className="fb-feed-preview__time">
						{publishedAtLabel}
						{' · '}
						<Globe size={11} className="inline align-[-2px]" aria-hidden="true" />
					</p>
				</div>
			</div>

			{message ? (
				<div className="fb-feed-preview__text">
					<p className="fb-feed-preview__message whitespace-pre-wrap">{message}</p>
				</div>
			) : null}

			{mediaUrl ? (
				<div className={`fb-feed-preview__media ${mediaFrameClass}`.trim()}>
					<img src={mediaUrl} alt={title || 'Post preview'} loading="lazy" decoding="async" />
				</div>
			) : null}

			{linkUrl ? (
				<div className="fb-feed-preview__link">
					{domain ? <p className="fb-feed-preview__link-domain">{domain.toUpperCase()}</p> : null}
					<p className="fb-feed-preview__link-title">{title || domain || 'Link preview'}</p>
					{description ? <p className="fb-feed-preview__link-desc">{description}</p> : null}
				</div>
			) : null}

			<p className="fb-feed-preview__badge">Feed preview · display only</p>
		</div>
	);
}
