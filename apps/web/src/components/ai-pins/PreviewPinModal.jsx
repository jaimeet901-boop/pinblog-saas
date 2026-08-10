import { ExternalLink, X } from 'lucide-react';
import { Button, Card } from '@/components/kit';
import FacebookFeedPreviewCard from '@/components/ai-pins/FacebookFeedPreviewCard';

export default function PreviewPinModal({
	open,
	preview,
	onClose,
	onPublish,
	onSchedule,
	publishing = false,
	labels = null,
	previewVariant = 'pinterest',
	mediaAspectClass = 'aspect-[1200/630]',
}) {
	if (!open || !preview) return null;

	const L = labels || {
		previewTitle: 'Preview pin',
		destination: 'Board',
		account: 'Account',
		previewDefaultPageName: 'Your Facebook Page',
	};

	const destinationUrl = preview.destinationUrl || preview.websiteUrl || preview.sourceUrl || '';
	const isFacebookPreview = previewVariant === 'facebook';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
			<Card className="w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<div>
						<h3 className="font-semibold">{L.previewTitle}</h3>
						<p className="text-xs text-muted-foreground">Review before publishing</p>
					</div>
					<button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
				</div>

				{isFacebookPreview ? (
					<FacebookFeedPreviewCard
						title={preview.title || ''}
						description={preview.description || ''}
						imageUrl={preview.imageUrl || ''}
						pageName={preview.boardName || L.previewDefaultPageName}
						linkUrl={destinationUrl}
						mediaAspectClass={mediaAspectClass}
					/>
				) : (
					<div className="overflow-hidden rounded-2xl border border-border bg-secondary">
						<div className="aspect-[2/3] bg-muted">
							{preview.imageUrl ? (
								<img src={preview.imageUrl} alt={preview.title} className="h-full w-full object-cover" />
							) : (
								<div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image</div>
							)}
						</div>
					</div>
				)}

				<div className="mt-4 space-y-3">
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Title</p>
						<p className="text-sm font-medium">{preview.title}</p>
					</div>
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
						<p className="text-sm text-muted-foreground whitespace-pre-wrap">{preview.description || '—'}</p>
					</div>
					<div className="grid grid-cols-2 gap-3 text-sm">
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Image Source</p>
							<p>{preview.imageSourceLabel || '—'}</p>
						</div>
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Template Name</p>
							<p className="truncate" title={preview.templateName || ''}>{preview.templateName || '—'}</p>
						</div>
					</div>
					<div className="grid grid-cols-2 gap-3 text-sm">
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{L.destination}</p>
							<p>{preview.boardName || '—'}</p>
						</div>
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{L.accountTitle || L.account}</p>
							<p className="truncate">{preview.accountLabel || '—'}</p>
						</div>
					</div>
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Destination URL</p>
						{destinationUrl ? (
							<a
								href={destinationUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-sm text-primary hover:underline break-all"
							>
								{destinationUrl} <ExternalLink size={12} />
							</a>
						) : (
							<p className="text-sm text-destructive">Missing article URL</p>
						)}
					</div>
				</div>

				<div className="mt-5 flex flex-wrap gap-2">
					{onPublish ? (
						<Button className="flex-1" onClick={onPublish} disabled={publishing}>Publish Now</Button>
					) : null}
					{onSchedule ? (
						<Button variant="outline" className="flex-1" onClick={onSchedule} disabled={publishing}>Schedule</Button>
					) : null}
					<Button variant="ghost" onClick={onClose}>Close</Button>
				</div>
			</Card>
		</div>
	);
}
