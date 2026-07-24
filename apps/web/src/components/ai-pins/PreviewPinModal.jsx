import { ExternalLink, X } from 'lucide-react';
import { Button, Card } from '@/components/kit';

export default function PreviewPinModal({
	open,
	preview,
	onClose,
	onPublish,
	onSchedule,
	publishing = false,
}) {
	if (!open || !preview) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
			<Card className="w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<div>
						<h3 className="font-semibold">Preview pin</h3>
						<p className="text-xs text-muted-foreground">Review before publishing</p>
					</div>
					<button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
				</div>

				<div className="overflow-hidden rounded-2xl border border-border bg-secondary">
					<div className="aspect-[2/3] bg-muted">
						{preview.imageUrl ? (
							<img src={preview.imageUrl} alt={preview.title} className="h-full w-full object-cover" />
						) : (
							<div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image</div>
						)}
					</div>
				</div>

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
							<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Board</p>
							<p>{preview.boardName || '—'}</p>
						</div>
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Account</p>
							<p className="truncate">{preview.accountLabel || '—'}</p>
						</div>
					</div>
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Website URL</p>
						{preview.websiteUrl ? (
							<a
								href={preview.websiteUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-sm text-primary hover:underline break-all"
							>
								{preview.websiteUrl} <ExternalLink size={12} />
							</a>
						) : (
							<p className="text-sm text-muted-foreground">—</p>
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
