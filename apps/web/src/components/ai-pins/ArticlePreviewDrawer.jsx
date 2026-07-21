import { ExternalLink, X } from 'lucide-react';
import { Badge, Button, Card } from '@/components/kit';

function formatDate(value) {
	if (!value) {
		return '—';
	}
	try {
		return new Date(value).toLocaleString();
	} catch {
		return '—';
	}
}

export default function ArticlePreviewDrawer({ article, open, onClose }) {
	if (!open || !article) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-black/40 p-0 sm:p-4" onClick={onClose}>
			<Card className="h-full w-full max-w-lg overflow-y-auto rounded-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-start justify-between gap-3">
					<div>
						<h3 className="font-semibold">{article.title || 'Article preview'}</h3>
						<p className="mt-1 text-xs text-muted-foreground">{article.url}</p>
					</div>
					<button type="button" onClick={onClose} aria-label="Close preview"><X size={18} /></button>
				</div>

				{article.featuredImage ? (
					<img src={article.featuredImage} alt="" className="mb-4 h-44 w-full rounded-xl object-cover" loading="lazy" decoding="async" />
				) : null}

				<div className="mb-4 flex flex-wrap gap-2">
					{article.status ? <Badge tone="blue">{article.status}</Badge> : null}
					{article.category ? <Badge>{article.category}</Badge> : null}
					{article.language ? <Badge tone="default">{article.language}</Badge> : null}
				</div>

				<div className="space-y-3 text-sm">
					<p><span className="text-muted-foreground">Author:</span> {article.author || '—'}</p>
					<p><span className="text-muted-foreground">Published:</span> {formatDate(article.publishDate)}</p>
					<p><span className="text-muted-foreground">Updated:</span> {formatDate(article.lastModifiedDate || article.updated)}</p>
					<div>
						<p className="mb-1 text-muted-foreground">Description / excerpt</p>
						<p className="rounded-xl border border-border bg-secondary/30 p-3 text-sm leading-relaxed">
							{article.metaDescription || 'No description available for this article.'}
						</p>
					</div>
				</div>

				<div className="mt-6 flex justify-end gap-2">
					{article.url ? (
						<a href={article.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
							<ExternalLink size={14} /> Open article
						</a>
					) : null}
					<Button type="button" variant="outline" onClick={onClose}>Close</Button>
				</div>
			</Card>
		</div>
	);
}
