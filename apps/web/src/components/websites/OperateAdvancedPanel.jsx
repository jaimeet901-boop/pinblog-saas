import { useState } from 'react';
import { Badge, Card, Spinner } from '@/components/kit';
import { ChevronDown } from 'lucide-react';

/**
 * Collapsed-by-default Advanced panel for Operate workspace (Phase 2B).
 * Children are existing dashboard diagnostic cards — no duplicated logic.
 */
export default function OperateAdvancedPanel({ children }) {
	const [open, setOpen] = useState(false);

	return (
		<Card className="mt-4">
			<button
				type="button"
				className="flex w-full items-center justify-between gap-2 text-left"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
			>
				<div>
					<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Advanced</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Score, problems, credits, WordPress details, logs, and diagnostics.
					</p>
				</div>
				<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
					{open ? 'Hide' : 'Show'}
					<ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
				</span>
			</button>
			{open ? <div className="mt-4 space-y-4 border-t border-border pt-4">{children}</div> : null}
		</Card>
	);
}

export function OperateActivityFeed({ items = [], formatDateTime, timelineTone, timelineTypeLabel }) {
	return (
		<Card className="mb-4">
			<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recent activity</p>
			{items.length > 0 ? (
				<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
					{items.slice(0, 8).map((item) => (
						<li key={item.id} className="flex items-start gap-2">
							<Badge tone={timelineTone(item)}>{timelineTypeLabel(item.type)}</Badge>
							<span>
								{item.title} — {item.status || '—'} ({formatDateTime(item.at)})
								{item.detail ? <span className="mt-1 block text-xs">{item.detail}</span> : null}
							</span>
						</li>
					))}
				</ul>
			) : (
				<p className="mt-3 text-sm text-muted-foreground">No recent scan, writer, pin, publish, or error events yet.</p>
			)}
		</Card>
	);
}

export function OperateScanProgress({ scanning, scanMessages, scanSummary, formatStatValue }) {
	if (!scanning && !scanSummary && scanMessages.length === 0) {
		return null;
	}

	return (
		<Card className="mb-4">
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Scan progress</p>
				{scanning ? <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Running</span> : null}
			</div>
			<div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
				{scanMessages.length > 0 ? (
					<ul className="space-y-1 text-sm text-muted-foreground">
						{scanMessages.slice(-6).map((message, index) => <li key={`${message}-${index}`}>• {message}</li>)}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">No scan is currently running.</p>
				)}
			</div>
			{scanSummary ? (
				<div className="mt-3 grid gap-2 sm:grid-cols-4">
					<div><p className="text-[11px] text-muted-foreground">Found</p><p className="font-semibold">{formatStatValue(scanSummary.found || 0)}</p></div>
					<div><p className="text-[11px] text-muted-foreground">New</p><p className="font-semibold">{formatStatValue(scanSummary.newArticles || 0)}</p></div>
					<div><p className="text-[11px] text-muted-foreground">Updated</p><p className="font-semibold">{formatStatValue(scanSummary.updatedArticles || 0)}</p></div>
					<div><p className="text-[11px] text-muted-foreground">Errors</p><p className="font-semibold">{formatStatValue(scanSummary.errors?.length || 0)}</p></div>
				</div>
			) : null}
		</Card>
	);
}
