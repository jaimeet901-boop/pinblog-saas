import { CheckCircle2, AlertTriangle, Loader2, X, ExternalLink } from 'lucide-react';
import { Button, Card, Badge } from '@/components/kit';

export default function PublishProgressModal({
	open,
	progress,
	result,
	onClose,
	onOpenHistory,
}) {
	if (!open) return null;

	const phase = progress?.phase || (result ? 'done' : 'submitting');
	const responses = result?.pinterestResponses || progress?.jobs?.map((job) => ({
		jobId: job.id,
		status: job.status,
		pinId: job.pinterestPinId || '',
		pinUrl: job.pinterestPinUrl || '',
		error: job.lastError || '',
		attemptCount: job.attemptCount || 0,
		boardName: job.boardName || '',
		accountLabel: job.accountLabel || '',
	})) || [];

	const isDone = phase === 'done' || Boolean(result);
	const hasError = Boolean(result?.failed?.length) || responses.some((r) => r.status === 'failed');

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={isDone ? onClose : undefined}>
			<Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-start justify-between gap-2">
					<div>
						<h3 className="font-semibold">
							{isDone ? (hasError ? 'Publishing finished with errors' : 'Published') : 'Publishing…'}
						</h3>
						<p className="text-xs text-muted-foreground">{progress?.message || result?.message || 'Working'}</p>
					</div>
					{isDone ? (
						<button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
					) : null}
				</div>

				<div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
					{isDone ? (
						hasError
							? <AlertTriangle className="text-destructive" size={22} />
							: <CheckCircle2 className="text-emerald-600" size={22} />
					) : (
						<Loader2 className="animate-spin text-primary" size={22} />
					)}
					<div className="min-w-0 text-sm">
						<p className="font-medium capitalize">{phase}</p>
						{typeof progress?.elapsedMs === 'number' ? (
							<p className="text-xs text-muted-foreground">{Math.round(progress.elapsedMs / 1000)}s elapsed</p>
						) : null}
					</div>
				</div>

				{responses.length > 0 ? (
					<div className="space-y-2">
						<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pinterest response</p>
						{responses.map((item) => (
							<div key={item.jobId} className="rounded-xl border border-border p-3 text-sm">
								<div className="mb-1 flex items-center justify-between gap-2">
									<Badge tone={item.status === 'published' ? 'green' : item.status === 'failed' ? 'red' : 'amber'}>
										{item.status}
									</Badge>
									<span className="text-[10px] text-muted-foreground">retries {item.attemptCount || 0}</span>
								</div>
								<p className="text-xs text-muted-foreground">{item.accountLabel} · {item.boardName}</p>
								{item.pinUrl ? (
									<a href={item.pinUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
										Open on Pinterest <ExternalLink size={11} />
									</a>
								) : null}
								{item.pinId ? <p className="mt-1 text-[11px] text-muted-foreground">Pin ID: {item.pinId}</p> : null}
								{item.error ? <p className="mt-1 text-xs text-destructive">{item.error}</p> : null}
							</div>
						))}
					</div>
				) : null}

				{isDone ? (
					<div className="mt-4 flex flex-wrap gap-2">
						{onOpenHistory ? (
							<Button variant="outline" onClick={onOpenHistory}>Publishing History</Button>
						) : null}
						<Button onClick={onClose}>Done</Button>
					</div>
				) : null}
			</Card>
		</div>
	);
}
